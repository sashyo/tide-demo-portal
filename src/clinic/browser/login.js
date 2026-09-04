import { clientLog, IAMService, initTide } from './tide.js';

/**
 * The portal's one and only sign-in.
 *
 * This replaces a hand-rolled OIDC + PKCE + DPoP flow that ran alongside the Tide SDK. Two
 * flows on one origin each establish their own session and doken, and the enclave holds the
 * session key of whichever ran last — so the other one is met with
 *
 *   [ENCLAVE] sessionkey mismatch ... Session key mismatch between enclave and doken
 *
 * and the SDK responds by re-logging-in, which surfaces as a redirect loop or as being
 * silently signed out mid-action. There is no way to reconcile two sessions; there can only be
 * one, and it has to be the SDK's, because the enclave is the SDK's.
 *
 * The server still decides what the session means: it verifies the tokens and reads roles from
 * the access token. This page only obtains them.
 */
const $ = (id) => document.getElementById(id);
const say = (m) => { const e = $('status'); if (e) e.textContent = m; };

(async function () {
  const next = new URLSearchParams(location.search).get('next') || '/';
  try {
    say('Signing you in with Tide…');
    if (!(await initTide(location.pathname + location.search))) return;   // redirected

    const accessToken = await IAMService.getToken();
    const idToken = IAMService.getIDToken?.();
    if (!accessToken) throw new Error('Signed in, but no access token was returned.');

    say('Verifying…');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken, id_token: idToken }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? 'The server rejected the session.');

    location.replace(next.startsWith('/') ? next : '/');
  } catch (e) {
    clientLog('error', 'login failed: ' + (e?.message ?? e), e?.stack);
    say('');
    const box = $('err');
    if (box) { box.hidden = false; box.textContent = String(e?.message ?? e); }
  }
})();
