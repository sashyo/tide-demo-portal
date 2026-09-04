import 'dotenv/config';
import crypto from 'node:crypto';

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}
function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v?.trim()) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${v}`);
  return n;
}

const port = int('PORT', 8090);

/**
 * The public origin of a GitHub Codespace, or null when we are not in one.
 *
 * A Codespace forwards each port to a generated https hostname that nobody can know ahead of
 * time, so PORTAL_URL cannot be committed. Getting it wrong is not a cosmetic problem: this
 * value is registered as the new realm's redirect URI, and a realm whose only registered
 * redirect points at localhost cannot be signed into from the forwarded URL at all. The
 * realm has to be recreated.
 *
 * `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` is normally `app.github.dev`. Both variables are
 * set by the platform; if either is missing we are not in a Codespace and say so by
 * returning null rather than guessing a hostname.
 */
function codespaceOrigin(): string | null {
  const name = process.env.CODESPACE_NAME?.trim();
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN?.trim();
  if (!name || !domain) return null;
  return `https://${name}-${port}.${domain}`;
}

const codespace = codespaceOrigin();

export const config = {
  port,

  /** True inside a Codespace. Read by the startup banner and the docs it prints. */
  inCodespace: codespace !== null,

  /**
   * The origin a Codespace would forward this port to, whether or not it is being used.
   * PORTAL_URL still wins when set, so this exists to tell the banner which of the two the
   * running config actually came from.
   */
  codespaceUrl: codespace,

  /**
   * This portal's own public origin. It is registered as the new realm's redirect URI, so
   * it must be the URL a browser actually reaches — not localhost, once deployed. A wrong
   * value produces realms whose clients reject this app's callback.
   */
  portalUrl: optional('PORTAL_URL', codespace ?? `http://localhost:${port}`).replace(/\/+$/, ''),

  /** Where visitors go to create a realm. */
  provisionerUrl: optional('PROVISIONER_URL', 'http://localhost:8081').replace(/\/+$/, ''),

  /**
   * Signs the session cookie. Generated per boot when unset, which is fine for a demo but
   * logs everyone out on restart — set it in production.
   */
  sessionSecret: optional('SESSION_SECRET', crypto.randomBytes(32).toString('hex')),

  /**
   * Cookies go secure+SameSite=Lax once served over https.
   *
   * Defaults to on inside a Codespace, whose forwarded URL is always https. Left off there,
   * the browser would happily accept the cookie but the portal would keep issuing it without
   * the Secure flag over an https origin, which some browsers now reject outright.
   */
  secureCookies: optional('SECURE_COOKIES', codespace ? 'true' : '') === 'true',

  /**
   * Number of proxies in front of this service. 1 behind Cloudflare.
   *
   * Without it Express sees the tunnel's connection rather than the client's, treats the
   * request as plain http, and REFUSES to set a `secure` cookie — so the session silently
   * never persists and every page looks signed out.
   */
  trustProxy: int('TRUST_PROXY', codespace ? 1 : 0),

  /**
   * Origins the page is allowed to call — the TideCloak instances hosting tenants' realms.
   * Comma-separated; defaults to the provisioner's own instance.
   */
  tidecloakOrigins(): string[] {
    return optional('TIDECLOAK_ORIGINS', 'https://login.dauth.me')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },

  /**
   * ORK origins the page must be able to reach and frame.
   *
   * The Tide enclave runs on the ORK, and the SDK both calls it and frames it. Without these in
   * connect-src and frame-src the enclave silently fails to open — a CSP violation in the
   * console and nothing at all in any server log.
   */
  orkOrigins(): string[] {
    return optional('ORK_ORIGINS', 'https://ork1.tideprotocol.com')
      .split(',').map((s) => s.trim()).filter(Boolean);
  },

  tenantsFile: optional('TENANTS_FILE', 'data/tenants.json'),
  appsFile: optional('DEMO_APPS_FILE', 'data/demo-apps.json'),
} as const;
