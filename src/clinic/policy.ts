import fs from 'node:fs';
import path from 'node:path';
import { CLINIC_CONTRACT, computeContractId } from './contract.js';

/**
 * Server-side half of the Forseti setup.
 *
 * Everything here is scriptable. The one thing that is NOT is the VVK signature over the
 * policy — only an admin's browser enclave can produce it — so it arrives from the front end
 * and is stored here for every later encrypt and decrypt to use.
 */
export type PolicyKey = 'clinic' | 'payment';
export type StoredPolicy = {
  realm: string; key: PolicyKey; contractId: string; policyB64: string; signedAt: string;
};

const file = path.resolve('data', 'clinic-policies.json');
const policies = new Map<string, StoredPolicy>();
const idOf = (realm: string, key: PolicyKey) => `${realm}::${key}`;
try {
  for (const p of JSON.parse(fs.readFileSync(file, 'utf8')) as StoredPolicy[]) {
    policies.set(idOf(p.realm, p.key ?? 'clinic'), { ...p, key: p.key ?? 'clinic' });
  }
} catch { /* none signed yet */ }

function persist(): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...policies.values()], null, 2));
}

export const getPolicy = (realm: string, key: PolicyKey = 'clinic'): StoredPolicy | undefined =>
  policies.get(idOf(realm, key));

export function savePolicy(
  realm: string, key: PolicyKey, contractId: string, policyB64: string,
): StoredPolicy {
  const p: StoredPolicy = { realm, key, contractId, policyB64, signedAt: new Date().toISOString() };
  policies.set(idOf(realm, key), p);
  persist();
  return p;
}

/**
 * Upload the contract to the realm's library. Fully scriptable — admin bearer, no enclave.
 * It upserts (deduplicating by hash), so calling it repeatedly is safe. The legacy
 * /tide-admin/forseti-contracts path is gone and returns 404, which reads like the feature
 * does not exist rather than like a moved endpoint.
 */
export async function uploadContract(
  authServerUrl: string, realm: string, adminToken: string,
): Promise<{ contractId: string; status: number; body: string }> {
  const base = authServerUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/admin/realms/${encodeURIComponent(realm)}/iga/forseti-contracts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractCode: CLINIC_CONTRACT, name: 'northside-clinic-notes' }),
  });
  return {
    contractId: await computeContractId(CLINIC_CONTRACT),
    status: res.status,
    body: (await res.text()).slice(0, 300),
  };
}

/**
 * The signed ADMIN policy that the signing ceremony attaches in step 3.
 *
 * Proxied server-side deliberately: it is a privileged admin API on another origin, so a
 * browser fetch is CORS-blocked AND would leak the admin bearer. The bytes arrive base64 in
 * the `policy` field — treating that string's char codes as bytes is the classic mistake, and
 * surfaces as an ORK "Index out of range" that says nothing about encoding.
 */
export async function fetchAdminPolicyBytes(
  authServerUrl: string, realm: string, adminToken: string,
): Promise<number[] | null> {
  const base = authServerUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/admin/realms/${encodeURIComponent(realm)}/iga/role-policies`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  const b64 = Array.isArray(json) ? json[0]?.policy : json?.policy;
  if (typeof b64 !== 'string') return null;
  return Array.from(Buffer.from(b64, 'base64'));
}
