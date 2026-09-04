/**
 * Marrindale Services: the BYOiD demo.
 *
 * The first version of this showed one sign-in working across three agencies, which is
 * exactly what "sign in with Google" already does, so it demonstrated the misconception
 * rather than the mechanism. BYOiD is not federated login. It is threshold password
 * authentication: the password is checked across independent nodes, none of which learns it,
 * and no password hash is stored anywhere.
 *
 * That claim is checkable, so this demo checks it in front of the visitor instead of
 * asserting it. The identity page reads the realm's own user record live and shows what the
 * credential store actually holds.
 */
import { AGENCIES, uses, type AgencyId } from './store.js';

/** What the realm's identity store holds, read live. Null when it could not be read. */
export type IdentityRecord = {
  credentials: { type: string; createdDate: number | null }[];
  hasPassword: boolean;
  totp: boolean;
  disableableCredentialTypes: string[];
  requiredActions: string[];
  vuid: string | null;
  tideUserKey: string | null;
  federatedIdentities: { identityProvider: string | null }[];
};

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
    <h2>Three agencies. Nothing to steal.</h2>
    <p class="sub">You have no account at any of these, and none of them holds a password.
      Use them, then look at what they actually store.</p>
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
    <a class="btn-link" href="/services/identity" style="margin-top:20px;display:block">
      <button class="btn-primary" type="button">Show me what Marrindale stores about me</button></a>
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

/**
 * The centre of this demo: the realm's own answer to "what do you hold for this person".
 *
 * Read live from the identity store through the provisioner, because a demo that PRINTS
 * "no password stored" is worth nothing. The visitor has seen that sentence on the website
 * of every service that later leaked its password database.
 */
export function identityPage(v: Viewer, rec: IdentityRecord | null, flash?: string): string {
  const mine = uses(v.realm, v.person.sub);

  const record = rec === null
    ? `<div class="note note-warn"><strong>Could not read the record</strong>
        The identity store did not answer. Nothing is being claimed here that was not read.</div>`
    : `<pre class="dump">${esc(JSON.stringify({
        credentials: rec.credentials,
        totp: rec.totp,
        disableableCredentialTypes: rec.disableableCredentialTypes,
        requiredActions: rec.requiredActions,
      }, null, 2))}</pre>
      <div class="note ${rec.hasPassword ? 'note-err' : 'note-info'}">
        <strong>${rec.hasPassword ? 'A password credential IS stored' : 'No password credential'}</strong>
        ${rec.hasPassword
          ? 'This realm is holding a password. That is not a Tide realm, or something reset it.'
          : 'The store holds a Tide Authorization Key and nothing else. There is no hash, no salt and no reset token, because there is no password here to protect.'}
      </div>`;

  return shell('Your identity', v, `
  ${flash ? `<div class="card"><div class="note note-info"><strong>Done</strong>${esc(flash)}</div></div>` : ''}

  <section class="card">
    <h2>Take the database</h2>
    <p class="sub">This is Marrindale's entire credential record for you, read from the
      identity store just now. Not a description of it.</p>
    ${record}
  </section>

  <section class="card">
    <h2>What that row would normally be</h2>
    <p class="sub">The same record in a conventional system, and what leaks when it does.</p>
    <pre class="dump dump-bad">${esc(`credentials: [
  {
    "type": "password",
    "hashIterations": 210000,
    "secretData": "{\"value\":\"kQ9x…\",\"salt\":\"7cF2…\"}",
    "credentialData": "{\"algorithm\":\"pbkdf2-sha512\"}"
  },
  { "type": "otp", "secretData": "{\"value\":\"JBSWY3DPEH…\"}" }
]`)}</pre>
    <div class="note note-warn">
      <strong>Offline from the moment it leaves</strong>
      A stolen hash is guessed on the thief's own hardware, at their own pace, with no rate
      limit and nobody watching. The reuse across other sites is what turns one breach into
      several. Rotating it means every user changing their password.
    </div>
  </section>

  <section class="card">
    <h2>So what is checking the password?</h2>
    <p class="sub">Independent nodes, none of which sees it.</p>
    <ul class="discloses">
      <li>Your password never leaves the browser as a password</li>
      <li>Several nodes each apply one share of the check</li>
      <li>None of them, and no server, ever holds enough to verify it alone</li>
      <li>So there is no single place a password database could exist</li>
    </ul>
    <div class="note note-info">
      <strong>This is not "sign in with Google"</strong>
      Federated login moves the password to somebody else, who still stores a hash and can
      still sign in as you. Here there is no such party. The identity is yours and no vendor
      holds anything that can impersonate you.
    </div>
  </section>

  ${rec && rec.vuid ? `<section class="card">
    <h2>The identifier Marrindale got</h2>
    <pre class="dump">${esc(rec.vuid)}</pre>
    <p class="sub">A different vendor is given a different identifier for the same person, so
      two vendors comparing records cannot tell you are one human. You are looking at one
      vendor's, which is all this page is in a position to show you.</p>
  </section>` : ''}

  <section class="card">
    <h2>Where you have been</h2>
    ${mine.length === 0
      ? '<p class="sub">You have not used a service yet.</p>'
      : mine.map((u) => {
          const a = AGENCIES.find((x) => x.id === u.agency)!;
          return `<div class="appr" style="margin-bottom:12px">
            <div class="appr-who">${esc(a.icon)} ${esc(a.name)}</div>
            <div class="appr-meta">first used ${esc(when(u.firstUsed))}</div>
            <div class="appr-meta">told: ${esc(a.discloses.join(' \u00b7 '))}</div>
            <form method="post" action="/services/consent/${esc(u.agency)}/revoke" style="margin-top:10px">
              <button class="btn-ghost" type="submit">Revoke</button></form>
          </div>`;
        }).join('')}
  </section>`, { href: '/services', label: 'Services' });
}
