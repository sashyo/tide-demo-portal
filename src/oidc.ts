import crypto from 'node:crypto';
import * as jose from 'jose';
import { fetchWithDpop, proof, type DpopKey } from './dpop.js';
import type { Tenant } from './tenants.js';

/**
 * OIDC authorization-code + PKCE against a tenant's own realm.
 *
 * TWO THINGS THAT BITE HERE, both specific to TideCloak:
 *
 * 1. Tide realms sign tokens with **EdDSA (Ed25519)**, not RS256. Node's `jsonwebtoken` has
 *    no EdDSA support at all, so the usual verify library silently is not an option — hence
 *    `jose`, which does. Anything pinned to RS256 401s on every request.
 *
 * 2. The client is PUBLIC (no secret), so the code exchange carries PKCE instead. The
 *    verifier must be kept server-side between /login and /auth/redirect.
 *
 * 3. Tide realms require **DPoP**. Every token request carries a proof signed by a key this
 *    session holds, and the issued access token is bound to that key. Without a proof the
 *    token endpoint answers 400 "DPoP proof is missing" — so DPoP is not optional here, and
 *    the key must outlive the redirect (it lives in the session).
 */

export type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  jwks_uri: string;
  issuer: string;
};

const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();

export async function discover(tenant: Tenant): Promise<Discovery> {
  const url = `${tenant.authServerUrl}/realms/${tenant.realm}/.well-known/openid-configuration`;
  const hit = discoveryCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.doc;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed for realm ${tenant.realm}: ${res.status}`);
  const doc = (await res.json()) as Discovery;
  discoveryCache.set(url, { at: Date.now(), doc });
  return doc;
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Build the authorization URL.
 *
 * `dpop_jkt` is NOT optional on a Tide realm, and leaving it off fails in a way that points
 * nowhere near the cause. Tide does not accept a self-asserted DPoP key: when the
 * authorization request advertises a key thumbprint, the Tide IdP diverts the user through
 * an ORK enclave step where their Tide identity APPROVES that specific key, recording a
 * `tideDPoPApproval` auth-session note. The token endpoint then requires that approval to
 * exist. Present a DPoP proof at /token without having advertised the key up front and the
 * server throws:
 *
 *   java.lang.RuntimeException: DPoPApproval required if dpop key passed
 *
 * which surfaces to the client as a bare 500 "unknown_error ... consult the server log".
 * MEASURED on login.dauth.me, 2026-09-02.
 *
 * So the DPoP key must exist BEFORE the redirect, not at exchange time — which is why the
 * key is generated in /login and carried in the session. This is the same thing tidecloak-js
 * does (`params.append('dpop_jkt', thumbprint)`); `secureFetch` is a separate, later concern
 * — it adds proofs to RESOURCE requests once you already hold a bound token.
 */
export async function authorizeUrl(
  tenant: Tenant,
  redirectUri: string,
  state: string,
  challenge: string,
  nonce: string,
  dpopKey: DpopKey,
): Promise<string> {
  const doc = await discover(tenant);
  const u = new URL(doc.authorization_endpoint);
  u.searchParams.set('client_id', tenant.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid profile email');
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  // Advertise the key the eventual token must be bound to, so the enclave can approve it.
  u.searchParams.set('dpop_jkt', dpopKey.thumbprint);
  return u.toString();
}

export type Tokens = { access_token: string; id_token: string; refresh_token?: string; token_type?: string };

export async function exchange(
  tenant: Tenant,
  code: string,
  redirectUri: string,
  verifier: string,
  dpopKey: DpopKey,
): Promise<Tokens> {
  const doc = await discover(tenant);
  const res = await fetchWithDpop(dpopKey, doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: tenant.clientId,
      code_verifier: verifier,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    // A 500 here says only "consult the server log", so log everything on our side that
    // could be correlated against that log: exact time, endpoint, and any tracing headers
    // the server returned.
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (/trace|request|correlat|x-|dpop/i.test(k)) headers[k] = v;
    });
    console.error(
      [
        '',
        '─── TOKEN EXCHANGE FAILED ───────────────────────────────',
        `  at            ${new Date().toISOString()}`,
        `  endpoint      ${doc.token_endpoint}`,
        `  realm         ${tenant.realm}`,
        `  client_id     ${tenant.clientId}`,
        `  redirect_uri  ${redirectUri}`,
        `  DPoP key      EdDSA/Ed25519 thumbprint ${dpopKey.thumbprint}`,
        `  status        ${res.status} ${res.statusText}`,
        `  headers       ${JSON.stringify(headers)}`,
        `  body          ${text.slice(0, 600)}`,
        '─────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as Tokens;
}

/**
 * Prove the access token really is bound to our key, by spending it at /userinfo with a
 * matching proof. If the binding were wrong this 401s — which makes it a genuine check that
 * DPoP is working, not just that the exchange happened to succeed.
 */
export async function userinfo(
  tenant: Tenant,
  accessToken: string,
  dpopKey: DpopKey,
): Promise<Record<string, unknown>> {
  const doc = await discover(tenant);
  const endpoint = `${tenant.authServerUrl}/realms/${tenant.realm}/protocol/openid-connect/userinfo`;
  const res = await fetchWithDpop(dpopKey, endpoint, { method: 'GET' }, accessToken);
  const text = await res.text();
  if (!res.ok) throw new Error(`userinfo failed (${res.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** The thumbprint the server bound the token to, read back from the access token. */
export function boundThumbprint(accessToken: string): string | undefined {
  try {
    const claims = jose.decodeJwt(accessToken) as { cnf?: { jkt?: string } };
    return claims.cnf?.jkt;
  } catch {
    return undefined;
  }
}

/** Verify an ID token against the realm's published keys. EdDSA, per the note above. */
export async function verifyIdToken(
  tenant: Tenant,
  idToken: string,
  nonce: string,
): Promise<jose.JWTPayload> {
  const doc = await discover(tenant);
  let jwks = jwksCache.get(doc.jwks_uri);
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(doc.jwks_uri));
    jwksCache.set(doc.jwks_uri, jwks);
  }

  const { payload } = await jose.jwtVerify(idToken, jwks, {
    issuer: doc.issuer,
    audience: tenant.clientId,
  });

  // Binds this token to the login we started, so a token minted for a different request
  // cannot be replayed into this session.
  if (payload.nonce !== nonce) throw new Error('ID token nonce mismatch');
  return payload;
}

/**
 * Read the realm roles out of an ACCESS token, after verifying it.
 *
 * Roles are not in the ID token. Keycloak's "realm roles" and "client roles" mappers ship with
 * `access.token.claim: true` and `id.token.claim` unset, so `realm_access.roles` only ever
 * appears on the access token. Reading them from the ID token yields an empty list on a realm
 * where every role is correctly assigned — which surfaces as "this realm has no roles" and
 * sends you looking at the realm instead of at the claim source. MEASURED on login.dauth.me.
 *
 * The token is verified, not merely decoded: an unverified access token is attacker-supplied
 * text, and these roles are the app's entire authority model.
 */
export async function rolesFromAccessToken(tenant: Tenant, accessToken: string): Promise<string[]> {
  const doc = await discover(tenant);
  let jwks = jwksCache.get(doc.jwks_uri);
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(doc.jwks_uri));
    jwksCache.set(doc.jwks_uri, jwks);
  }
  // Audience is deliberately not pinned here: Keycloak access tokens carry a mix of the client
  // and "account", and the issuer plus signature are what establish this realm minted it.
  const { payload } = await jose.jwtVerify(accessToken, jwks, { issuer: doc.issuer });
  const roles = (payload as any)?.realm_access?.roles;
  return Array.isArray(roles) ? roles.filter((r) => typeof r === 'string') : [];
}

/** Verify an access token and return its claims. Same verification as the roles reader. */
export async function verifyAccessTokenClaims(
  tenant: Tenant, accessToken: string,
): Promise<jose.JWTPayload> {
  const doc = await discover(tenant);
  let jwks = jwksCache.get(doc.jwks_uri);
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(doc.jwks_uri));
    jwksCache.set(doc.jwks_uri, jwks);
  }
  const { payload } = await jose.jwtVerify(accessToken, jwks, { issuer: doc.issuer });
  return payload;
}

export async function logoutUrl(tenant: Tenant, idToken: string, returnTo: string): Promise<string> {
  const doc = await discover(tenant);
  if (!doc.end_session_endpoint) return returnTo;
  const u = new URL(doc.end_session_endpoint);
  u.searchParams.set('id_token_hint', idToken);
  u.searchParams.set('post_logout_redirect_uri', returnTo);
  return u.toString();
}
