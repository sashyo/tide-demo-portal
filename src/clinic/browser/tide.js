import { IAMService } from '@tidecloak/js';

/**
 * Report a client-side event to the server.
 *
 * `keepalive` matters: these fire as the page is being torn down, and a normal fetch is
 * cancelled on unload — losing exactly the message that explains why.
 */
/**
 * Did this failure come from the enclave window being blocked?
 *
 * A blocked popup is not reported as such. The enclave opens, finds no window to talk to, and
 * dies inside its own bundle with "Cannot read properties of null (reading 'postMessage')" —
 * a null-pointer error that names nothing a user could act on.
 */
export function isPopupBlocked(err) {
  const msg = String(err?.message ?? err ?? '');
  return /postMessage|popup|window\.open|blocked/i.test(msg)
    && /null|undefined|blocked/i.test(msg);
}

/** Guidance that names the actual remedy, since the underlying error never does. */
export const POPUP_HELP =
  '<strong>Your browser blocked the Tide window</strong>' +
  'Tide opens its own window to take your approval, and the browser stopped it. ' +
  'Look for the blocked-popup icon at the right of the address bar, choose ' +
  '<em>Always allow pop-ups and redirects from this site</em>, then try again.';

export function clientLog(level, message, detail) {
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message: String(message), detail: detail ? String(detail) : undefined }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

// Anything that escapes a handler, plus the navigation itself, so a loop leaves a trail.
if (typeof window !== 'undefined' && !window.__tideDiag) {
  window.__tideDiag = true;
  window.addEventListener('error', (e) =>
    clientLog('error', 'uncaught: ' + (e?.message ?? ''), e?.error?.stack));
  window.addEventListener('unhandledrejection', (e) =>
    clientLog('error', 'unhandled rejection: ' + (e?.reason?.message ?? e?.reason ?? ''), e?.reason?.stack));
  window.addEventListener('pagehide', () =>
    clientLog('nav', 'leaving ' + location.pathname + ' -> ' + (window.__tideNextUrl ?? 'unknown')));
}

/**
 * Shared SDK bootstrap for every page that needs Tide directly.
 *
 * THE REDIRECT URI IS THE POINT OF THIS FILE. Left unset, the SDK logs in with
 *
 *   redirectUri: this._config["redirectUri"] ?? `${origin}/auth/redirect`
 *
 * and /auth/redirect is the portal's OWN callback for its hand-rolled OIDC flow. The SDK's
 * login therefore lands on a handler that finds no matching pending state and bounces to "/",
 * so the user sees "Starting Tide…" and is dropped back on the portal with no error anywhere.
 * Giving the SDK its own callback keeps the two flows from colliding.
 */
/**
 * Each page is its OWN redirect target.
 *
 * The adapter keeps tokens in memory, and its silent session check cannot restore them here:
 * check-sso runs a hidden prompt=none iframe, and this client requires DPoP, whose approval
 * happens in the Tide enclave — which cannot open inside a hidden frame. So a session never
 * survives a navigation, and any flow that logs in on page A and continues on page B loops
 * forever, each page believing it must start a fresh login.
 *
 * Returning to the SAME url means the login completes in one navigation: the adapter consumes
 * the code from the current address and the page carries on with a live session. Covered by the
 * client's registered `<appUrl>/*` pattern.
 */
const selfUrl = () => window.location.origin + window.location.pathname;

const ATTEMPT_KEY = 'tide_login_attempt';
const RELOGIN_KEY = 'tide_forced_relogin';

/**
 * Handle the enclave's "you must sign in again" signal.
 *
 * The request enclave raises requireReloginCallback when the session carries no valid enclave
 * approval, and the SDK answers it by calling login(). That does not help here: Tide's cookie
 * authenticator short-circuits on an existing client session —
 *
 *   if (!isTideUser || !isDPoPRequest || hasClientSession) { context.success(); return; }
 *
 * — and it reads the identity cookie directly, so it ignores prompt=login too. The login
 * therefore returns the same approval-less session, the enclave asks again, and the page loops
 * with no error anywhere.
 *
 * Ending the session first is what makes the next login a real authentication: with no cookie
 * there is no client session to short-circuit on, so the flow reaches the Tide IdP and the
 * enclave gets to approve the device key. Guarded so a persistent failure surfaces instead of
 * logging the user out repeatedly.
 */
