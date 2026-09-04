import { book, needsTwo, quorumMet, quorumOf, THRESHOLD_CENTS, total } from './store.js';
import type { PaymentRun, Person } from './types.js';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const money = (cents: number): string =>
  (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export type Viewer = { person: Person; roles: string[]; realm: string };

type Back = { href: string; label: string };

function shell(title: string, viewer: Viewer, body: string, back: Back): string {
  const role = viewer.roles.includes('treasury-controller') ? 'Controller'
    : viewer.roles.includes('treasury-analyst') ? 'Analyst' : 'No treasury role';
  return `<!doctype html>
<html lang="en" data-app="treasury"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Northwind Treasury</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230d4ec4'/%3E%3Ctext x='16' y='23' font-family='system-ui' font-size='18' font-weight='900' fill='white' text-anchor='middle'%3ET%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/treasury.css">
</head><body>
<div class="wrap">
  <div class="mast">
    <div class="mark" aria-hidden="true">T</div>
    <div style="flex:1">
      <h1>Northwind Treasury</h1>
      <div class="host">${esc(viewer.person.name)} · ${esc(role)} · ${esc(viewer.realm)}</div>
    </div>
    <a href="${esc(back.href)}" class="back"><span aria-hidden="true">&larr;</span> ${esc(back.label)}</a>
  </div>
  ${body}
</div></body></html>`;
}

/**
 * Shown when the signed-in realm has no treasury roles at all — which happens on any realm
 * created before those roles were added to the template. Roles cannot be added to a live IGA
 * realm safely, so the honest answer is "this realm predates the app", not "access denied".
 */
export function noRoles(realm: string): string {
  return `<!doctype html><html lang="en" data-app="treasury"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Northwind Treasury</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/treasury.css">
</head><body><div class="wrap">
  <div class="mast"><div class="mark" aria-hidden="true">T</div>
    <div style="flex:1"><h1>Northwind Treasury</h1><div class="host">${esc(realm)}</div></div>
    <a href="/" class="back"><span aria-hidden="true">&larr;</span> Portal</a></div>
  <section class="card">
    <h2>This realm has no treasury roles</h2>
    <p class="sub">The realm <strong>${esc(realm)}</strong> was created before Treasury existed, so it
       has no analyst or controller role to work with.</p>
    <div class="note note-warn">
      <strong>Why they cannot just be added</strong>
      Creating a role on a live realm is a governed change, and one the provisioner cannot approve
      by itself: the request would sit unapproved and block everything queued behind it. Roles
      have to be present when the realm is created.
    </div>
    <p style="margin-top:20px"><a class="btn-link" href="/switch"><button class="btn-primary" type="button">Use a realm that has them</button></a></p>
    <p class="sub" style="margin-top:14px">Any realm created from now on includes them, and new users
       get the analyst role automatically.</p>
  </section>
</div></body></html>`;
}

export function dashboard(viewer: Viewer): string {
  const b = book(viewer.realm);
  const waiting = b.runs.filter((r) => r.status === 'awaiting_approval');

  return shell('Overview', viewer, `
  <section class="card">
    <h2>Accounts</h2>
    <div class="accounts">
      ${b.accounts.map((a) => `<div class="acct">
        <div class="acct-name">${esc(a.name)}</div>
        <div class="acct-bal">${esc(money(a.balanceCents))}</div>
        <div class="acct-no">${esc(a.bsb)} · ${esc(a.number)}</div>
      </div>`).join('')}
    </div>
  </section>

  <section class="card">
    <div class="meta"><h2>Awaiting approval</h2>
      <span class="badge">${waiting.length}</span></div>
    ${waiting.length === 0 ? '<p class="sub">Nothing waiting.</p>' : `<div class="runs">
      ${waiting.map((r) => `<a class="run" href="/treasury/runs/${esc(r.id)}">
        <div class="run-id">${esc(r.id)}</div>
        <div class="run-body">
          <div class="run-amt">${esc(money(total(r)))}</div>
          <div class="run-meta">${r.lines.length} payment${r.lines.length === 1 ? '' : 's'} ·
            prepared by ${esc(r.createdBy.name)} · ${esc(when(r.createdAt))}</div>
        </div>
        <div class="run-state">${needsTwo(r)
          ? `${r.approvals.length} of ${quorumOf(r)}` : 'ready'}</div>
      </a>`).join('')}
    </div>`}
    <p class="sub" style="margin-top:16px">Runs of ${esc(money(THRESHOLD_CENTS))} or more need three approvers.</p>
  </section>

  <section class="card">
    <h2>Recent activity</h2>
    <table class="ledger"><tbody>
      ${b.txns.slice(0, 9).map((t) => `<tr>
        <td class="t-when">${esc(when(t.at))}</td>
        <td class="t-desc">${esc(t.desc)}</td>
        <td class="t-amt ${t.cents < 0 ? 'out' : 'in'}">${esc(money(t.cents))}</td>
      </tr>`).join('')}
    </tbody></table>
  </section>

  <section class="card">
    <h2>Suppliers</h2>
    <p class="sub">Changing a supplier's bank details needs a second approver, the same as a large payment.</p>
    <table class="ledger"><tbody>
      ${b.suppliers.map((s) => `<tr>
        <td class="t-desc"><strong>${esc(s.name)}</strong><br><span class="dim">${esc(s.bsb)} · ${esc(s.account)} · ${esc(s.terms)}</span></td>
        <td class="t-amt"><a class="plain" href="/treasury/suppliers/${esc(s.id)}">Bank details</a></td>
      </tr>`).join('')}
    </tbody></table>
  </section>`, { href: '/', label: 'Portal' });
}

export function runDetail(viewer: Viewer, run: PaymentRun, blocker: string | null, qrSvg: string, approveUrl: string, flash?: string): string {
  const b = book(viewer.realm);
  const required = quorumOf(run);
  const done = run.status === 'released';
  const realSigners = run.approvals.filter((a) => !a.simulated).length;

  return shell(run.id, viewer, `
  <section class="card">
    <div class="meta">
      <div><h2>${esc(run.id)}</h2>
        <p class="sub" style="margin:6px 0 0">Prepared by ${esc(run.createdBy.name)} · ${esc(when(run.createdAt))}</p></div>
      <span class="badge ${done ? 'ok' : ''}">${done ? 'Released' : `${run.approvals.length} of ${required}`}</span>
    </div>

    <div class="total">${esc(money(total(run)))}</div>

    <table class="ledger"><tbody>
      ${run.lines.map((l) => {
        const s = b.suppliers.find((x) => x.id === l.supplierId);
        return `<tr>
          <td class="t-desc"><strong>${esc(s?.name ?? 'Supplier')}</strong><br><span class="dim">${esc(l.invoice)} · ${esc(s?.bsb ?? '')} ${esc(s?.account ?? '')}</span></td>
          <td class="t-amt">${esc(money(l.cents))}</td>
        </tr>`;
      }).join('')}
    </tbody></table>

    ${flash ? `<div class="note note-info" style="margin-top:20px"><strong>Done</strong>${esc(flash)}</div>` : ''}

    ${done ? `<div class="note note-info" style="margin-top:20px">
        <strong>Approved by a quorum of ${required}</strong>
        Released ${esc(when(run.releasedAt!))}.
        <div class="sim-note">${run.approvals.filter((a) => a.signature).length} signed in an
          enclave; the rest are staged.</div>
      </div>`
      : blocker ? `<div class="note note-warn" style="margin-top:20px">
        <strong>You cannot approve this one</strong>${esc(blocker)}</div>
        ${needsTwo(run) ? approvePanel(qrSvg, approveUrl) : ''}`
      : `${enclaveApprove(run, b)}`}

    ${done ? '' : '<script src="/replay.js"></script><script src="/treasury.js"></script>'}

    <h3 class="sec">Approvals</h3>
    <div class="approvals">
      ${run.approvals.map((a) => `<div class="appr${a.simulated ? ' sim' : ''}">
        <div class="appr-who">${esc(a.by.name)}${a.simulated
          ? '<span class="sim-tag">staged</span>'
          : a.signature
            ? '<span class="real-tag">enclave-signed</span>'
            : '<span class="sim-tag">unsigned</span>'}</div>
        <div class="appr-meta">${esc(when(a.at))} · ${esc(a.device)}</div>
        <div class="appr-sub">${esc(a.by.sub)}</div>
      </div>`).join('')}
      ${Array.from({ length: Math.max(0, required - run.approvals.length) }, (_, i) => `
        <div class="appr pending">
          <div class="appr-who">Awaiting approver ${run.approvals.length + i + 1} of ${required}
            <span class="spinner" aria-hidden="true"></span></div>
          <div class="appr-meta">must be a different person${
            run.approvals.some((a) => !a.simulated)
              ? '. a staged colleague is reviewing it now'
              : ''}</div></div>`).join('')}
    </div>
  </section>`, { href: '/treasury', label: 'Payment runs' });
}

/**
 * The approve control.
 *
 * This is an APPLICATION-LEVEL approval, and the copy says so. An earlier version signed a
 * bespoke Tide request here; that was wrong twice over — it used an SDK builder outside the
 * public API, and the pack is explicit that an app must not stand up its own approval
 * mechanism beside TideCloak's governance ("IGA uses cryptographic quorum enforcement — it is
 * not a simple approval table").
 *
 * IGA governs REALM objects, so it cannot govern a payment. The documented path for arbitrary
 * data is a Forseti contract with ApprovalType.EXPLICIT and a ValidateApprovers M-of-N check,
 * which needs a signed policy first. Until that exists, this approval is honest about being an
 * app-level record — and Northwind Access shows what genuine enclave-signed quorum looks like.
 */
function enclaveApprove(run: PaymentRun, b: ReturnType<typeof book>): string {
  const details = {
    run: run.id,
    amount: money(total(run)),
    payments: run.lines.map((l) => ({
      to: b.suppliers.find((x) => x.id === l.supplierId)?.name ?? 'Supplier',
      invoice: l.invoice,
      amount: money(l.cents),
    })),
  };
  const summary = `Approve ${run.id}. ${money(total(run))}`;
  const payload = { ...details, amountCents: total(run) };
  return `<div style="margin-top:20px">
    <button class="btn-primary" type="button" id="enclave-approve"
      data-run="${esc(run.id)}"
      data-payload="${esc(JSON.stringify(payload))}">Approve in the Tide enclave</button>
    <p class="sub" id="approve-status" style="margin-top:12px"></p>
    <div class="note" id="approve-result" hidden></div>
  </div>
  <script src="/approve.bundle.js"></script>`;
}

function approvePanel(qrSvg: string, approveUrl: string): string {
  return `<div class="phone">
    <div class="phone-qr">${qrSvg}</div>
    <div class="phone-copy">
      <strong>Approve on another device</strong>
      <p>Scan with a phone; this page updates when you approve.</p>
      <p class="dim mono">${esc(approveUrl)}</p>
    </div>
  </div>`;
}

export function supplier(viewer: Viewer, id: string, flash?: string, error?: string): string {
  const b = book(viewer.realm);
  const s = b.suppliers.find((x) => x.id === id);
  if (!s) return shell('Not found', viewer, '<section class="card"><h2>No such supplier</h2></section>', { href: '/treasury', label: 'Payment runs' });
  const pending = b.bankChanges.filter((c) => c.supplierId === id && !c.appliedAt);

  return shell(s.name, viewer, `
  <section class="card">
    <h2>${esc(s.name)}</h2>
    <p class="sub">ABN ${esc(s.abn)} · ${esc(s.terms)}${s.lastPaid ? ` · last paid ${esc(when(s.lastPaid))}` : ''}</p>

    <div class="kv"><dl>
      <dt>BSB</dt><dd>${esc(s.bsb)}</dd>
      <dt>Account</dt><dd>${esc(s.account)}</dd>
      <dt>Changed</dt><dd>${s.bankChangedAt ? esc(when(s.bankChangedAt)) : 'never'}</dd>
    </dl></div>

    ${flash ? `<div class="note note-info"><strong>Done</strong>${esc(flash)}</div>` : ''}
    ${error ? `<div class="note note-warn"><strong>Not applied</strong>${esc(error)}</div>` : ''}

    ${pending.map((c) => `<div class="note note-warn">
      <strong>Change requested · ${esc(c.id)}</strong>
      To ${esc(c.bsb)} · ${esc(c.account)}, by ${esc(c.requestedBy.name)} ${esc(when(c.requestedAt))}.
      <form method="post" action="/treasury/suppliers/${esc(id)}/bank/${esc(c.id)}/approve" style="margin-top:12px">
        <button class="btn-ghost" type="submit">Approve this change</button>
      </form>
    </div>`).join('')}

    <h3 class="sec">Change bank details</h3>
    <p class="sub">Changing bank details takes two people.</p>
    <form method="post" action="/treasury/suppliers/${esc(id)}/bank" class="bank-form">
      <label for="bsb">BSB</label><input type="text" id="bsb" name="bsb" placeholder="063-118" required>
      <label for="account">Account</label><input type="text" id="account" name="account" placeholder="••• 9921" required>
      <button class="btn-ghost" type="submit">Request change</button>
    </form>
  </section>`, { href: '/treasury', label: 'Payment runs' });
}
