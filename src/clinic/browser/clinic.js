import { IAMService, initTide } from './tide.js';
import { initTriage } from './triage.js';
import { Models } from '@tideorg/js';
import { PolicySignRequest } from 'heimdall-tide';

const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;

/**
 * Northside Clinic — policy-governed (shared) encryption.
 *
 * Shared, not self: a doctor encrypts a note and a DIFFERENT person may need to read it.
 * Self-encryption binds ciphertext to whoever encrypted it, so it cannot express "the treating
 * clinician can read this". Everything below therefore goes through IAMService.doEncrypt /
 * doDecrypt WITH signed policy bytes.
 *
 * Note the SDK boundary: the `doEncrypt`/`doDecrypt` convenience wrappers on the React hook do
 * NOT forward a policy. IAMService's own methods do, which is why we call those directly.
 */

const $ = (id) => document.getElementById(id);
const state = { cfg: null, realm: null, policy: null, role: null, opened: new Set() };

const say = (m) => { const el = $('status'); if (el) el.textContent = m; };
const fail = (m) => {
  const el = $('err');
  if (el) { el.textContent = m; el.hidden = false; }
  say('');
  console.error('[clinic]', m);
};

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

// --------------------------------------------------------------------------- boot
(async function boot() {
  try {
    state.realm = document.body.dataset.realm;
    say('Starting Tide…');
    state.cfg = await (await fetch('/clinic/api/adapter')).json();
    if (!(await initTide(location.pathname))) return;   // redirected to sign in

    state.role = IAMService.hasRealmRole('clinic-doctor') ? 'doctor'
      : IAMService.hasRealmRole('clinic-nurse') ? 'nurse' : 'reception';
    $('whoami').textContent = `${IAMService.getName() || 'Signed in'} · ${state.role}`;
    document.body.dataset.role = state.role;

    await loadPolicy();
    await render();
  } catch (e) {
    fail(e?.message ?? String(e));
  }
})();

// ----------------------------------------------------------------- policy plumbing
async function loadPolicy() {
  const res = await fetch('/clinic/api/policy');
  const data = await res.json();
  if (data.signed) {
    state.policy = b64ToBytes(data.policyB64);
    $('policy-state').textContent = `Encryption policy signed ${new Date(data.signedAt).toLocaleString()}`;
    $('sign-panel').hidden = true;
  } else {
    // Gate the app rather than letting doEncrypt fail at runtime with an ORK error. Until the
    // admin has signed, this realm genuinely cannot do shared encryption.
    $('policy-state').textContent = 'Encryption policy has not been signed yet.';
    $('sign-panel').hidden = !IAMService.hasRealmRole('tide-realm-admin');
    $('sign-blocked').hidden = IAMService.hasRealmRole('tide-realm-admin');
  }
}

/**
 * The one step that cannot be scripted: producing the VVK signature over the policy.
 *
 * Five steps, in this exact order. Each omission fails differently and none of the errors
 * name the missing step:
 *   1 build + initialise the request      2 operator approval (enclave popup)
 *   3 attach the signed ADMIN policy      4 executeSignRequest(waitForAll = true)
 *   5 assign signature BEFORE toBytes()
 */
