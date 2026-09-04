import { AGENCIES, uses, type AgencyId } from './store.js';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export type Viewer = { realm: string; person: { sub: string; name: string } };

type Back = { href: string; label: string };

function shell(title: string, v: Viewer, body: string, back: Back): string {
  return `<!doctype html><html lang="en" data-app="services"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Marrindale Services</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230d4ec4'/%3E%3Ctext x='16' y='23' font-size='18' font-weight='900' fill='white' text-anchor='middle' font-family='system-ui'%3EM%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/treasury.css"></head><body>
<div class="wrap">
  <div class="mast"><div class="mark" aria-hidden="true">M</div>
    <div style="flex:1"><h1>Marrindale Services</h1>
      <div class="host">${esc(v.person.name)} · no account created</div></div>
    <a href="${esc(back.href)}" class="back"><span aria-hidden="true">&larr;</span> ${esc(back.label)}</a></div>
  ${body}
</div></body></html>`;
}

export function directory(v: Viewer, flash?: string): string {
  const mine = uses(v.realm, v.person.sub);
  return shell('Services', v, `
  ${flash ? `<div class="card"><div class="note note-info"><strong>Done</strong>${esc(flash)}</div></div>` : ''}
  <section class="card">
    <h2>Services</h2>
    <p class="sub">Three agencies. No accounts, no linking codes.</p>
    <div class="apps">
      ${AGENCIES.map((a) => {
        const used = mine.find((u) => u.agency === a.id);
        return `<a class="app" href="/services/${esc(a.id)}">
          <div class="app-icon" aria-hidden="true">${esc(a.icon)}</div>
          <div class="app-body">
            <div class="app-name">${esc(a.name)}</div>
            <div class="app-blurb">${esc(a.blurb)}</div>
          </div>
          <div class="app-state">${used ? 'Known' : 'Open'}</div>
        </a>`;
      }).join('')}
    </div>
    <p style="margin-top:20px"><a class="plain" href="/services/consent">What each agency knows about you</a></p>
  </section>`, { href: '/', label: 'Portal' });
}

export function agencyPage(v: Viewer, id: AgencyId, done?: string): string {
  const a = AGENCIES.find((x) => x.id === id)!;
  const mine = uses(v.realm, v.person.sub).find((u) => u.agency === id);

  return shell(a.name, v, `
  <section class="card">
    <h2>${esc(a.icon)} ${esc(a.name)}</h2>
    <p class="sub">${esc(a.blurb)}</p>

    ${mine
      ? `<div class="note note-info"><strong>Already known here</strong>${esc(mine.result)}</div>`
      : `<div class="note note-info"><strong>First time here</strong>No account to create.</div>`}

    <h3 class="sec">What this agency will be told</h3>
    <ul class="discloses">
      ${a.discloses.map((d) => `<li>${esc(d)}</li>`).join('')}
    </ul>
    <p class="sub">Nothing else.</p>

    ${done ? `<div class="note note-info"><strong>Done</strong>${esc(done)}</div>` : `
    <form method="post" action="/services/${esc(id)}" style="margin-top:20px">
      <button class="btn-primary" type="submit">${esc(a.action)}</button>
    </form>`}
  </section>`, { href: '/services', label: 'Services' });
}

export function consent(v: Viewer, flash?: string): string {
  const mine = uses(v.realm, v.person.sub);
  return shell('Your identity', v, `
  ${flash ? `<div class="card"><div class="note note-info"><strong>Done</strong>${esc(flash)}</div></div>` : ''}
  <section class="card">
    <h2>What each agency knows</h2>
    ${mine.length === 0
      ? '<p class="sub">You have not used any service yet.</p>'
      : mine.map((u) => {
          const a = AGENCIES.find((x) => x.id === u.agency)!;
          return `<div class="appr" style="margin-bottom:12px">
            <div class="appr-who">${esc(a.icon)} ${esc(a.name)}</div>
            <div class="appr-meta">first used ${esc(when(u.firstUsed))}</div>
            <div class="appr-meta">told: ${esc(a.discloses.join(' · '))}</div>
            <form method="post" action="/services/consent/${esc(u.agency)}/revoke" style="margin-top:10px">
              <button class="btn-ghost" type="submit">Revoke</button></form>
          </div>`;
        }).join('')}

    <div class="note note-warn" style="margin-top:20px">
      <strong>Why the lists differ</strong>
      Each agency was told only what its own job needed.
    </div>
  </section>`, { href: '/services', label: 'Services' });
}
