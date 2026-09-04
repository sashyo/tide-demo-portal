import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from './config.js';
import type { DpopKey } from './dpop.js';

/**
 * Server-side sessions keyed by a signed cookie.
 *
 * The ID token stays on the server rather than in the cookie: tokens carrying Tide claims
 * run to a couple of KB, and a cookie has 4KB total to spend. In memory, so a restart signs
 * everyone out — acceptable for a demo, and the realms themselves survive in tenants.json.
 */
export type Session = {
  realm?: string;
  /** Set between /login and /auth/redirect. */
  pending?: { state: string; verifier: string; nonce: string; realm: string };
  /**
   * The DPoP key this session's tokens are bound to. Server-side only and never serialised —
   * if it left the process the binding would stop meaning anything.
   */
  dpopKey?: DpopKey;
  /** Proof that the binding held: the thumbprint the realm recorded, and a userinfo call. */
  dpopProof?: { thumbprint: string; boundTo?: string; userinfoOk: boolean };
  user?: { sub: string; username?: string; name?: string; email?: string; vuid?: string; tideUserKey?: string };
  /** Realm roles from the verified token — the only source of authority in the demo apps. */
  roles?: string[];
  /** Where to go after sign-in, so a scanned QR lands on the page it was for. */
  next?: string;
  /** Set while a realm is mid-setup: the provisioner job still awaiting finalize. */
  setupJob?: string;
  idToken?: string;
  createdAt: number;
};

const SESSIONS = new Map<string, Session>();
const COOKIE = 'portal_sid';
const TTL_MS = 8 * 60 * 60 * 1000;

function sign(id: string): string {
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(id).digest('base64url');
  return `${id}.${mac}`;
}

function unsign(value: string): string | null {
  const idx = value.lastIndexOf('.');
  if (idx < 0) return null;
  const [id, mac] = [value.slice(0, idx), value.slice(idx + 1)];
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(id).digest('base64url');
  // Constant-time compare, so a forged cookie cannot be tuned byte by byte.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

export function session(req: Request, res: Response): Session {
  const raw = req.cookies?.[COOKIE];
  const id = raw ? unsign(raw) : null;

  if (id) {
    const existing = SESSIONS.get(id);
    if (existing && Date.now() - existing.createdAt < TTL_MS) return existing;
    if (existing) SESSIONS.delete(id);
  }

  const newId = crypto.randomBytes(24).toString('base64url');
  const fresh: Session = { createdAt: Date.now() };
  SESSIONS.set(newId, fresh);
  res.cookie(COOKIE, sign(newId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: TTL_MS,
    path: '/',
  });
  return fresh;
}

export function destroy(req: Request, res: Response): void {
  const raw = req.cookies?.[COOKIE];
  const id = raw ? unsign(raw) : null;
  if (id) SESSIONS.delete(id);
  res.clearCookie(COOKIE, { path: '/' });
}

// Evict expired sessions rather than growing forever.
setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, s] of SESSIONS) if (s.createdAt < cutoff) SESSIONS.delete(id);
}, 30 * 60 * 1000).unref();
