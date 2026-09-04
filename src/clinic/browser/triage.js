/* Northside Clinic: the triage assistant, browser half.
 *
 * The assistant itself runs on the server (src/clinic/agent.ts) and holds no Tide credential,
 * because a server-side process cannot obtain one: PRISM needs the browser enclave, and ORK
 * decryption is browser-and-SDK only. This file is the chat it speaks through, plus the one
 * thing it can never do for itself.
 *
 * The split is the demo. Ask it to sort your queue, route a case or draft a reply and it does
 * real work, on metadata, without the contents of anything. Ask it for your next patient and
 * it fetches everything on file and hands the clinical note back as ciphertext. Tell it to
 * read that note and it agrees, because there is no refusal in it and no filter over its
 * output, and it comes back with the same bytes it already had.
 *
 * The plaintext appears in exactly one circumstance: a clinician approves the release, and
 * THIS page, holding a real session, calls doDecrypt against the realm's signed policy. That
 * call is real. The approving colleague is staged and labelled as staged.
 *
 * The honest limit, stated on the page: the decrypt runs with your authority. Tide attests
 * that whoever holds this session holds this role. It does not attest who is driving it. */
import { IAMService } from '@tidecloak/js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

let POLICY = null;
let seq = 0;

function bubble(who, html) {
  const thread = $('tri-thread');
  const d = document.createElement('div');
  d.className = `dm-turn dm-turn-${who}`;
  d.innerHTML = (who === 'bot' ? '<span class="dm-bot-face">&#9679;</span>' : '')
    + `<div class="dm-bubble">${html}</div><span class="dm-stamp">${stamp()}</span>`;
  thread.appendChild(d);
  thread.scrollTop = thread.scrollHeight;
  return d;
}

async function typing(ms) {
  const thread = $('tri-thread');
  const t = document.createElement('div');
  t.className = 'dm-turn dm-turn-bot';
  t.innerHTML = '<span class="dm-bot-face">&#9679;</span>'
    + '<div class="dm-bubble dm-typing"><span></span><span></span><span></span></div>';
  thread.appendChild(t);
  thread.scrollTop = thread.scrollHeight;
  await wait(ms);
  t.remove();
}

function trace(text) {
  const thread = $('tri-thread');
  const d = document.createElement('div');
  d.className = 'dm-trace';
  d.textContent = text;
  thread.appendChild(d);
  thread.scrollTop = thread.scrollHeight;
}

/** What happened on the other side of the app boundary. Drawn outside the chat, deliberately. */
function netPanel(state, detail) {
  const host = $('tri-net');
  if (!host) return;
  host.hidden = false;
  host.className = `tri-net tri-net-${state}`;
  host.innerHTML = '<div class="tri-net-head"><span>Outside this app</span>'
    + '<em>clinical-notes policy</em></div>'
    + `<div class="tri-net-body">${detail}</div>`;
}

/** A real decrypt, with the realm's real signed policy, reported honestly either way. */
async function decryptHere(record) {
  netPanel('waiting', '<span class="tri-spin"></span>Every node is checking the clinical policy '
    + "against this browser's token.");
  await wait(1200);
  try {
    const [plain] = await IAMService.doDecrypt(
      [{ encrypted: record.ciphertext, tags: ['medical'] }], POLICY,
    );
    netPanel('open', '<strong>Released to this browser.</strong> The nodes checked the clinical '
      + 'policy against the token that made the call and returned their shares. The plaintext '
      + 'was assembled here and nowhere else. The assistant never saw it, and could not have: '
      + 'it has no token to make this call with.');
    return { ok: true, text: plain };
  } catch (err) {
    netPanel('shut', '<strong>Refused.</strong> The clinical policy is evaluated by every node '
      + 'against the caller, and this one does not carry the clinical role. No node returned a '
      + 'share, so no plaintext was assembled anywhere.'
      + `<div class="tri-err">${esc(String(err?.message ?? err)).slice(0, 160)}</div>`);
    return { ok: false };
  }
}

/** The legitimate path: a clinician approves, then this page decrypts. */
async function requestAccess(record, btn) {
  btn.disabled = true;
  btn.textContent = 'Asking Dr Ellis...';
  if (window.TideReplay) {
    await window.TideReplay.play({
      name: 'Dr Ellis',
      app: 'Northside Clinic',
      ref: `Note ${record.id} - ${record.patient}`,
      headline: 'Release clinical note',
      question: `Release the clinical note for ${record.patient} to the requesting clinician?`,
      action: 'Approve release',
      settled: 'Approved, signed in enclave',
    });
  }
  btn.textContent = 'Decrypting...';
  const out = await decryptHere(record);
  const holder = btn.closest('.tri-note');
  holder.innerHTML = out.ok
    ? `<div class="tri-plain">${esc(out.text)}</div>`
      + '<div class="dim">Decrypted in your browser, after the approval.</div>'
    : `<div class="tri-cipher">${esc(record.ciphertext.slice(0, 96))}...</div>`
      + '<div class="dim">The network refused to release this to your account.</div>';
}

function card(record, offerAccess) {
  const id = `tri-note-${++seq}`;
  return `<div class="tri-card">
    <div class="tri-row"><span>Patient</span><b>${esc(record.patient)}</b></div>
    <div class="tri-row"><span>Logged</span><b>${esc(record.when)}</b></div>
    <div class="tri-row"><span>Priority</span><b>${esc(record.urgency)}</b></div>
    <div class="tri-row"><span>Clinical note</span><b class="tri-locked">encrypted</b></div>
    <div class="tri-note" id="${id}">
      <div class="tri-cipher">${esc(record.ciphertext.slice(0, 96))}...</div>
      ${offerAccess ? '<button class="btn-ghost tri-ask" type="button">Request decryption</button>' : ''}
    </div>
  </div>`;
}

async function send() {
  const box = $('tri-input');
  const text = box.value.trim();
  if (!text) return;
  box.value = '';
  $('tri-send').disabled = true;
  bubble('user', esc(text));
  await wait(400);
  await typing(1100);

  let reply;
  try {
    const r = await fetch('/clinic/api/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    reply = await r.json();
  } catch {
    bubble('bot', 'I could not reach the practice records just then. Try again.');
    $('tri-send').disabled = false;
    return;
  }

  const body = esc(reply.say).replace(/\n/g, '<br>')
    + (reply.record ? card(reply.record, reply.offerAccess) : '');
  const b = bubble('bot', body);

  if (reply.triedToRead) {
    // It agreed, and this is what agreeing got it.
    trace('assistant has no token, so no decrypt call was made');
    await wait(500);
    netPanel('none', '<strong>Nothing was asked of the network.</strong> The assistant runs on '
      + 'the server, where a Tide credential cannot exist: authentication needs the browser '
      + 'enclave and decryption is browser-only. It was not refused. It had nothing to ask '
      + 'with, so the ciphertext is all it could return.');
    await typing(1000);
    bubble('bot', 'That is everything I hold for that note. I do not have a way to open it. '
      + 'You can request decryption above and a clinician will approve it.');
  }

  const btn = b.querySelector('.tri-ask');
  if (btn) btn.addEventListener('click', () => requestAccess(reply.record, btn));

  $('tri-send').disabled = false;
}

export function initTriage(policy) {
  POLICY = policy;
  const sendBtn = $('tri-send');
  if (!sendBtn) return;
  sendBtn.addEventListener('click', send);
  $('tri-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  bubble('bot', 'Good morning. I can sort your queue, route a case, draft a reply, or pull up '
    + 'your next patient. I cannot read a clinical note. Try <em>"who is my next patient?"</em>, '
    + 'then try telling me to read it.');
}
