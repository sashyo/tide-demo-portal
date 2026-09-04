import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * One record per realm a visitor has provisioned through this portal.
 *
 * The adapter (tidecloak.json) is entirely public config — realm name, auth server URL,
 * client id, the realm's PUBLIC signing key, vendor id and home ORK URL. There is no secret
 * in it, which is why it is safe to fetch from the provisioner over an unauthenticated
 * endpoint and safe to keep in a plain file.
 */
export type Adapter = {
  realm: string;
  'auth-server-url': string;
  resource: string;
  'public-client'?: boolean;
  jwk?: unknown;
  vendorId?: string;
  homeOrkUrl?: string;
  [k: string]: unknown;
};

export type Tenant = {
  realm: string;
  clientId: string;
  authServerUrl: string;
  adapter: Adapter;
  createdAt: string;
};

const file = path.resolve(config.tenantsFile);
let tenants = new Map<string, Tenant>();

// A flat JSON file, so a demo survives a restart without standing up a database. Swap for
// a real store if this ever holds more than demo realms.
try {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Tenant[];
  tenants = new Map(raw.map((t) => [t.realm, t]));
} catch {
  // No file yet, or unreadable: start empty rather than refusing to boot.
}

function persist(): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...tenants.values()], null, 2));
}

/**
 * Where this realm's tidecloak.json is written, so a downstream demo app can consume it as a
 * plain file the way a normal Tide app ships one — rather than every app reimplementing the
 * provisioner handshake.
 */
export function adapterPath(realm: string): string {
  return path.resolve('data', 'realms', realm, 'tidecloak.json');
}

export function save(adapter: Adapter): Tenant {
  const tenant: Tenant = {
    realm: adapter.realm,
    clientId: adapter.resource,
    authServerUrl: String(adapter['auth-server-url']).replace(/\/+$/, ''),
    adapter,
    createdAt: new Date().toISOString(),
  };
  tenants.set(tenant.realm, tenant);
  persist();

  // Also drop it on disk as a real tidecloak.json. No secret in it (public key, client id,
  // vendor id, home ORK URL), so it is safe to sit in a file and safe to serve.
  const file = adapterPath(tenant.realm);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(adapter, null, 2));

  return tenant;
}

export function get(realm: string): Tenant | undefined {
  return tenants.get(realm);
}

export function all(): Tenant[] {
  return [...tenants.values()];
}

export function count(): number {
  return tenants.size;
}
