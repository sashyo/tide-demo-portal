import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';

import { config } from './config.js';
import { logoutUrl, rolesFromAccessToken, verifyAccessTokenClaims } from './oidc.js';
import { destroy, session } from './session.js';
import { all as allTenants, get as getTenant, save as saveTenant, type Adapter } from './tenants.js';
import { landing, loginPage, problem, setupPage, signedIn, signedOut, type DemoApp } from './views.js';
import { getPolicy } from './clinic/policy.js';
import { treasury, treasuryPolicy } from './treasury/routes.js';
import { access } from './access/routes.js';
import { services } from './services/routes.js';
import { support } from './support/routes.js';
import { clinic } from './clinic/routes.js';

const app = express();

// Behind Cloudflare this must be set, or `secure` cookies are dropped and X-Forwarded-Proto is
// ignored. Directly exposed it must stay 0, or callers can spoof their address.
app.set('trust proxy', config.trustProxy);
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The Tide DPoP approval iframe.
 *
 * During a DPoP login the Tide IdP tells the ORK enclave to load an iframe FROM THE CLIENT'S
 * OWN ORIGIN, at `<origin>/tide_dpop/iss/<hex>/aud/<hex>/tide_dpop_auth.html`. TideCloak's own
 * clients get this served by Keycloak; everyone else has to serve it themselves. Not serving
 * it is a 404 inside the enclave, which is what "page not found" during approval means.
 *
 * The asset is byte-identical to the one the IdP ships (its pinned script/style hashes were
 * recomputed from this copy and match), and the headers below reproduce what the IdP sends:
 *
 *   - `frame-ancestors *` / `Allow-CSP-From: *` — the enclave, on a different origin, must be
 *     able to FRAME this page. Our global policy says `frame-ancestors 'none'`, which blocks
 *     it; the enclave then falls back to a popup window. Registered before helmet so that
 *     global policy never applies here.
 *   - hash-pinned `script-src`/`style-src` — the page's own inline script and style, so
 *     allowing the frame does not mean allowing arbitrary injected script.
 */
app.get('/tide_dpop/iss/:iss/aud/:aud/tide_dpop_auth.html', (req, res) => {
  // Only serve it for this portal's own realm/client, so it cannot be pointed at another.
  const decode = (hex: string) => {
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2) return null;
    return Buffer.from(hex, 'hex').toString('utf8');
  };
  const iss = decode(String(req.params.iss));
  const aud = decode(String(req.params.aud));
  const known = iss && aud && [...allTenants()].some(
    (t) => `${t.authServerUrl}/realms/${t.realm}` === iss && t.clientId === aud,
  );
  if (!known) return res.status(400).type('text/plain').send('Invalid issuer or audience');

  // Logged because this is the ONLY externally visible sign that the enclave attempted the
  // approval step at all. No hit here means the IdP never sent the browser to it, which is a
  // completely different problem from the iframe running and failing.
  console.log(`[tide_dpop] approval iframe requested at ${new Date().toISOString()} iss=${iss} aud=${aud} ua=${(req.get('user-agent') ?? '').slice(0, 60)}`);

  res.setHeader('Allow-CSP-From', '*');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'sha256-utc6UrebuHOyLd/2aiMXS/p1EDy9UZBDe/XEMKDw9Mc='; " +
      "style-src 'self' 'sha256-F7OJTdJYct4J+cQfuJUoDauitndqt8pAc8EbA8gwDPU='; " +
      'frame-ancestors *',
  );
  res.removeHeader('X-Frame-Options');
  res.type('text/html; charset=utf-8').sendFile(path.join(here, '..', 'public', 'tide', 'tide_dpop_auth.html'));
});

