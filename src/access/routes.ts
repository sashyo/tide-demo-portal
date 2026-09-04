import { Router } from 'express';
import { session } from '../session.js';
import { get as getTenant } from '../tenants.js';
import { config } from '../config.js';
import { addContractor, approveElevation, org, requestElevation } from './store.js';
import { member, people, type Viewer } from './views.js';

export const access = Router();

access.use((req, res, next) => {
  const s = session(req, res);
  if (!s.realm || !s.user || !getTenant(s.realm)) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  const roles = s.roles ?? [];
  if (!roles.some((r) => r.startsWith('access-'))) {
    return res.status(403).send(
      `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
       <div class="wrap"><section class="card"><h2>This realm has no access roles</h2>
       <p class="sub">It was created before Northwind Access existed. Roles cannot be added to a
       live realm safely, so use one created since.</p>
       <p><a class="btn-link" href="/switch"><button class="btn-primary" type="button">Switch realm</button></a></p>
       </section></div>`,
    );
  }
  (req as any).viewer = {
    realm: s.realm,
    person: { sub: s.user.sub, name: s.user.name || s.user.username || 'Signed-in user' },
    roles,
  } satisfies Viewer;
  next();
});

access.get('/', (req, res) => {
  const v: Viewer = (req as any).viewer;
  res.send(people(v, req.query.done as string, req.query.err as string));
});

access.get('/people/:id', (req, res) => res.send(member((req as any).viewer, req.params.id)));

/**
 * IGA governance, proxied per-session so a caller can only ever act on their own realm.
 *
 * These are TideCloak's real change requests — the app does not decide whether a change is
 * applied, the quorum does.
 */
const iga = (realm: string, path = '') =>
  `${config.provisionerUrl}/api/realms/${encodeURIComponent(realm)}/change-requests${path}`;

access.get('/api/change-requests', async (req, res) => {
  const v: Viewer = (req as any).viewer;
  try {
    const r = await fetch(iga(v.realm) + '?status=PENDING');
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

access.get('/api/change-requests/:id/approval-model', async (req, res) => {
  const v: Viewer = (req as any).viewer;
  try {
    const r = await fetch(iga(v.realm, `/${encodeURIComponent(req.params.id)}/approval-model`));
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

access.post('/api/change-requests/:id/approval-model', async (req, res) => {
  const v: Viewer = (req as any).viewer;
  try {
    const r = await fetch(iga(v.realm, `/${encodeURIComponent(req.params.id)}/approval-model`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestModel: String(req.body?.requestModel ?? '') }),
    });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

access.post('/api/change-requests/:id/commit', async (req, res) => {
  const v: Viewer = (req as any).viewer;
  try {
    const r = await fetch(iga(v.realm, `/${encodeURIComponent(req.params.id)}/commit`), { method: 'POST' });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/** Grant a realm role. Returns 202 — the grant is queued for quorum approval, not applied. */
access.post('/api/grant', async (req, res) => {
  const v: Viewer = (req as any).viewer;
  try {
    const r = await fetch(
      `${config.provisionerUrl}/api/realms/${encodeURIComponent(v.realm)}/users/${encodeURIComponent(String(req.body?.userId ?? ''))}/roles`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: String(req.body?.role ?? '') }) },
    );
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * The only thing the service desk can actually do. Ending sessions cannot let anybody IN, which
 * is what makes it safe to expose to a phone call — unlike a password or MFA reset.
 */
access.post('/people/:id/sessions/end', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const m = org(v.realm).people.find((x) => x.id === req.params.id);
  if (m) m.sessions = 0;
  res.redirect(`/access/people/${req.params.id}`);
});

access.post('/contractors', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const days = Number(req.body?.days);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return res.redirect(`/access?err=${encodeURIComponent('Access length must be between 1 and 365 days.')}`);
  }
  const m = addContractor(v.realm, String(req.body?.name ?? '').trim() || 'Contractor', days, String(req.body?.grant ?? '').trim());
  res.redirect(`/access?done=${encodeURIComponent(`${m.name} can work for ${days} days. No account was created — the grant simply lapses.`)}`);
});

access.post('/elevations', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const minutes = Number(req.body?.minutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
    return res.redirect(`/access?err=${encodeURIComponent('Elevation must be between 5 and 480 minutes.')}`);
  }
  requestElevation(v.realm, v.person.name, String(req.body?.scope ?? ''), String(req.body?.reason ?? ''), minutes);
  res.redirect(`/access?done=${encodeURIComponent('Requested. It needs someone else to approve it.')}`);
});

access.post('/elevations/:id/approve', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const r = approveElevation(v.realm, req.params.id, v.person);
  res.redirect(r.ok ? '/access?done=' + encodeURIComponent('Approved. It lapses on its own.')
                    : '/access?err=' + encodeURIComponent(r.reason));
});