async function signPolicy() {
  const btn = $('sign-btn');
  btn.disabled = true;
  try {
    say('Preparing the policy…');
    const meta = await (await fetch('/clinic/api/policy/prepare', { method: 'POST' })).json();
    if (meta.error) throw new Error(meta.error);

    const policy = new Policy({
      version: '3',
      contractId: meta.contractId,
      // Must be the array of specific model ids. "any" is rejected.
      modelId: ['PolicyEnabledEncryption:1', 'PolicyEnabledDecryption:1'],
      // From the adapter JSON. IAMService._tc.vendorId is undefined — reading it there yields
      // a policy the ORKs cannot match to a key.
      keyId: state.cfg.vendorId,
      approvalType: ApprovalType.IMPLICIT,
      executionType: ExecutionType.PRIVATE,
      params: new Map([['Role', meta.contractRole]]),
    });

    const tc = IAMService.getTideCloakClient();
    if (!tc) throw new Error('Tide client not ready — sign in again.');

    // 1. Build. The contract source rides along so the ORK can compile it.
    const request = PolicySignRequest.New(policy);
    request.addForsetiContractToUpload(meta.contractSource);
    request.setCustomExpiry(604800);

    say('Initialising the signing request…');
    const initialized = BaseTideRequest.decode(await tc.createTideRequest(request.encode()));

    // 2. Operator approval — this opens the enclave popup.
    say('Waiting for your approval in the Tide enclave…');
    const approvals = await tc.requestTideOperatorApproval([
      { id: 'clinic-policy', request: initialized.encode() },
    ]);
    if (approvals[0]?.status !== 'approved') throw new Error('Approval was declined.');

    // 3. Attach the admin policy. Skipping this is what produces the ORKs' misleading
    //    "Policy supplied has not been signed".
    const approved = BaseTideRequest.decode(approvals[0].request);
    const adminBytes = await (await fetch('/clinic/api/policy/admin-policy')).json();
    if (!adminBytes.bytes) throw new Error('Could not fetch the realm admin policy.');
    approved.addPolicy(new Uint8Array(adminBytes.bytes));

    // 4. waitForAll must be true or the threshold signature is incomplete.
    say('Collecting threshold signatures…');
    const signatures = await tc.executeSignRequest(approved.encode(), true);

    // 5. Assign BEFORE serialising, or toBytes() emits an unsigned policy.
    policy.signature = signatures[0];
    const signedBytes = policy.toBytes();

    say('Storing the signed policy…');
    const stored = await fetch('/clinic/api/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractId: meta.contractId, policyB64: bytesToB64(signedBytes) }),
    });
    if (!stored.ok) throw new Error('Server refused to store the signed policy.');

    say('');
    location.reload();
  } catch (e) {
    fail(`Policy signing failed: ${e?.message ?? e}`);
    btn.disabled = false;
  }
}

/* Notes to start with, so the demo has something in it before anyone types.
 *
 * They are encrypted HERE, in the browser, with this realm's signed policy, exactly the way a
 * clinician's own note would be. Shipping ready-made ciphertext in the repo was the obvious
 * shortcut and the wrong one: it is encrypted to a key from some other realm, so it would
 * never decrypt for anyone, and the good half of the demo would be a permanent failure. */
const SEED = [
  'Reports intermittent chest tightness on exertion, worse climbing stairs. No radiation to '
    + 'the arm. Ex-smoker, stopped 2019. For ECG and bloods before the next appointment.',
  'Six week postnatal review. Mood low, sleeping poorly, declined referral last visit but is '
    + 'open to it now. Partner supportive. Follow up in a fortnight.',
];

let seeded = false;
async function seedNotes(patients) {
  if (seeded || !state.policy) return false;
  seeded = true;
  // Only when the practice is genuinely empty. Nobody wants their own notes joined by ours.
  if (patients.some((p) => p.notes.length > 0)) return false;
  try {
    const [a, b] = await IAMService.doEncrypt(
      SEED.map((text) => ({ data: text, tags: ['medical'] })), state.policy,
    );
    const targets = patients.slice(0, 2);
    await Promise.all(targets.map((p, i) => fetch('/clinic/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: p.id, ciphertext: [a, b][i], by: 'Dr Ellis' }),
    })));
    return true;
  } catch (err) {
    // Seeding is a convenience. If it fails the app still works, so it does not take the
    // page down with it; the queue is simply empty until somebody writes a note.
    console.warn('[clinic] could not seed notes:', err);
    return false;
  }
}

// ------------------------------------------------------------------- notes
async function render() {
  let patients = await (await fetch('/clinic/api/patients')).json();
  if (await seedNotes(patients)) {
    patients = await (await fetch('/clinic/api/patients')).json();
  }
  const list = $('patients');
  list.replaceChildren();

  for (const p of patients) {
    const card = document.createElement('div');
    card.className = 'pt';
    card.innerHTML = `
      <div class="pt-head"><strong>${escape(p.name)}</strong><span class="dim">${escape(p.age)} · ${escape(p.appt)}</span></div>
      <dl class="row"><dt>Mobile</dt><dd>${escape(p.mobile)}</dd></dl>
      <dl class="row"><dt>Address</dt><dd>${escape(p.address)}</dd></dl>
      <dl class="row"><dt>Balance</dt><dd>${escape(p.balance)}</dd></dl>
      <div class="notes-head">Clinical notes</div>
      <div class="notes" id="notes-${p.id}"></div>`;
    list.appendChild(card);
    void renderNotes(p);
  }
  // Only offer the control once a session AND a signed policy exist; otherwise the first click
  // fails on something the user cannot see.
  $('doctor-tools').hidden = state.role !== 'doctor' || !state.policy;
  const nb = $('note-btn');
  if (nb) nb.disabled = !state.policy;

  // The assistant needs only the signed policy: everything it knows comes from the server,
  // and the one thing it hands back that matters is ciphertext.
  if (!triageStarted && state.policy) {
    triageStarted = true;
    initTriage(state.policy);
  }
}

