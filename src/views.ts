import type { Tenant } from './tenants.js';
import type { Session } from './session.js';

export type DemoApp = { name: string; blurb: string; url: string | null; icon: string };

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * The signed-in person's avatar.
 *
 * Deliberately unlike the simulated colleagues in replay.js: those get a saturated hue and a
 * coloured title bar, this is a neutral outlined chip on the product ground. When a colleague's
 * window is on screen, the two must be tellable apart at a glance — otherwise a staged approval
 * reads as your own.
 *
 * The hue is derived from the subject claim, so a given person keeps the same colour across
 * apps without anything being stored. It picks from a fixed wheel rather than the full 360:
 * a free hash can land on violet, which is off the palette.
 */
function avatar(name: string, sub: string): string {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const WHEEL = [202, 172, 148, 96, 42, 18, 352, 322];
  let n = 0;
  for (const ch of sub) n = (n * 31 + ch.charCodeAt(0)) % 4093;
  n = WHEEL[n % WHEEL.length];
  return `<span class="me" title="${esc(name)}">
    <span class="me-dot" style="--mh:${n}">${esc(initials)}</span>
    <span class="me-name">${esc(name)}</span>
  </span>`;
}

function page(title: string, body: string, me?: { name: string; sub: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='0' fill='%230d4ec4'/%3E%3Ctext x='16' y='23' font-family='system-ui,sans-serif' font-size='19' font-weight='900' fill='white' text-anchor='middle'%3ED%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="wrap">
  <div class="mast">
    <div class="mark" aria-hidden="true">D</div>
    <div style="flex:1">
      <h1>Demo portal</h1>
      <div class="host">Secured by Tide</div>
    </div>
    ${me ? avatar(me.name, me.sub) : ''}
  </div>
${body}
  <p class="foot">Each visitor gets their own workspace · <a href="https://tide.org" target="_blank" rel="noopener noreferrer">Tide</a></p>
</div>
</body>
</html>`;
}

function appGrid(apps: DemoApp[], unlocked: boolean): string {
  if (apps.length === 0) {
    return `<div class="note note-warn"><strong>No demo apps configured</strong>
      Add them to <code>data/demo-apps.json</code>. Each needs a name, blurb and url.</div>`;
  }
  return `<div class="apps">${apps
    .map((a) => {
      const live = unlocked && a.url;
      const tag = live
        ? `<a class="app" href="${esc(a.url)}">`
        : `<div class="app${unlocked ? '' : ' locked'}">`;
      const close = live ? '</a>' : '</div>';
      const state = !unlocked ? 'Locked' : a.url ? 'Open' : 'Coming soon';
      return `${tag}
        <div class="app-icon" aria-hidden="true">${esc(a.icon)}</div>
        <div class="app-body">
          <div class="app-name">${esc(a.name)}</div>
          <div class="app-blurb">${esc(a.blurb)}</div>
        </div>
        <div class="app-state">${state}</div>
      ${close}`;
    })
    .join('')}</div>`;
}

/** Nobody has a realm yet. */
export function landing(apps: DemoApp[], error?: string): string {
  return page(
    'Demo portal',
    `<section class="card">
    <h2>Try these apps with your own identity</h2>
    <p class="sub">You get your own private workspace, with your own users, roles and keys. Nobody else can see
       inside it, and neither can we.</p>
    <a class="btn-link" href="/onboard"><button class="btn-primary" type="button">Create my workspace</button></a>
    <p class="sub" style="margin-top:14px">About two minutes.</p>

    <div class="kv">
      <form method="post" action="/use">
        <label for="realm">Already have a workspace?</label>
        <div class="inline-form">
          <input type="text" id="realm" name="realm" placeholder="my-realm" spellcheck="false"
                 autocapitalize="off" autocorrect="off" required>
          <button class="btn-ghost" type="submit">Use it</button>
        </div>
        ${error ? `<div class="err">${esc(error)}</div>` : ''}
      </form>
    </div>
  </section>

  <section class="card">
    <h2>The apps</h2>
    <p class="sub">Unlocked once you've created a workspace and signed in.</p>
    ${appGrid(apps, false)}
  </section>`,
  );
}

/** Realm exists, not signed in. */
/** Prompt to finish (or redo) the signing ceremony. */
function unsignedBanner(unsigned: string[]): string {
  if (unsigned.length === 0) return '';
  // Not "incomplete". Nothing is broken: the workspace is built and this is the step that was
  // always going to happen here, so saying it failed sends people looking for a fault.
  return `<div class="note note-info">
    <strong>One step left</strong>
    The ${esc(unsigned.join(' and '))} ${unsigned.length > 1 ? 'policies' : 'policy'} still
    need signing before the apps can encrypt or approve anything.
    <p style="margin-top:12px"><a class="btn-link" href="/onboard/setup"><button class="btn-ghost" type="button">Sign the policies</button></a></p>
  </div>`;
}

export function signedOut(tenant: Tenant, apps: DemoApp[], error?: string, unsigned: string[] = []): string {
  return page(
    'Sign in. Demo portal',
    `<section class="card">
    <h2>Welcome back</h2>
    <p class="sub">Your workspace is ready. Sign in with the Tide account you linked.</p>
    ${error ? `<div class="note note-err"><strong>Sign-in failed</strong>${esc(error)}</div>` : ''}
    ${unsignedBanner(unsigned)}
    <a class="btn-link" href="/login"><button class="btn-primary" type="button">Sign in with Tide</button></a>
    <div class="kv">
      <dl>
        <dt>Workspace</dt><dd>${esc(tenant.realm)}</dd>
        <dt>Client</dt><dd>${esc(tenant.clientId)}</dd>
        <dt>Issuer</dt><dd>${esc(tenant.authServerUrl)}/realms/${esc(tenant.realm)}</dd>
      </dl>
    </div>
    <p style="margin-top:18px"><a href="/switch" class="plain">Use a different workspace</a></p>
  </section>

  <section class="card">
    <h2>The apps</h2>
    <p class="sub">Sign in to unlock.</p>
    ${appGrid(apps, false)}
  </section>`,
  );
}

/** Signed in. */
export function signedIn(tenant: Tenant, s: Session, apps: DemoApp[], unsigned: string[] = []): string {
  const u = s.user ?? { sub: '' };
  const display = u.name || u.username || u.email || 'Your Tide identity';
  return page(
    'Demo portal',
    `<section class="card">
    <div class="meta">
      <div>
        <h2>You're in</h2>
        <p class="sub" style="margin:0">Workspace <strong>${esc(tenant.realm)}</strong> as ${esc(display)}.</p>
      </div>
      <span class="badge ok">Verified</span>
    </div>
    <div class="kv" style="border-top:none;margin-top:6px;padding-top:0">
      <dl>
        <dt>Subject</dt><dd>${esc(u.sub)}</dd>
        ${u.vuid ? `<dt>vuid</dt><dd>${esc(u.vuid)}</dd>` : ''}
        ${u.tideUserKey ? `<dt>Tide user key</dt><dd>${esc(u.tideUserKey.slice(0, 48))}…</dd>` : ''}
      </dl>
    </div>
    ${dpopPanel(s)}
    ${unsignedBanner(unsigned)}
    <form method="post" action="/logout" style="margin-top:20px">
      <button class="btn-ghost" type="submit">Sign out</button>
    </form>
  </section>

  <section class="card">
    <h2>The apps</h2>
    <p class="sub">Open any of these. They all share your workspace identity.</p>
    ${appGrid(apps, true)}
  </section>`,
    { name: display, sub: String(u.sub) },
  );
}

/** Sender-constrained token, stated once. Detail lives in the code, not on screen. */
function dpopPanel(s: Session): string {
  const d = s.dpopProof;
  if (!d) return '';
  const ok = d.boundTo && d.boundTo === d.thumbprint && d.userinfoOk;
  return `<div class="note ${ok ? 'note-info' : 'note-warn'}">
    <strong>${ok ? 'Token bound to this device' : 'Token binding unconfirmed'}</strong>
    A copy of this session's token is useless anywhere else.
  </div>`;
}

/** Sign-in page: the SDK does the work, the server verifies the result. */
export function loginPage(next: string): string {
  return page(
    'Signing you in',
    `<section class="card">
    <h2>Signing you in</h2>
    <p class="sub" id="status">Starting…</p>
    <div class="note note-err" id="err" hidden></div>
  </section>
  <script src="/login.bundle.js"></script>`,
  );
}

export function problem(title: string, message: string, backHref = '/'): string {
  return page(
    title,
    `<section class="card">
    <h2>${esc(title)}</h2>
    <div class="note note-err"><strong>What went wrong</strong>${esc(message)}</div>
    <p style="margin-top:20px"><a class="btn-link" href="${esc(backHref)}"><button class="btn-ghost" type="button">Back to the portal</button></a></p>
  </section>`,
  );
}

/**
 * Initialisation — a developer surface, not the product.
 *
 * The demo apps are metallic, coloured and sans-serif; this is neutral, monospaced and flat, so
 * nobody mistakes an irreversible admin ceremony for a step in the app. Light only, like
 * everything else here.
 */
export function setupPage(realm: string): string {
  return `<!doctype html>
<html lang="en" data-app="dev">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>init · ${esc(realm)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23fbfbfc' stroke='%23d2d5da'/%3E%3Ctext x='16' y='22' font-size='16' font-weight='700' fill='%231f6feb' text-anchor='middle' font-family='monospace'%3E%26gt;%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/dev.css">
</head>
<body>
<div class="dev-wrap">
  <div class="dev-top">
    <span class="sig">&gt;</span>
    <h1>workspace init</h1>
    <span class="tag">developer</span>
  </div>
  <p class="dev-lede">Last step. The workspace itself is built; this signs the policies that
    govern encryption and approvals, which needs your Tide account and so has to happen here
    rather than in the provisioner.</p>

  <dl class="dev-facts">
    <dt>workspace</dt><dd>${esc(realm)}</dd>
    <dt>client</dt><dd>${esc(realm)}-client</dd>
    <dt>mode</dt><dd>firstAdmin</dd>
  </dl>

  <ol class="dev-plan">
    <li id="s-link" data-state="done">link tide account</li>
    <li id="s-admin" data-state="done">grant tide-realm-admin <em>irreversible</em></li>
    <li id="s-contract" data-state="todo">publish forseti contracts <em>REST</em></li>
    <li id="s-policy" data-state="todo">sign policy: medical <em>IMPLICIT/PRIVATE</em></li>
    <li id="s-payment" data-state="todo">sign policy: payment <em>EXPLICIT/PRIVATE</em></li>
  </ol>

  <div class="dev-log" id="log"></div>
  <p id="status" hidden></p>

  <div class="dev-actions">
    <button class="primary" id="begin" type="button" hidden>Sign policies</button>
    <button id="continue" type="button" hidden>Skip and finish</button>
  </div>

  <div class="dev-note err" id="err" hidden></div>
  <p class="dev-foot"><a href="/">&larr; portal</a></p>
</div>
<script src="/setup.bundle.js"></script>
</body></html>`;
}
