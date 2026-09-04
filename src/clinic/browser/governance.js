import { IAMService, initTide } from './tide.js';
import { Models } from '@tideorg/js';

const { BaseTideRequest } = Models;

/**
 * Approve IGA change requests in the Tide enclave.
 *
 * This is TideCloak's OWN quorum governance, not an approval table this app invented. A
 * governed realm write (granting a role, creating a user) returns 202 and files a change
 * request; nothing is applied until the quorum approves it.
 *
 * In Tide MultiAdmin mode a bare `authorize` is NOT enough — it records nothing and the CR
 * stays PENDING with authCount unchanged. The signature comes from the two-phase exchange:
 *
 *   GET  approval-model  -> a challenge (base64 requestModel)
 *   sign it in the enclave
 *   POST approval-model  -> { recorded, authCount, threshold }
 *   commit               -> applies it (412 while under threshold)
 */
const $ = (id) => document.getElementById(id);
const say = (m) => { const e = $('gov-status'); if (e) e.textContent = m; };
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let realm = null;

async function load() {
  const list = await (await fetch('/access/api/change-requests')).json();
  const box = $('gov-list');
  if (!Array.isArray(list) || list.length === 0) {
    box.innerHTML = '<p class="sub">No pending governance approvals. Grant someone a role below to create one.</p>';
    return;
  }
  box.innerHTML = list.map((cr) => `
    <div class="appr" style="margin-bottom:10px">
      <div class="appr-who">${esc(cr.actionType ?? 'change')} · ${esc(cr.entityType ?? '')}</div>
      <div class="appr-meta">${esc(cr.authorizers?.length ?? 0)} of ${esc(cr.threshold ?? '?')} approvals
        ${cr.readyToCommit ? '· ready to commit' : ''}</div>
      <div class="appr-sub">${esc(cr.id)}</div>
      <div style="margin-top:10px">
        <button class="btn-ghost gov-approve" data-id="${esc(cr.id)}" type="button">Approve in enclave</button>
      </div>
    </div>`).join('');
}

async function approve(id) {
  try {
    say('Starting Tide…');
    if (!(await initTide(location.pathname))) return;

    const tc = IAMService.getTideCloakClient();
    if (!tc) throw new Error('Tide client not ready.');

    say('Fetching the approval challenge…');
    const model = await (await fetch(`/access/api/change-requests/${encodeURIComponent(id)}/approval-model`)).json();
    if (!model.requestModel) throw new Error(model.error || 'No approval model returned.');

    say('Approve this change in the Tide window…');
    const approvals = await tc.requestTideOperatorApproval([
      { id, request: b64ToBytes(model.requestModel) },
    ]);
    if (approvals[0]?.status !== 'approved') throw new Error('You declined the approval.');

    say('Recording your signature…');
    const recorded = await (await fetch(`/access/api/change-requests/${encodeURIComponent(id)}/approval-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestModel: bytesToB64(approvals[0].request) }),
    })).json();
    if (recorded.error) throw new Error(recorded.error);

    say(`Recorded — ${recorded.authCount ?? '?'} of ${recorded.threshold ?? '?'} approvals.`);
    // Commit only when the threshold is met; 412 otherwise, which is expected, not an error.
    const done = await (await fetch(`/access/api/change-requests/${encodeURIComponent(id)}/commit`, { method: 'POST' })).json();
    say(done.ok ? 'Approved and applied.' : `Recorded. ${done.error ?? 'Awaiting more approvals.'}`);
    await load();
  } catch (e) {
    say('');
    const box = $('gov-error');
    box.hidden = false;
    box.textContent = 'Approval failed: ' + (e?.message ?? e);
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.gov-approve');
  if (b) approve(b.dataset.id);
});

realm = document.body.dataset.realm;
load().catch(() => {});
