import { expired, org, remaining, type Member } from './store.js';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export type Viewer = { realm: string; person: { sub: string; name: string }; roles: string[] };

type Back = { href: string; label: string };

function shell(title: string, v: Viewer, body: string, back: Back): string {
  const role = v.roles.includes('access-admin') ? 'IT admin'
    : v.roles.includes('access-servicedesk') ? 'Service desk' : 'Engineer';
  return `<!doctype html><html lang="en" data-app="access"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Northwind Access</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230d4ec4'/%3E%3Ctext x='16' y='23' font-size='18' font-weight='900' fill='white' text-anchor='middle' font-family='system-ui'%3EA%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/treasury.css"><link rel="stylesheet" href="/demos.css"></head><body>
<div class="wrap">
  <div class="mast"><div class="mark" aria-hidden="true">A</div>
    <div style="flex:1"><h1>Northwind Access</h1>
      <div class="host">${esc(v.person.name)} · ${esc(role)} · ${esc(v.realm)}</div></div>
    <a href="${esc(back.href)}" class="back"><span aria-hidden="true">&larr;</span> ${esc(back.label)}</a></div>
  ${body}
</div><script src="/demos.js"></script></body></html>`;
}

const kindLabel = (m: Member): string =>
  m.kind === 'contractor' ? 'Contractor' : m.kind === 'service' ? 'Service account' : 'Staff';

export function people(v: Viewer, flash?: string, error?: string): string {
  const o = org(v.realm);
  const leaving = o.people.filter((m) => m.accessEnds && !expired(m));
  const gone = o.people.filter(expired);

  return shell('People', v, `
  ${flash ? `<div class="card"><div class="note note-info"><strong>Done</strong>${esc(flash)}</div></div>` : ''}
  ${error ? `<div class="card"><div class="note note-warn"><strong>Not done</strong>${esc(error)}</div></div>` : ''}

  <section class="card">
    <h2>Someone rings the service desk</h2>
    <p class="sub">They say they are Marcus in Sales, they are locked out, and they have a
      client call in ten minutes. At most companies this works.</p>
    <button class="btn-primary" type="button" data-demo="desk">Take the call</button>
    <p class="dim" style="margin-top:10px">About thirty seconds.</p>
  </section>

  <section class="card">
    <h2>People</h2>
    <p class="sub">Everyone with access, and when it ends.</p>
    <table class="ledger"><tbody>
      ${o.people.filter((m) => !expired(m)).map((m) => `<tr>
        <td class="t-desc">
          <strong>${esc(m.name)}</strong> <span class="dim">${esc(kindLabel(m))} · ${esc(m.team)}</span><br>
          <span class="dim">${m.grants.length ? esc(m.grants.join(' · ')) : 'no grants'}</span>
        </td>
        <td class="t-amt">
          ${m.accessEnds ? `<span class="dim">ends ${esc(when(m.accessEnds))}</span>` : '<span class="dim">permanent</span>'}
          <br><a class="plain" href="/access/people/${esc(m.id)}">Open</a>
        </td>
      </tr>`).join('')}
    </tbody></table>
  </section>

  <section class="card">
    <h2>Leaving soon</h2>
    ${leaving.length === 0 ? '<p class="sub">Nobody scheduled.</p>' : `<table class="ledger"><tbody>
      ${leaving.map((m) => `<tr><td class="t-desc"><strong>${esc(m.name)}</strong><br>
        <span class="dim">${esc(m.grants.join(' · ') || 'no grants')}</span></td>
        <td class="t-amt"><span class="dim">${esc(when(m.accessEnds!))}</span></td></tr>`).join('')}
    </tbody></table>`}
    ${gone.length ? `<div class="note note-info" style="margin-top:18px">
      <strong>Lapsed · ${gone.length}</strong>
      ${gone.map((m) => esc(m.name)).join(', ')}. no account left behind.</div>` : ''}
  </section>

  <section class="card">
    <h2>Add a contractor</h2>
    <p class="sub">They bring their own identity; nothing is provisioned.</p>
    <form method="post" action="/access/contractors" class="bank-form">
      <label for="name">Name</label><input type="text" id="name" name="name" placeholder="Dan Whitfield" required>
      <label for="days">Access for</label><input type="text" id="days" name="days" value="21" required>
      <label for="grant">Grant</label><input type="text" id="grant" name="grant" value="Treasury · read-only" required>
      <button class="btn-ghost" type="submit">Add contractor</button>
    </form>
  </section>

  <section class="card">
    <h2>Governance approvals</h2>
    <p class="sub">Queued until a quorum approves in their enclave.</p>
    <div id="gov-list"></div>
    <p class="sub" id="gov-status" style="margin-top:12px"></p>
    <div class="note note-warn" id="gov-error" hidden></div>
    <script src="/governance.bundle.js"></script>
  </section>

  <section class="card">
    <h2>Elevated access</h2>
    <p class="sub">Time-boxed; lapses on its own.</p>
    ${o.elevations.map((e) => {
      const mins = remaining(e);
      return `<div class="appr" style="margin-bottom:10px">
        <div class="appr-who">${esc(e.who)} · ${esc(e.scope)}</div>
        <div class="appr-meta">${esc(e.reason)}</div>
        <div class="appr-meta">${e.approvedAt
          ? mins > 0
            ? `approved by ${esc(e.approvedBy!)} · <strong>${mins} minute${mins === 1 ? '' : 's'} remaining</strong>`
            : `approved by ${esc(e.approvedBy!)} · <strong>expired</strong>`
          : 'awaiting approval'}</div>
        ${!e.approvedAt ? `<form method="post" action="/access/elevations/${esc(e.id)}/approve" style="margin-top:10px">
          <button class="btn-ghost" type="submit">Approve</button></form>` : ''}
      </div>`;
    }).join('')}
    <form method="post" action="/access/elevations" class="bank-form" style="margin-top:16px">
      <label for="scope">Scope</label><input type="text" id="scope" name="scope" value="Production database · read/write" required>
      <label for="reason">Reason</label><input type="text" id="reason" name="reason" placeholder="INC-2214" required>
      <label for="minutes">Minutes</label><input type="text" id="minutes" name="minutes" value="30" required>
      <button class="btn-ghost" type="submit">Request elevation</button>
    </form>
  </section>`, { href: '/', label: 'Portal' });
}