app.use(
  helmet({
    /**
     * COOP MUST BE OFF for the Tide enclave to work.
     *
     * helmet defaults to `Cross-Origin-Opener-Policy: same-origin`, which puts this page in its
     * own browsing-context group and SEVERS window.opener for any cross-origin popup. The Tide
     * enclave opens on the ORK origin and messages back to us, so with COOP on it finds
     * window.opener === null and dies inside its own bundle with
     *
     *   TypeError: Cannot read properties of null (reading 'postMessage')
     *       at sendMessage -> _init -> create
     *
     * which reports as a network error and names nothing about COOP. It is the same failure
     * whether or not the popup was user-initiated, which is what makes it easy to misread as a
     * popup-blocker problem.
     */
    crossOriginOpenerPolicy: false,
    // Likewise: the enclave loads resources across origins, and same-origin CORP blocks them.
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        // The browser does the token exchange itself now, so it must be allowed to POST to
        // the tenant's TideCloak origin. Without this the exchange is blocked by CSP with a
        // console error and no server-side trace at all.
        connectSrc: ["'self'", config.tidecloakOrigins(), config.orkOrigins()].flat(),
        // The SDK frames TWO different origins: the ORK for the enclave, and TideCloak itself
        // for its session-check iframe. Omitting the TideCloak origin blocks initIAM with
        // "Timeout when waiting for 3rd party check iframe message" — which names an iframe but
        // not the policy that blocked it.
        frameSrc: ["'self'", config.orkOrigins(), config.tidecloakOrigins()].flat(),
        childSrc: ["'self'", config.orkOrigins(), config.tidecloakOrigins()].flat(),
        // The sign-in redirect leaves for the tenant's own TideCloak realm.
        formAction: ["'self'", '*'],
        // 'self', not 'none'. The SDK's silent session check loads
        // /silent-check-sso.html in a hidden iframe on THIS origin; frame-ancestors 'none'
        // blocks that, the check times out, every page load looks logged out, and the login
        // redirect loops. (The Tide approval iframe route sets its own frame-ancestors * before
        // this policy runs, so it is unaffected either way.)
        frameAncestors: ["'self'"],
      },
    },
  }),
);
// Log every request: a loop like the setup one is obvious in a request log and nearly
// invisible without it.
app.use((req, _res, next) => {
  if (!req.path.endsWith('.js') && !req.path.endsWith('.css')) {
    console.log(`[req] ${req.method} ${req.originalUrl}`);
  }
  next();
});
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '16kb' }));
/**
 * silent-check-sso.html, at whatever path the SDK asks for.
 *
 * It derives silentCheckSsoRedirectUri from the redirect URI's PATH, so a page at
 * /onboard/setup asks for /onboard/silent-check-sso.html. Each page is now its own redirect
 * target, so that path varies per page — serving the file only at the root gives a 404 and a
 * silent-check timeout everywhere else.
 */
app.get(/silent-check-sso\.html$/, (_req, res) => {
  res
    .type('html')
    .send('<html><body><script>parent.postMessage(location.href, location.origin)</script></body></html>');
});

app.use(express.static(path.join(here, '..', 'public')));

const REDIRECT_URI = `${config.portalUrl}/auth/redirect`;

