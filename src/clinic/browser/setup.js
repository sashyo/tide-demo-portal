import { clientLog, initTide, isPopupBlocked, POPUP_HELP, IAMService } from './tide.js';
import { Models } from '@tideorg/js';
import { PolicySignRequest } from 'heimdall-tide';

const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models;

/**
 * Realm setup: publish both Forseti contracts and sign both policies in ONE enclave prompt.
 *
 * The ordering is not adjustable:
 *
 *   link account -> GRANT tide-realm-admin (server side) -> sign in -> sign both policies
 *
 * The grant happens on the way back from linking, in /onboard/complete, before this page has
 * a session at all. That is what keeps setup down to a single login prompt: the first token
 * already carries the role. The block below is only the fallback for when that call did not
 * land. The grant comes first because signing a policy depends on it. The ceremony attaches the
 * signed `tide-realm-admin` role policy to the approved request, and the ORKs check the
 * signature against it. Run it while the realm is still firstAdmin and there is no such
 * grant to check against, so the run dies at "Collecting threshold signatures" with nothing
 * useful to say. That is the whitepaper's own account of the mode: firstAdmin exists for one
 * purpose, establishing the first tide-realm-admin assignment, and "only long enough to
 * eliminate itself". Policy signing is not that purpose.
 *
 * An earlier version of this file had the grant last and claimed the order was fixed by cost:
 * the flip to multiAdmin is a one-way door, so a policy signed afterwards needs a fresh
 * quorum. That reasoning does not survive contact with the arithmetic. The quorum is
 * max(1, floor(admins x 0.7)), and a workspace that has just been created has one admin, so
 * the threshold is one and the ceremony is the same single enclave approval either way. The
 * ordering cost nothing and broke the run.
 *
 * Both policies go through a single requestTideOperatorApproval call because it accepts an
 * ARRAY of requests. Two sequential calls means two popups — and a second popup is far more
 * likely to be blocked, since only the first is clearly tied to the user's click.
 */
const $ = (id) => document.getElementById(id);


/** Append a log line. A developer surface shows a trail, not a single replaced sentence. */
function log(msg, cls) {
  const box = $('log');
  if (!box) return;
  const t = new Date().toTimeString().slice(0, 8);
  const row = document.createElement('div');
  row.innerHTML = `<span class="t">${t}</span><span class="${cls || ''}"></span>`;
  row.lastChild.textContent = msg;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}
const say = (m) => { if (m) log(m); };
const step = (id, state) => { const el = $(id); if (el) el.dataset.state = state; };
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

function fail(msg, detail, html) {
  log(String(msg ?? detail ?? 'failed'), 'err');
  const box = $('err');
  box.hidden = false;
  if (html) box.innerHTML = html;
  else box.innerHTML = `<strong>${String(msg ?? 'Initialisation did not complete')}</strong>`
    + (detail ? String(detail).replace(/[<>]/g, '') : '');
  $('continue').hidden = false;
  const begin = $('begin');
  if (begin) { begin.hidden = false; begin.disabled = false; begin.textContent = 'Retry'; }
}

/** Build one signable policy, with its contract uploaded and its request initialised. */
async function buildPolicy(tc, prepareUrl, vendorId, shape) {
  const meta = await (await fetch(prepareUrl, { method: 'POST' })).json();
  if (meta.error) throw new Error(meta.error);

  const policy = new Policy({
    version: '3',
    contractId: meta.contractId,
    // The wrapped model id for a custom model; a bare name is rejected as "not in registry".
    modelId: shape.modelId(meta),
    // From the adapter JSON. IAMService._tc.vendorId is undefined.
    keyId: vendorId,
    approvalType: shape.approvalType,
    executionType: ExecutionType.PRIVATE,
    params: new Map(shape.params(meta)),
  });

  const request = PolicySignRequest.New(policy);
  request.addForsetiContractToUpload(meta.contractSource);
  request.setCustomExpiry(604800);

  const initialized = BaseTideRequest.decode(await tc.createTideRequest(request.encode()));
  return { meta, policy, initialized };
}

