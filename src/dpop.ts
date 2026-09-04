import crypto from 'node:crypto';
import * as jose from 'jose';

/**
 * DPoP (RFC 9449) — sender-constrained tokens.
 *
 * The client holds a key pair and signs a fresh proof JWT for every request. The token the
 * server issues is bound to that key's thumbprint (`cnf.jkt`), so an access token lifted from
 * a log or a proxy is useless to anyone without the private key. Tide realms require this.
 *
 * Ed25519, matching what Tide signs with. The realm advertises EdDSA in
 * `dpop_signing_alg_values_supported`, so this is a supported choice, not a guess.
 */

export type DpopKey = {
  privateKey: jose.KeyLike;
  publicJwk: jose.JWK;
  /** JWK thumbprint — what the server records as cnf.jkt. */
  thumbprint: string;
};

export async function generateKey(): Promise<DpopKey> {
  const { privateKey, publicKey } = await jose.generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(publicKey);
  return {
    privateKey: privateKey as jose.KeyLike,
    publicJwk,
    thumbprint: await jose.calculateJwkThumbprint(publicJwk),
  };
}

/**
 * Build one proof.
 *
 * `htu` must be the bare endpoint — scheme, host and path only. A query string or fragment
 * left on it makes the server's comparison fail with a proof that otherwise looks correct.
 */
export async function proof(
  key: DpopKey,
  method: string,
  url: string,
  opts: { nonce?: string; accessToken?: string } = {},
): Promise<string> {
  const u = new URL(url);
  const htu = `${u.origin}${u.pathname}`;

  const payload: jose.JWTPayload = {
    jti: crypto.randomUUID(),
    htm: method.toUpperCase(),
    htu,
  };
  if (opts.nonce) payload.nonce = opts.nonce;
  // Binds the proof to the specific access token being presented, so a proof captured on one
  // request cannot be replayed alongside a different token.
  if (opts.accessToken) {
    payload.ath = crypto.createHash('sha256').update(opts.accessToken).digest('base64url');
  }

  return new jose.SignJWT(payload)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'EdDSA', jwk: key.publicJwk })
    .setIssuedAt()
    .sign(key.privateKey);
}

/**
 * POST with a DPoP proof, retrying once if the server demands a nonce.
 *
 * A server may reject the first proof with 400 `use_dpop_nonce` and supply a `DPoP-Nonce`
 * header; the correct response is to re-sign including that nonce and retry. Treating that
 * first 400 as a failure is the usual way a correct DPoP client still appears broken.
 */
export async function fetchWithDpop(
  key: DpopKey,
  url: string,
  init: RequestInit & { method: string },
  accessToken?: string,
): Promise<Response> {
  const send = async (nonce?: string) => {
    const headers = new Headers(init.headers);
    headers.set('DPoP', await proof(key, init.method, url, { nonce, accessToken }));
    if (accessToken) headers.set('Authorization', `DPoP ${accessToken}`);
    return fetch(url, { ...init, headers });
  };

  let res = await send();
  if (res.status === 400 || res.status === 401) {
    const nonce = res.headers.get('DPoP-Nonce');
    if (nonce) {
      const body = await res.clone().text();
      if (body.includes('use_dpop_nonce') || res.status === 401) return send(nonce);
    }
  }
  return res;
}
