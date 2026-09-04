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
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/treasury.css"><link rel="stylesheet" href="/breach.css"><link rel="stylesheet" href="/signup.css"></head><body>
<div class="wrap">
  <div class="mast"><div class="mark" aria-hidden="true">M</div>
    <div style="flex:1"><h1>Marrindale Services</h1>
      <div class="host">${esc(v.person.name)} · no account created</div></div>
    <a href="${esc(back.href)}" class="back"><span aria-hidden="true">&larr;</span> ${esc(back.label)}</a></div>
  ${body}
</div><script src="/breach.js"></script><script src="/signup.js"></script></body></html>`;
}

export function directory(v: Viewer, flash?: string): string {
  const mine = uses(v.realm, v.person.sub);
  return shell('Services', v, `
  ${flash ? `<div class="card"><div class="note note-info"><strong>Done</strong>${esc(flash)}</div></div>` : ''}
  <section class="card">
    <h2>Three agencies. No accounts anywhere.</h2>
    <p class="sub">You never signed up for any of these, and not one of them keeps a password
      for you. Use one, then go and see what they are actually holding.</p>
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
    <div class="cta-pair">
      <button class="btn-primary" type="button" data-signup data-service="Marrindale Health">
        Watch someone open one of these for the first time</button>
      <a class="plain" href="/services/identity">Or see what they keep about you</a>
    </div>
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
/**
 * The centre of this demo, written for somebody who has never heard of a hash.
 *
 * An earlier version led with the raw credential record. That proves the point to a
 * developer and loses everyone else, and "no password is stored" is a sentence the visitor
 * has already read on the website of every service that later leaked its password database.
 *
 * So it leads with the thing they DO recognise: a stolen database, side by side, theirs and
 * a normal one. The real record is still there, one click down, because the argument only
 * works if it can be checked.
 */
export function identityPage(v: Viewer, rec: IdentityRecord | null, flash?: string): string {
  const mine = uses(v.realm, v.person.sub);
  const who = v.person.name;

  const unreadable = `<div class="note note-warn"><strong>Could not read the file</strong>
      Marrindale's identity store did not answer just now, so nothing on this page was read
      from it. Nothing is being claimed that was not checked.</div>`;

  const stolen = rec === null ? unreadable : `
    <div class="steal">
      <div class="steal-side steal-bad">
        <div class="steal-head">A normal service</div>
        <dl class="steal-rec">
          <dt>Name</dt><dd>${esc(who)}</dd>
          <dt>Email</dt><dd>j.denes@example.com</dd>
          <dt>Password</dt><dd class="steal-hash">$2b$12$eR9xK7pQ2mVt0aZ.uY4</dd>
          <dt>Backup code</dt><dd class="steal-hash">JBSWY3DPEHPK3PXP</dd>
        </dl>
        <p class="steal-note">That scrambled password is still your password. A thief takes it
          home and works on it for as long as they like, with nobody watching. If you used
          that password anywhere else, they have that too.</p>
      </div>
      <div class="steal-side steal-good">
        <div class="steal-head">Marrindale <span class="steal-live">read just now</span></div>
        <dl class="steal-rec">
          <dt>Name</dt><dd>${esc(who)}</dd>
          <dt>Email</dt><dd>j.denes@example.com</dd>
          <dt>Password</dt><dd class="steal-none">${rec.hasPassword ? 'stored' : 'none. not stored here'}</dd>
          <dt>Backup code</dt><dd class="steal-none">${rec.totp ? 'stored' : 'none. not stored here'}</dd>
        </dl>
        <p class="steal-note">There is nothing to unscramble, nothing to try on your other
          accounts, and nothing for you to reset. The thief has your name and your email,
          which is the same as reading it off an envelope.</p>
        <p class="steal-note steal-prov">The password and backup lines were read from
          Marrindale's real store. The name and email are here so the two files line up.</p>
      </div>
    </div>`;

  return shell('Your identity', v, `
  ${flash ? `<div class="card"><div class="note note-info"><strong>Done</strong>${esc(flash)}</div></div>` : ''}

  <section class="card">
    <h2>Someone steals Marrindale's files tonight</h2>
    <p class="sub">Watch the same thief run the same attack twice: once on an ordinary service,
      then on this one.</p>
    ${rec === null ? unreadable : `<button class="btn-primary" type="button" data-breach
      data-has-password="${rec.hasPassword}" data-totp="${rec.totp}"
      data-service="Marrindale">Steal the database</button>
    <p class="dim" style="margin-top:10px">Takes about half a minute. Nothing real is attacked.</p>`}
  </section>

  <section class="card">
    <h2>What the thief walked away with</h2>
    <p class="sub">Your file at an ordinary service, and your file here.</p>
    ${stolen}
  </section>

  <section class="card">
    <h2>Then how do you get in?</h2>
    <p class="sub">You still type a password. It just never gets kept anywhere.</p>
    <ol class="plainsteps">
      <li><span>1</span>You type your password, and it stays in your browser.</li>
      <li><span>2</span>Several separate computers each check one piece of it.</li>
      <li><span>3</span>None of them ever sees the whole thing, so none of them can keep it.</li>
      <li><span>4</span>There is no one place holding passwords, so there is no password
        database to steal. Not from Marrindale, and not from us.</li>
    </ol>
    <div class="note note-info">
      <strong>It is not "sign in with Google" either</strong>
      That just moves your password to a bigger company, which still keeps one and can still
      sign in as you. Here nobody keeps one, including Tide.
    </div>
  </section>

  ${rec && rec.vuid ? `<section class="card">
    <h2>What Marrindale calls you</h2>
    <p class="sub">Not your name. Just a number, and only this agency's copy of it.</p>
    <div class="idchip">${esc(rec.vuid.slice(0, 8))}<span>${esc(rec.vuid.slice(8, 20))}...</span></div>
    <p class="sub" style="margin:14px 0 0">The next service you use is given a completely
      different number for you. If the two ever compared lists, they could not work out that
      you are the same person.</p>
  </section>` : ''}

  ${rec ? `<section class="card">
    <details>
      <summary class="plain">Do not take our word for it. Show the real record.</summary>
      <p class="sub" style="margin:14px 0 10px">Read from Marrindale's identity store when this
        page loaded. <code>credentials</code> is where a password would be.</p>
      <pre class="dump">${esc(JSON.stringify({
        credentials: rec.credentials,
        totp: rec.totp,
        disableableCredentialTypes: rec.disableableCredentialTypes,
        requiredActions: rec.requiredActions,
      }, null, 2))}</pre>
      ${rec.hasPassword ? `<div class="note note-err"><strong>A password IS stored here</strong>
        That should not happen on a Tide realm. Something reset it.</div>` : ''}
    </details>
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
