import { Router } from 'express';
import { session } from '../session.js';
import { get as getTenant } from '../tenants.js';
import { AGENCIES, record, revoke, type AgencyId } from './store.js';
import { agencyPage, consent, directory, type Viewer } from './views.js';

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

services.get('/consent', (req, res) => res.send(consent((req as any).viewer, req.query.done as string)));

services.post('/consent/:agency/revoke', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const id = req.params.agency;
  if (!isAgency(id)) return res.redirect('/services/consent');
  revoke(v.realm, v.person.sub, id);
  res.redirect(`/services/consent?done=${encodeURIComponent('Revoked. That agency no longer holds a record of you.')}`);
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