let triageStarted = false;

/**
 * Notes stay sealed until a second clinician approves the access.
 *
 * A two-person rule on sensitive records is a real control, and it gives the demo something a
 * single visitor can actually watch: the request, the colleague's approval, their enclave
 * signature, and only then the reveal.
 *
 * What is theatre and what is not: the SECOND approver is staged and labelled as such. The
 * decryption is real — the ciphertext goes to the ORK network, the Forseti contract checks
 * your doken, and the plaintext only exists in this browser. Faking that half would misstate
 * the one property the app exists to show.
 */
async function renderNotes(p) {
  const box = $(`notes-${p.id}`);
  if (p.notes.length === 0) { box.innerHTML = '<div class="dim">No notes recorded.</div>'; return; }

  for (const note of p.notes) {
    const el = document.createElement('div');
    el.className = 'note-row';
    box.appendChild(el);

    if (!state.policy) {
      el.innerHTML = `<div class="cipher">${escape(note.ciphertext.slice(0, 120))}…</div>
        <div class="dim">Encrypted — no signed policy on this workspace yet.</div>`;
      continue;
    }

    if (state.opened.has(note.id)) {
      await reveal(el, note);
      continue;
    }

    el.innerHTML = `<div class="cipher">${escape(note.ciphertext.slice(0, 96))}…</div>
      <div class="req-row">
        <span class="dim">Sealed — needs a second clinician</span>
        <button class="btn-ghost req-btn" type="button">Request access</button>
      </div>`;
    el.querySelector('.req-btn').addEventListener('click', (e) => request(e.target, el, p, note));
  }
}

/** Ask a colleague, watch them approve, then decrypt for real. */
async function request(btn, el, patient, note) {
  btn.disabled = true;
  btn.textContent = 'Requesting…';
  try {
    await window.TideReplay.play({
      name: 'Dr Ellis',
      app: 'Northside Clinic',
      ref: patient.name,
      headline: 'Clinical notes',
      question: `Release the clinical notes for ${patient.name} to ${IAMService.getName() || 'a colleague'}?`,
      action: 'Approve access',
      settled: 'Access granted',
    });
    state.opened.add(note.id);
    await reveal(el, note);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Request access';
  }
}

async function reveal(el, note) {
  try {
    // The ORKs decide this, not us: the contract inspects the caller's doken. A user without
    // the clinical role is refused by the network, not by this code.
    const [plain] = await IAMService.doDecrypt(
      [{ encrypted: note.ciphertext, tags: ['medical'] }], state.policy,
    );
    el.innerHTML = `<div class="plain-text">${escape(plain)}</div>
      <div class="dim">${escape(note.by)} · ${new Date(note.at).toLocaleString()}
        · <span class="ok-tag">decrypted with your key</span></div>`;
  } catch (err) {
    el.innerHTML = `<div class="cipher">${escape(note.ciphertext.slice(0, 96))}…</div>
      <div class="dim">The network refused to decrypt this for your account.</div>`;
  }
}

async function addNote() {
  const sel = $('note-patient'); const text = $('note-text');
  if (!text.value.trim()) return;
  const btn = $('note-btn'); btn.disabled = true;
  try {
    say('Encrypting…');
    const [ciphertext] = await IAMService.doEncrypt(
      [{ data: text.value.trim(), tags: ['medical'] }], state.policy,
    );
    await fetch('/clinic/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: sel.value, ciphertext, by: IAMService.getName() || 'Clinician' }),
    });
    text.value = '';
    say('');
    await render();
  } catch (e) {
    fail(`Could not encrypt: ${e?.message ?? e}`);
  } finally { btn.disabled = false; }
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'sign-btn') signPolicy();
  if (e.target.id === 'note-btn') addNote();
});