/** The record with nothing in it, and the call the service desk cannot act on. */
export function member(v: Viewer, id: string): string {
  const m = org(v.realm).people.find((x) => x.id === id);
  if (!m) return shell('Not found', v, '<section class="card"><h2>No such person</h2></section>', { href: '/access', label: 'People' });

  return shell(m.name, v, `
  <section class="card">
    <h2>${esc(m.name)}</h2>
    <p class="sub">${esc(kindLabel(m))} · ${esc(m.team)}</p>

    <div class="kv"><dl>
      <dt>Identity</dt><dd>held by ${esc(m.name.split(' ')[0])}, attested across the Tide network</dd>
      <dt>Credentials</dt><dd>none stored</dd>
      <dt>Sessions</dt><dd>${m.sessions} active</dd>
      <dt>Access ends</dt><dd>${m.accessEnds ? esc(when(m.accessEnds)) : 'permanent'}</dd>
      <dt>Grants</dt><dd>${m.grants.length ? esc(m.grants.join(' · ')) : 'none'}</dd>
    </dl></div>

    <h3 class="sec">Service desk actions</h3>
    <div class="desk">
      <div class="desk-row"><span>Reset password</span><em>not available, nothing is stored</em></div>
      <div class="desk-row"><span>Reset MFA</span><em>not available</em></div>
      <div class="desk-row"><span>Issue temporary login</span><em>not available</em></div>
      <div class="desk-row live"><span>End all sessions</span>
        <form method="post" action="/access/people/${esc(m.id)}/sessions/end">
          <button class="btn-ghost" type="submit">End ${m.sessions}</button></form></div>
    </div>
    <p class="sub" style="margin-top:14px">Ending sessions is all the desk can do. It cannot let anyone in.</p>
  </section>`, { href: '/access', label: 'People' });
}