export function handleEnclaveRelogin(tc) {
  let already = false;
  try { already = sessionStorage.getItem(RELOGIN_KEY) === '1'; } catch {}

  if (already) {
    try { sessionStorage.removeItem(RELOGIN_KEY); } catch {}
    throw new Error(
      'The Tide enclave still reports no approved session after a fresh sign-in. Nothing was ' +
      'changed. This usually means the account has not finished linking on this realm.',
    );
  }

  clientLog('nav', 'enclave demanded relogin — ending the session so the next login is real');
  try { sessionStorage.setItem(RELOGIN_KEY, '1'); } catch {}
  window.__tideNextUrl = 'logout-then-login';
  tc.logout({ redirectUri: selfUrl() });
}

export async function initTide(returnTo) {
  const cfg = await (await fetch('/clinic/api/adapter')).json();

  await IAMService.initIAM({
    ...cfg,
    // doLogin reads redirectUri from the CONFIG (buildInitOptions does not forward it), so
    // setting it here is what actually steers the return leg.
    redirectUri: selfUrl(),
    // The realm issues cnf.jkt-bound tokens, so DPoP is not optional here.
    useDPoP: { mode: 'strict', alg: 'ES256' },
    // NOTE: onLoad and silentCheckSsoRedirectUri are NOT forwarded — buildInitOptions
    // constructs its own option set and already hardcodes onLoad: "check-sso". Passing them
    // here has no effect; the return-to-self redirect above is what makes login work.
    checkLoginIframe: false,
  });

  if (IAMService.isLoggedIn()) {
    try {
      sessionStorage.removeItem(ATTEMPT_KEY);
      // A forced logout has now been followed by a real login; clear the guard so a later
      // enclave demand can act on it again.
      sessionStorage.removeItem(RELOGIN_KEY);
    } catch {}
    return true;
  }

  // Belt and braces: if a login was already attempted moments ago and we are STILL not logged
  // in, redirecting again just rebuilds the loop. Surface it instead.
  let last = 0;
  try { last = Number(sessionStorage.getItem(ATTEMPT_KEY) || 0); } catch {}
  if (last && Date.now() - last < 60_000) {
    try { sessionStorage.removeItem(ATTEMPT_KEY); } catch {}
    throw new Error(
      'Signed in with Tide, but this page still has no session. Rather than redirect again ' +
      '(which would loop), stopping here. Reload the page to retry.',
    );
  }

  try {
    sessionStorage.setItem(ATTEMPT_KEY, String(Date.now()));
    sessionStorage.setItem('tide_return', returnTo || location.pathname);
  } catch {}
  clientLog('nav', 'login from ' + location.pathname + ' redirectUri=' + selfUrl());
  window.__tideNextUrl = 'login';

  /**
   * prompt=login is REQUIRED, and IAMService.doLogin cannot send it.
   *
   * Tide's cookie authenticator short-circuits the IdP redirect when the requesting client
   * already has a session for this user:
   *
   *   if (!isTideUser || !isDPoPRequest || hasClientSession) { context.success(); return; }
   *
   * It skips even when a DPoP key was advertised, so the enclave is never asked to approve the
   * key and the token exchange then fails with "DPoPApproval required if dpop key passed".
   * The adapter reports that only as "not authenticated", so the page starts another login and
   * loops — with the code visibly arriving in the fragment each time.
   *
   * The invite link carries a client_id, so linking itself creates that client session: this is
   * reachable on the very first sign-in. Forcing a fresh authentication is the only way the flow
   * reaches the enclave, and it is correct on its own terms — the DPoP approval is per-login, so
   * a silently resumed session has nothing to approve the new device key with.
   *
   * doLogin() hardcodes its options, so go through the underlying client.
   */
  const client = IAMService.getTideCloakClient();
  if (client?.login) {
    client.login({ redirectUri: selfUrl(), prompt: 'login' });
  } else {
    clientLog('error', 'no Tide client available for login');
    IAMService.doLogin(returnTo || location.pathname);
  }
  return false;
}

export { IAMService };
