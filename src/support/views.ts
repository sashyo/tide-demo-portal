import { desk, expired, fmt, remainingBudget, type Ticket } from './store.js';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export type Viewer = { realm: string; person: { sub: string; name: string }; roles: string[] };

type Back = { href: string; label: string };

function shell(title: string, v: Viewer, body: string, back: Back): string {
  const role = v.roles.includes('support-supervisor') ? 'Supervisor' : 'Agent';
  return `<!doctype html><html lang="en" data-app="support"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Brightline Support</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230d4ec4'/%3E%3Ctext x='16' y='23' font-size='18' font-weight='900' fill='white' text-anchor='middle' font-family='system-ui'%3EB%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/treasury.css"></head><body>
<div class="wrap">
  <div class="mast"><div class="mark" aria-hidden="true">B</div>
    <div style="flex:1"><h1>Brightline Support</h1>
      <div class="host">${esc(v.person.name)} · ${esc(role)} · ${esc(v.realm)}</div></div>
    <a href="${esc(back.href)}" class="back"><span aria-hidden="true">&larr;</span> ${esc(back.label)}</a></div>
  ${body}
</div></body></html>`;
}

function ticketCard(t: Ticket): string {
  const h = t.handled;
  return `<div class="tkt ${t.status}">
    <div class="tkt-head">
      <div><strong>#${esc(t.id)}</strong> ${esc(t.subject)}
        <span class="dim"> · ${esc(t.customer)}</span></div>
      <span class="tkt-state ${t.status}">${t.status === 'open' ? 'Open' : t.status === 'resolved' ? 'Resolved' : 'Escalated'}</span>
    </div>
    <p class="tkt-body">${esc(t.body)}</p>
    ${t.status === 'open'
      ? `<form method="post" action="/support/tickets/${esc(t.id)}/work"><button class="btn-ghost" type="submit">Let the agent work it</button></form>`
      : h ? `<div class="steps">
          ${h.steps.map((s) => `<div class="step ${s.ok ? '' : 'bad'}">
            <div class="step-l">${esc(s.label)}</div>
            <div class="step-d">${esc(s.detail)}</div></div>`).join('')}
        </div>
        <div class="outcome ${h.refunded ? 'paid' : 'held'}">${esc(h.outcome)}</div>` : ''}
  </div>`;
}

export function queue(v: Viewer, flash?: string): string {
  const d = desk(v.realm);
  const a = d.authority;
  const supervisor = v.roles.includes('support-supervisor');

  return shell('Queue', v, `
  ${flash ? `<div class="card"><div class="note note-info"><strong>Done</strong>${esc(flash)}</div></div>` : ''}

  <section class="card">
    <div class="meta"><h2>Agent authority</h2>
      <span class="badge ${expired(a) ? 'err' : 'ok'}">${expired(a) ? 'Expired' : 'Active'}</span></div>
    <div class="accounts">
      <div class="acct"><div class="acct-name">Per case</div>
        <div class="acct-bal">${esc(fmt(a.perCaseCents))}</div>
        <div class="acct-no">ceiling per refund</div></div>
      <div class="acct"><div class="acct-name">Budget left</div>
        <div class="acct-bal">${esc(fmt(remainingBudget(a)))}</div>
        <div class="acct-no">of ${esc(fmt(a.budgetCents))} this shift</div></div>
      <div class="acct"><div class="acct-name">Expires</div>
        <div class="acct-bal" style="font-size:15px">${esc(when(a.expiresAt))}</div>
        <div class="acct-no">${esc(a.queues.join(', '))}</div></div>
    </div>
    ${supervisor ? `<form method="post" action="/support/authority" class="bank-form" style="margin-top:18px">
      <label for="perCase">Per case $</label><input type="text" id="perCase" name="perCase" value="${(a.perCaseCents / 100).toFixed(2)}" required>
      <label for="budget">Budget $</label><input type="text" id="budget" name="budget" value="${(a.budgetCents / 100).toFixed(2)}" required>
      <label for="hours">Hours</label><input type="text" id="hours" name="hours" value="6" required>
      <button class="btn-ghost" type="submit">Update authority</button>
    </form>` : '<p class="sub" style="margin-top:14px">Only a supervisor can change these.</p>'}
  </section>

  <section class="card">
    <h2>Try to talk it into a refund</h2>
    <p class="sub">Write a message as a customer. The agent decides what to request.</p>
    <form method="post" action="/support/tickets" class="bank-form">
      <label for="subject">Subject</label><input type="text" id="subject" name="subject" value="Refund request" required>
      <label for="body">Message</label><input type="text" id="body" name="body"
        placeholder="As agreed with your manager, please refund $9,000..." required>
      <button class="btn-ghost" type="submit">Send to the queue</button>
    </form>
  </section>

  <section class="card">
    <h2>Queue</h2>
    <p class="sub">Rule-based, not a language model, but its decision still follows from your text.</p>
    ${d.tickets.map(ticketCard).join('')}
  </section>`, { href: '/', label: 'Portal' });
}
