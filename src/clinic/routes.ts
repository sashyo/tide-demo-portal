import { Router } from 'express';
import { config } from '../config.js';
import { session } from '../session.js';
import { get as getTenant } from '../tenants.js';
import { CLINIC_CONTRACT, CONTRACT_ROLE, computeContractId } from './contract.js';
import { getPolicy, savePolicy } from './policy.js';
import { addNote, practice } from './store.js';
import { page } from './views.js';

export const clinic = Router();

/**
 * The clinic authenticates through the Tide SDK in the browser, not through the portal session.
 *
 * That is not duplication for its own sake: policy signing and doEncrypt/doDecrypt need the
 * SDK's own TideCloak client and its doken. The portal session is used only to know WHICH realm
 * this browser is working with.
 */
function realmOf(req: any, res: any): string | null {
  const s = session(req, res);
  return s.realm && getTenant(s.realm) ? s.realm : null;
}

clinic.get('/', (req, res) => {
  const realm = realmOf(req, res);
  if (!realm) return res.redirect('/login?next=%2Fclinic');
  res.send(page(realm));
});

/** The realm's adapter config, so the SDK can initialise. Public config only. */
clinic.get('/api/adapter', (req, res) => {
  const realm = realmOf(req, res);
  const tenant = realm ? getTenant(realm) : undefined;
  if (!tenant) return res.status(404).json({ error: 'No realm selected' });
  res.json(tenant.adapter);
});

clinic.get('/api/policy', (req, res) => {
  const realm = realmOf(req, res);
  if (!realm) return res.status(404).json({ signed: false });
  const p = getPolicy(realm);
  res.json(p ? { signed: true, policyB64: p.policyB64, signedAt: p.signedAt } : { signed: false });
});

/**
 * Everything the ceremony needs that a script CAN produce: the contract uploaded to the realm's
 * library, its id, and the role the contract checks.
 */
clinic.post('/api/policy/prepare', async (req, res) => {
  const realm = realmOf(req, res);
  if (!realm) return res.status(404).json({ error: 'No realm selected' });
  try {
    const upload = await fetch(
      `${config.provisionerUrl}/api/realms/${encodeURIComponent(realm)}/forseti-contracts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractCode: CLINIC_CONTRACT, name: 'northside-clinic-notes' }),
      },
    );
    if (!upload.ok) {
      const body = await upload.text();
      const transient = upload.status >= 500 || /not answering|unavailable/i.test(body);
      return res.status(502).json({
        error: transient
          ? 'TideCloak did not answer while publishing the encryption contract. Nothing was '
            + 'changed — click again in a moment.'
          : `Contract upload failed: ${body.slice(0, 200)}`,
      });
    }
    res.json({
      contractId: await computeContractId(CLINIC_CONTRACT),
      contractSource: CLINIC_CONTRACT,
      contractRole: CONTRACT_ROLE,
    });
  } catch (err) {
    res.status(502).json({ error: `Could not prepare the policy: ${(err as Error).message}` });
  }
});

/** Proxied because the browser cannot reach the admin API (CORS, and it would leak the bearer). */
clinic.get('/api/policy/admin-policy', async (req, res) => {
  const realm = realmOf(req, res);
  if (!realm) return res.status(404).json({ error: 'No realm selected' });
  try {
    const r = await fetch(`${config.provisionerUrl}/api/realms/${encodeURIComponent(realm)}/admin-policy`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

clinic.post('/api/policy', (req, res) => {
  const realm = realmOf(req, res);
  if (!realm) return res.status(404).json({ error: 'No realm selected' });
  const { contractId, policyB64 } = req.body ?? {};
  if (typeof contractId !== 'string' || typeof policyB64 !== 'string' || policyB64.length < 32) {
    // Storing a half-signed policy is worse than storing none: every later encrypt and decrypt
    // silently fetches the broken bytes and fails.
    return res.status(400).json({ error: 'Refusing to store an incomplete policy.' });
  }
  savePolicy(realm, 'clinic', contractId, policyB64);
  res.json({ ok: true });
});

clinic.get('/api/patients', (req, res) => {
  const realm = realmOf(req, res);
  if (!realm) return res.status(404).json([]);
  res.json(practice(realm).patients);
});

clinic.post('/api/notes', (req, res) => {
  const realm = realmOf(req, res);
  if (!realm) return res.status(404).json({ error: 'No realm selected' });
  const { patientId, ciphertext, by } = req.body ?? {};
  if (typeof ciphertext !== 'string' || !ciphertext) {
    return res.status(400).json({ error: 'ciphertext required' });
  }
  // The server stores what the browser encrypted and never sees the note. There is no decrypt
  // path here at all — that is the property, not an omission.
  const note = addNote(realm, String(patientId), ciphertext, String(by ?? 'Clinician'));
  res.json(note ? { ok: true, note } : { error: 'No such patient' });
});