async function run() {
  for (const id of ['s-contract', 's-policy', 's-payment', 's-admin']) step(id, 'todo');

  try {
    const cfg = await (await fetch('/onboard/setup-config')).json();
    if (cfg.error) throw new Error(cfg.error);

    const tc = IAMService.getTideCloakClient();
    if (!tc) throw new Error('Tide client not ready — reload and sign in again.');

    /* The grant normally happened on the way back from linking, before this page had a
     * session, so the token in hand already carries tide-realm-admin and there is nothing to
     * do here. This is the fallback for when that call did not land: grant, then check.
     *
     * There is no re-login in this path any more. A token minted before the grant cannot be
     * repaired by refreshing it, so the honest move when the role is missing is to say so and
     * let the visitor sign in once, rather than bounce them through a second prompt that the
     * flow should never have needed. */
    if (!IAMService.hasRealmRole('tide-realm-admin')) {
      say('Granting tide-realm-admin…');
      const fin = await fetch('/onboard/finalize', { method: 'POST' });
      const done = await fin.json();
      if (!fin.ok || done.status === 'failed') throw new Error(done.error || 'Finalising failed.');
      log('tide-realm-admin granted, workspace is now multiAdmin', 'ok');

      say('Picking up the new role…');
      let isAdmin = false;
      for (let attempt = 1; attempt <= 3 && !isAdmin; attempt++) {
        try {
          await IAMService.updateToken();
        } catch (err) {
          clientLog('warn', 'token refresh failed on attempt ' + attempt, String(err));
        }
        isAdmin = IAMService.hasRealmRole('tide-realm-admin');
        if (!isAdmin) await new Promise((r) => setTimeout(r, attempt * 1200));
      }
      if (!isAdmin) {
        throw new Error('The grant went through, but this token was issued before it and does '
          + 'not carry the role. Sign out and back in, then reopen this page: the grant is '
          + 'already done, so it will go straight to signing the policies.');
      }
    }
    step('s-admin', 'done');

    say('Publishing the encryption contracts…');
    const clinic = await buildPolicy(tc, '/clinic/api/policy/prepare', cfg.adapter.vendorId, {
      modelId: () => ['PolicyEnabledEncryption:1', 'PolicyEnabledDecryption:1'],
      approvalType: ApprovalType.IMPLICIT,
      params: (m) => [['Role', m.contractRole]],
    });
    const payment = await buildPolicy(tc, '/treasury/api/policy/prepare', cfg.adapter.vendorId, {
      modelId: (m) => [m.modelId],
      // EXPLICIT so ValidateApprovers runs on the ORKs — that is what makes a payment approval
      // a quorum decision rather than a signature this app chose to accept.
      approvalType: ApprovalType.EXPLICIT,
      params: (m) => m.params,
    });
    step('s-contract', 'done');
    log('contracts published', 'ok');

    // ONE prompt, both policies.
    say('Approve both policies in the Tide window…');
    const approvals = await tc.requestTideOperatorApproval([
      { id: 'clinic-policy', request: clinic.initialized.encode() },
      { id: 'payment-policy', request: payment.initialized.encode() },
    ]);

    const byId = new Map((approvals ?? []).map((a) => [a.id, a]));
    for (const [id, name] of [['clinic-policy', 'clinical notes'], ['payment-policy', 'payment approvals']]) {
      const a = byId.get(id);
      if (!a || (a.status && a.status !== 'approved') || !a.request) {
        throw new Error(`The ${name} policy was not approved.`);
      }
    }

    say('Collecting threshold signatures…');
    const adminPolicy = await (await fetch('/clinic/api/policy/admin-policy')).json();
    if (!adminPolicy.bytes) throw new Error(adminPolicy.error || 'No realm admin policy available.');

    for (const [id, entry, storeUrl, stepId] of [
      ['clinic-policy', clinic, '/clinic/api/policy', 's-policy'],
      ['payment-policy', payment, '/treasury/api/policy', 's-payment'],
    ]) {
      const approved = BaseTideRequest.decode(byId.get(id).request);
      // Attaching the signed ADMIN policy is what the ORKs check; skipping it produces the
      // misleading "Policy supplied has not been signed".
      approved.addPolicy(new Uint8Array(adminPolicy.bytes));
      const sigs = await tc.executeSignRequest(approved.encode(), true);
      if (!sigs?.length) throw new Error('The ORK network returned no signature.');
      // Assign BEFORE serialising, or toBytes() emits an unsigned policy.
      entry.policy.signature = sigs[0];

      const res = await fetch(storeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: entry.meta.contractId, policyB64: b64(entry.policy.toBytes()) }),
      });
      if (!res.ok) throw new Error('The server refused to store the signed policy.');
      step(stepId, 'done');
      log('policy stored: ' + id, 'ok');
    }

    say('done');
    location.href = '/';
  } catch (e) {
    clientLog('error', 'setup failed: ' + (e?.message ?? e), e?.stack);
    if (isPopupBlocked(e)) return fail(null, null, POPUP_HELP);
    fail('Encryption setup did not complete.', String(e?.message ?? e));
  }
}

/** Sign in on load; keep the click for the enclave, which needs a user gesture. */
(async function boot() {
  try {
    const cfg = await (await fetch('/onboard/setup-config')).json();
    if (cfg.error) return fail(cfg.error);

    say('Starting Tide…');
    if (!(await initTide('/onboard/setup'))) return;   // redirected to sign in

    step('s-link', 'done');
    log('signed in as ' + (IAMService.getName() || 'admin'), 'ok');
    log('one approval covers both policies');
    const begin = $('begin');
    if (begin) {
      begin.hidden = false;
      begin.addEventListener('click', () => {
        if (begin.disabled) return;
        begin.disabled = true;
        begin.textContent = 'Signing…';
        log('requesting enclave approval');
        const box = $('err');
        if (box) box.hidden = true;
        run();
      });
    }
  } catch (e) {
    clientLog('error', 'setup boot failed: ' + (e?.message ?? e), e?.stack);
    fail('Could not start setup.', String(e?.message ?? e));
  }
})();