function apps(): DemoApp[] {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(config.appsFile), 'utf8')) as DemoApp[];
  } catch {
    return [];
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * Client-side diagnostics.
 *
 * A page that navigates away takes its console with it, so a browser-side failure in a redirect
 * loop is invisible from here. This turns it into a server log line.
 */
app.post('/api/client-log', (req, res) => {
  const { level, message, detail } = req.body ?? {};
  console.log(`[client:${String(level ?? 'info')}] ${String(message ?? '').slice(0, 300)}`
    + (detail ? ` :: ${String(detail).slice(0, 600)}` : ''));
  res.json({ ok: true });
});

/**
 * The realm's tidecloak.json, served to the other demo apps.
 *
 * Sibling demo apps do not need to know anything about provisioning — they ask this portal
 * for the config of the realm the visitor is using and wire themselves up from it. Public
 * config only: realm, auth server URL, client id, the realm's PUBLIC signing key, vendor id
 * and home ORK URL. No secret, which is why this needs no auth.
 */
app.get('/api/realms/:realm/tidecloak.json', (req, res) => {
  const tenant = getTenant(String(req.params.realm));
  if (!tenant) return res.status(404).json({ error: 'Unknown realm' });
  res.type('application/json').send(JSON.stringify(tenant.adapter, null, 2));
});

/** Which realm this browser is using, so a sibling app can ask "who am I set up for?". */
app.get('/api/me', (req, res) => {
  const s = session(req, res);
  const tenant = s.realm ? getTenant(s.realm) : undefined;
  res.json({
    realm: tenant?.realm ?? null,
    clientId: tenant?.clientId ?? null,
    signedIn: Boolean(s.user),
    adapterUrl: tenant ? `${config.portalUrl}/api/realms/${tenant.realm}/tidecloak.json` : null,
  });
});

// --- Landing -----------------------------------------------------------------------------
app.get('/', (req, res) => {
  const s = session(req, res);
  // An invite whose redirect points at the root rather than /onboard/complete still carries the
  // job id, so honour it rather than showing a landing page to someone who has just linked.
  if (typeof req.query.job === 'string' && req.query.job) {
    return res.redirect(`/onboard/complete?job=${encodeURIComponent(req.query.job)}`);
  }
  const tenant = s.realm ? getTenant(s.realm) : undefined;

  if (!tenant) return res.send(landing(apps(), req.query.unknown ? `No workspace named "${String(req.query.unknown).slice(0, 40)}" here.` : undefined));

  const unsigned = [
    getPolicy(tenant.realm, 'clinic') ? null : 'clinical notes',
    getPolicy(tenant.realm, 'payment') ? null : 'payment approvals',
  ].filter(Boolean) as string[];

  if (!s.user) return res.send(signedOut(tenant, apps(), undefined, unsigned));
  return res.send(signedIn(tenant, s, apps(), unsigned));
});

// --- Onboarding --------------------------------------------------------------------------
/**
 * Hand the visitor to the provisioner, telling it who we are.
 *
 * app_url  becomes the new realm's client redirect URI — so it must be THIS portal, or the
 *          sign-in below would be rejected as an unregistered redirect.
 * return_to is where the provisioner sends them back; it appends ?job=&realm= so we can
 *          fetch the adapter afterwards.
 */
app.get('/onboard', (req, res) => {
  session(req, res);
  const u = new URL(`${config.provisionerUrl}/`);
  u.searchParams.set('app_url', config.portalUrl);
  u.searchParams.set('return_to', `${config.portalUrl}/onboard/complete`);
  res.redirect(u.toString());
});

/**
 * Back from the provisioner, with a realm that is already finished.
 *
 * The grant is NOT done here. It belongs to the provisioner, which owns realm creation, and it
 * has already run by the time this is reached: the invite returns to the provisioner's own
 * /linked, which completes phase B and only then forwards here.
 *
 * That ordering is what keeps setup to a single login prompt. Granting tide-realm-admin
 * regenerates the user contexts, and the ORKs sign a JWT from the context they re-derive
 * rather than from what an app sends, so a token minted before the grant describes a user who
 * is not an admin and cannot sign a Forseti policy. Refreshing it does not reliably help. This
 * app briefly granted for itself here, which worked but put realm construction in the wrong
 * service and made the seam harder to reason about.
 */
app.get('/onboard/complete', async (req, res) => {
  const s = session(req, res);
  const jobId = String(req.query.job ?? '');
  if (!jobId) {
    return res.status(400).send(problem('Missing job reference', 'The provisioner did not pass a job id back, so there is no way to look up the new realm.'));
  }

  try {
    const jobRes = await fetch(`${config.provisionerUrl}/api/realms/jobs/${encodeURIComponent(jobId)}`);
    if (!jobRes.ok) throw new Error(`provisioner returned ${jobRes.status}`);
    const job = (await jobRes.json()) as { status: string; adapter?: Adapter; realm: string };

    if (!job.adapter) {
      return res.status(409).send(
        problem(
          'Workspace is not ready yet',
          `"${job.realm}" is still being built. Give it a moment and reload.`,
        ),
      );
    }

    const tenant = saveTenant(job.adapter);
    s.realm = tenant.realm;
    s.setupJob = jobId;
    s.user = undefined;
    console.log(`[onboard] realm ${tenant.realm} registered (client ${tenant.clientId})`);

    /* Straight to the signing page unless there is genuinely nothing to sign.
     *
     * This used to key off job.status === 'ready', which meant "phase B is done". That was a
     * reasonable proxy while the app granted tide-realm-admin itself, because the job was
     * still mid-flight on arrival. The provisioner finishes phase B before handing over now,
     * so the status is ALWAYS ready here, and the check sent every new workspace to the
     * landing page to read "one step left" instead of to the step.
     *
     * The honest question is whether the policies are signed, so ask that. */
    const signed = Boolean(getPolicy(tenant.realm, 'clinic')) && Boolean(getPolicy(tenant.realm, 'payment'));
    if (signed) return res.redirect('/');

    res.redirect('/onboard/setup');
  } catch (err) {
    console.error('[onboard]', err);
    res.status(502).send(problem('Could not fetch your realm configuration', String((err as Error).message)));
  }
});

/** The one-approval setup page: sign the encryption policy, then finalize. */
/**
 * The signing ceremony, re-enterable.
 *
 * Deliberately does NOT require a live provisioning job. Setup can be interrupted — a declined
 * approval, a closed tab, a transient 503 from TideCloak — and without a way back the realm is
 * left half-configured with no route to finish it.
 */
app.get('/onboard/setup', (req, res) => {
  const s = session(req, res);
  if (!s.realm) return res.redirect('/');
  res.send(setupPage(s.realm));
});

app.get('/onboard/setup-config', (req, res) => {
  const s = session(req, res);
  const tenant = s.realm ? getTenant(s.realm) : undefined;
  if (!tenant) return res.status(404).json({ error: 'No realm selected.' });
  res.json({
    adapter: tenant.adapter,
    realm: tenant.realm,
    // Only a realm mid-provisioning still needs the admin grant at the end.
    needsFinalize: Boolean(s.setupJob),
    clinicSigned: Boolean(getPolicy(tenant.realm, 'clinic')),
    paymentSigned: Boolean(getPolicy(tenant.realm, 'payment')),
  });
});

/** Grants tide-realm-admin and flips the realm. Called last, on purpose. */
app.post('/onboard/finalize', async (req, res) => {
  const s = session(req, res);
  // Re-running the ceremony on an already-finalised realm is legitimate; there is simply no
  // grant left to make.
  if (!s.setupJob) return res.json({ status: 'ready', skipped: true });
  try {
    const r = await fetch(
      `${config.provisionerUrl}/api/realms/jobs/${encodeURIComponent(s.setupJob)}/finalize`,
      { method: 'POST' },
    );
    const out = (await r.json()) as any;
    if (r.ok && out.status === 'ready') {
      if (out.adapter) saveTenant(out.adapter as Adapter);
      s.setupJob = undefined;
    }
    res.status(r.status).json(out);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// --- Sign in -----------------------------------------------------------------------------
/**
 * Sign in. One flow, the SDK's.
 *
 * The previous implementation ran its own PKCE + DPoP exchange here. Two flows on one origin
 * produced two sessions, and the Tide enclave — which belongs to the SDK — rejected whichever
 * doken did not match its session key. That was the cause of the setup redirect loop and of
 * being signed out mid-encrypt.
 */
app.get('/login', (req, res) => {
  const s = session(req, res);
  const next = typeof req.query.next === 'string' && req.query.next.startsWith('/')
    ? req.query.next
    : '/';
  if (!s.realm || !getTenant(s.realm)) return res.redirect('/');
  res.send(loginPage(next));
});

/**
 * Establish the portal session from tokens the SDK obtained.
 *
 * The server still decides what the session means: the access token is VERIFIED against the
 * realm's published keys before any role is believed. There is no `state`/nonce check here
 * because this is no longer our redirect flow to police — the SDK completed it, and an
 * unverified token would be worthless regardless of who fetched it.
 */
app.post('/api/session', async (req, res) => {
  const s = session(req, res);
  const tenant = s.realm ? getTenant(s.realm) : undefined;
  if (!tenant) return res.status(409).json({ error: 'No realm selected.' });

  const accessToken = String(req.body?.access_token ?? '');
  const idToken = String(req.body?.id_token ?? '');
  if (!accessToken) return res.status(400).json({ error: 'No access token supplied.' });

  try {
    const roles = await rolesFromAccessToken(tenant, accessToken);
    const claims = await verifyAccessTokenClaims(tenant, accessToken);

    s.user = {
      sub: String(claims.sub ?? ''),
      username: claims.preferred_username as string | undefined,
      name: claims.name as string | undefined,
      email: claims.email as string | undefined,
      vuid: claims.vuid as string | undefined,
      tideUserKey: claims.tideuserkey as string | undefined,
    };
    s.roles = roles;
    s.idToken = idToken || undefined;
    console.log(`[api/session] ${s.user.sub} roles: ${roles.join(', ') || '(none)'}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/session]', err);
    res.status(401).json({ error: `Token rejected: ${(err as Error).message}` });
  }
});

app.post('/logout', async (req, res) => {
  const s = session(req, res);
  const tenant = s.realm ? getTenant(s.realm) : undefined;
  const idToken = s.idToken;
  const realm = s.realm;
  destroy(req, res);

  if (tenant && idToken) {
    try {
      // Come back to a session that still remembers the realm, so the user lands on
      // "sign in" rather than being asked to provision a second one.
      return res.redirect(await logoutUrl(tenant, idToken, `${config.portalUrl}/after-logout?realm=${encodeURIComponent(realm!)}`));
    } catch { /* fall through to a local logout */ }
  }
  res.redirect('/');
});

app.get('/after-logout', (req, res) => {
  const s = session(req, res);
  const realm = String(req.query.realm ?? '');
  if (getTenant(realm)) s.realm = realm;
  res.redirect('/');
});

/**
 * Attach this browser to a realm that already exists.
 *
 * A realm name is not a credential, and this grants nothing on its own: the visitor still has
 * to complete a full OIDC sign-in against that realm with a Tide identity that belongs to it.
 * All this does is tell the portal which realm's tidecloak.json to use.
 */
app.post('/use', (req, res) => {
  const s = session(req, res);
  const realm = String(req.body?.realm ?? '').trim().toLowerCase();
  const tenant = getTenant(realm);
  if (!tenant) return res.redirect(`/?unknown=${encodeURIComponent(realm)}`);
  s.realm = tenant.realm;
  s.user = undefined;
  res.redirect('/');
});

/** Forget this browser's realm without deleting it, so a demo can be run again. */
app.get('/switch', (req, res) => {
  destroy(req, res);
  res.redirect('/');
});

app.use('/treasury', treasuryPolicy);
app.use('/treasury', treasury);
app.use('/access', access);
app.use('/services', services);
app.use('/support', support);
app.use('/clinic', clinic);


app.use((_req, res) => res.status(404).send(problem('Not found', 'That page does not exist.')));

app.listen(config.port, () => {
  console.log(`tide-demo-portal listening on :${config.port}`);
  const derived = config.codespaceUrl !== null && config.portalUrl === config.codespaceUrl;
  console.log(`  Portal URL:  ${config.portalUrl}${derived ? '  (derived from CODESPACE_NAME)' : ''}`);
  if (config.inCodespace && !derived) {
    // An explicit PORTAL_URL overrides the forwarded address. That is legitimate behind a
    // tunnel, and fatal if it is a leftover: the realm gets built around this value.
    console.warn(`  !! PORTAL_URL overrides the Codespace address ${config.codespaceUrl}`);
  }
  console.log(`  Provisioner: ${config.provisionerUrl}`);
  console.log(`  Redirect:    ${REDIRECT_URI}`);

  // In a Codespace the provisioner is remote by definition, so a localhost default here means
  // PROVISIONER_URL was never set. Say so at boot: the alternative is the visitor filling in
  // the create-workspace form and waiting for a connection that was never going to succeed.
  if (config.inCodespace && /localhost|127\.0\.0\.1/.test(config.provisionerUrl)) {
    console.warn('\n  !! PROVISIONER_URL still points at localhost, and nothing is listening there.');
    console.warn('     Set it to the hosted provisioner in .devcontainer/devcontainer.json,');
    console.warn('     then rebuild the container. See CODESPACES.md.\n');
  }
  if (config.inCodespace) {
    console.log(`\n  Port ${config.port} must be set to Public in the Ports panel, or the`);
    console.log('  sign-in redirect lands on a GitHub login page instead of this app.\n');
  }
});
