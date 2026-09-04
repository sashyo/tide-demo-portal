import { Router } from 'express';
import { session } from '../session.js';
import { get as getTenant } from '../tenants.js';
import { addTicket, setAuthority, spend } from './store.js';
import { queue, type Viewer } from './views.js';

export const support = Router();

support.use((req, res, next) => {
  const s = session(req, res);
  if (!s.realm || !s.user || !getTenant(s.realm)) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  (req as any).viewer = {
    realm: s.realm,
    person: { sub: s.user.sub, name: s.user.name || s.user.username || 'Signed-in user' },
    roles: s.roles ?? [],
  } satisfies Viewer;
  next();
});

support.get('/', (req, res) => res.send(queue((req as any).viewer, req.query.done as string)));

support.post('/tickets', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const body = String(req.body?.body ?? '').slice(0, 1000).trim();
  if (!body) return res.redirect('/support');
  addTicket(v.realm, v.person.name, String(req.body?.subject ?? '').slice(0, 120), body);
  res.redirect('/support?done=' + encodeURIComponent('Added to the queue. Let the agent work it.'));
});

support.post('/tickets/:id/work', (req, res) => {
  const v: Viewer = (req as any).viewer;
  spend(v.realm, req.params.id);
  res.redirect('/support');
});

support.post('/authority', (req, res) => {
  const v: Viewer = (req as any).viewer;
  // Only a supervisor changes the ceiling, and the role comes from the verified token.
  if (!v.roles.includes('support-supervisor')) {
    return res.redirect('/support?done=' + encodeURIComponent('Only a supervisor can change the authority.'));
  }
  const perCase = Math.round(Number(req.body?.perCase) * 100);
  const budget = Math.round(Number(req.body?.budget) * 100);
  const hours = Number(req.body?.hours);
  if (![perCase, budget, hours].every((n) => Number.isFinite(n) && n >= 0)) return res.redirect('/support');
  setAuthority(v.realm, perCase, budget, Math.min(hours, 24));
  res.redirect('/support?done=' + encodeURIComponent('Authority updated.'));
});
