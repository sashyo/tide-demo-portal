import { Router } from 'express';
import { config } from '../config.js';
import { session } from '../session.js';
import { get as getTenant } from '../tenants.js';
import { AGENCIES, record, revoke, type AgencyId } from './store.js';
import { agencyPage, directory, identityPage, type IdentityRecord, type Viewer } from './views.js';

export const services = Router();

const isAgency = (v: string): v is AgencyId => AGENCIES.some((a) => a.id === v);

services.use((req, res, next) => {
  const s = session(req, res);
  if (!s.realm || !s.user || !getTenant(s.realm)) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  // Deliberately no role gate. Being a citizen is not a role — everyone who holds an identity
  // can walk up to a public service, which is the entire premise of this demo.
  (req as any).viewer = {
    realm: s.realm,
    person: { sub: s.user.sub, name: s.user.name || s.user.username || 'Signed-in user' },
  } satisfies Viewer;
  next();
});

services.get('/', (req, res) => res.send(directory((req as any).viewer, req.query.done as string)));

/**
 * Read the realm's own credential record for the signed-in user.
 *
 * Through the provisioner, because that is the only party here holding admin credentials for
 * the realm, and it stays that way: this portal never gets them. The user id it asks about is
 * the `sub` from the verified access token, so a visitor can only ever pull their own record.
 *
 * A failure returns null rather than a fabricated record. The whole point of the page is that
 * it shows what was actually read, so inventing a plausible answer when the store is
 * unreachable would make it worse than useless.
 */
async function readIdentityRecord(realm: string, userId: string): Promise<IdentityRecord | null> {
  const url = `${config.provisionerUrl}/api/realms/${encodeURIComponent(realm)}`
    + `/users/${encodeURIComponent(userId)}/identity-record`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      console.warn(`[services] identity record ${r.status} for ${realm}/${userId}`);
      return null;
    }
    return (await r.json()) as IdentityRecord;
  } catch (err) {
    console.warn('[services] identity record unreachable:', err);
    return null;
  }
}

services.get('/identity', async (req, res) => {
  const v: Viewer = (req as any).viewer;
  const rec = await readIdentityRecord(v.realm, v.person.sub);
  res.send(identityPage(v, rec, req.query.done as string));
});

// The old name for this page. Kept as a redirect so a bookmark or a stale link still lands.
services.get('/consent', (_req, res) => res.redirect('/services/identity'));

services.post('/consent/:agency/revoke', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const id = req.params.agency;
  if (!isAgency(id)) return res.redirect('/services/identity');
  revoke(v.realm, v.person.sub, id);
  res.redirect(`/services/identity?done=${encodeURIComponent('Revoked. That agency no longer holds a record of you.')}`);
});

services.get('/:agency', (req, res) => {
  const id = req.params.agency;
  if (!isAgency(id)) return res.redirect('/services');
  res.send(agencyPage((req as any).viewer, id, req.query.done as string));
});

services.post('/:agency', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const id = req.params.agency;
  if (!isAgency(id)) return res.redirect('/services');

  const result = id === 'transport'
    ? 'Licence renewed to 12 March 2031. Receipt sent to your account.'
    : id === 'revenue'
      ? 'You are eligible for the concession rate. Applied from this quarter.'
      : 'Booked · Thursday 10:15, Carlton clinic.';

  record(v.realm, v.person.sub, id, result);
  res.redirect(`/services/${id}?done=${encodeURIComponent(result)}`);
});
