import { Router } from 'express';
import QRCode from 'qrcode';

import { config } from '../config.js';
import { session } from '../session.js';
import { get as getTenant } from '../tenants.js';
import {
  approvalBlocker, approve, approveBankChange, book, quorumOf, requestBankChange, total,
} from './store.js';
import { getPolicy, savePolicy } from '../clinic/policy.js';
import {
  APPROVER_ROLE, EXECUTOR_ROLE, PAYMENT_AUTH_FLOW, PAYMENT_CONTRACT, PAYMENT_MODEL_ID,
  PAYMENT_REQUEST_NAME, PAYMENT_REQUEST_VERSION, computePaymentContractId,
} from './contract.js';
import { dashboard, noRoles, runDetail, supplier, type Viewer } from './views.js';

const money = (cents: number): string =>
  (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export const treasury = Router();

/**
 * Policy endpoints, deliberately OUTSIDE the role-gated router.
 *
 * These run during realm setup, when the browser is authenticated with the Tide SDK and the
 * portal session has no `user` yet. Behind the role gate they answered 302 -> /login, and a
 * fetch landing on /login kicks off the portal's own OIDC flow — which is what turned setup
 * into a redirect loop. They need a realm, not a portal login.
 */
export const treasuryPolicy = Router();

function realmOf(req: any, res: any): string | null {
  const s = session(req, res);
  return s.realm && getTenant(s.realm) ? s.realm : null;
}

treasuryPolicy.use((req, res, next) => {
  if (!realmOf(req, res)) return res.status(404).json({ error: 'No realm selected' });
  next();
});

/** Everything the browser needs to build and sign a payment approval request. */
treasuryPolicy.get('/api/signing', async (req, res) => {
  const v = { realm: realmOf(req, res)! };
  const policy = getPolicy(v.realm, 'payment');
  res.json({
    signed: Boolean(policy),
    policyB64: policy?.policyB64 ?? null,
    requestName: PAYMENT_REQUEST_NAME,
    requestVersion: PAYMENT_REQUEST_VERSION,
    modelId: PAYMENT_MODEL_ID,
    authFlow: PAYMENT_AUTH_FLOW,
  });
});

/** Upload the contract and hand back what the signing ceremony needs. Scriptable half. */
treasuryPolicy.post('/api/policy/prepare', async (req, res) => {
  const v = { realm: realmOf(req, res)! };
  try {
    const upload = await fetch(
      `${config.provisionerUrl}/api/realms/${encodeURIComponent(v.realm)}/forseti-contracts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractCode: PAYMENT_CONTRACT, name: 'northwind-payment-approval' }),
      },
    );
    if (!upload.ok) {
      return res.status(502).json({ error: `Contract upload failed: ${(await upload.text()).slice(0, 200)}` });
    }
    res.json({
      contractId: await computePaymentContractId(),
      contractSource: PAYMENT_CONTRACT,
      modelId: PAYMENT_MODEL_ID,
      // Must match the [PolicyParam] names on the contract exactly.
      params: [
        ['Resource', `${v.realm}-client`],
        ['Role', APPROVER_ROLE],
        ['ExecutorRole', EXECUTOR_ROLE],
      ],
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

treasuryPolicy.post('/api/policy', (req, res) => {
  const v = { realm: realmOf(req, res)! };
  const { contractId, policyB64 } = req.body ?? {};
  if (typeof contractId !== 'string' || typeof policyB64 !== 'string' || policyB64.length < 32) {
    return res.status(400).json({ error: 'Refusing to store an incomplete policy.' });
  }
  savePolicy(v.realm, 'payment', contractId, policyB64);
  res.json({ ok: true });
});



/**
 * Identity and roles come from the verified ID token in the session, never from the request.
 * `sub` is what four-eyes is decided on: a display name can repeat, and anything a caller can
 * set is not an identity.
 */
function viewer(req: any, res: any): Viewer | null {
  const s = session(req, res);
  if (!s.realm || !s.user || !getTenant(s.realm)) return null;
  return {
    realm: s.realm,
    person: { sub: s.user.sub, name: s.user.name || s.user.username || 'Signed-in user' },
    roles: s.roles ?? [],
  };
}

treasury.use((req, res, next) => {
  const v = viewer(req, res);
  if (!v) {
    // Come back here after signing in, so a QR scanned on a phone lands on the run it was for.
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  const hasTreasuryRole = v.roles.some((r) => r.startsWith('treasury-'));
  if (!hasTreasuryRole) {
    return res
      .status(403)
      .send(noRoles(v.realm));
  }

  (req as any).viewer = v;
  next();
});

treasury.get('/', (req, res) => res.send(dashboard((req as any).viewer)));

treasury.get('/runs/:id', async (req, res) => {
  const v: Viewer = (req as any).viewer;
  const run = book(v.realm).runs.find((r) => r.id === req.params.id);
  if (!run) return res.status(404).send(dashboard(v));

  const blocker = approvalBlocker(run, v.person, v.roles);
  // The QR points at this page on the PORTAL'S PUBLIC URL. On localhost a phone cannot reach
  // it — PORTAL_URL has to be an address the phone can actually open (a LAN IP or a tunnel),
  // or the reveal silently becomes a broken camera scan.
  const approveUrl = `${config.portalUrl}/treasury/runs/${run.id}`;
  const qr = blocker
    ? await QRCode.toString(approveUrl, { type: 'svg', margin: 0, width: 148, errorCorrectionLevel: 'M' })
    : '';

  res.send(runDetail(v, run, blocker, qr, approveUrl, req.query.approved ? 'Your approval was recorded.' : undefined));
});

/**
 * Record an approval that the ORK network signed.
 *
 * A signature is required. There is no path here that records an approval the server could have
 * produced on its own — that is the property the quorum exists for.
 */
treasury.post('/runs/:id/approve-signed', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const signature = String(req.body?.signature ?? '');
  if (signature.length < 32) {
    return res.status(400).json({ error: 'No threshold signature supplied; nothing was approved.' });
  }
  const device = `${/Mobile|iPhone|Android/i.test(req.get('user-agent') ?? '') ? 'Phone' : 'Desktop'} · enclave`;
  const result = approve(v.realm, req.params.id, v.person, v.roles, device, signature);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json({ ok: true });
});

/** Application-level approval, recorded against the verified identity in the session. */
treasury.post('/runs/:id/approve', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const device = `${/Mobile|iPhone|Android/i.test(req.get('user-agent') ?? '') ? 'Phone' : 'Desktop'} · ${new Date().toLocaleTimeString('en-AU')}`;
  const result = approve(v.realm, req.params.id, v.person, v.roles, device);
  if (!result.ok) console.log(`[treasury] approval refused for ${v.person.sub}: ${result.reason}`);
  res.redirect(`/treasury/runs/${req.params.id}${result.ok ? '?approved=1' : ''}`);
});

/**
 * Polled by the run page. Returns WHO approved, not just how many.
 *
 * The page replays each staged colleague's approval on screen, so it needs their name and
 * whether they are staged — a count alone cannot tell it who just arrived.
 */
treasury.get('/api/runs/:id', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const run = book(v.realm).runs.find((r) => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  res.json({
    status: run.status,
    approvals: run.approvals.map((a) => ({
      name: a.by.name,
      simulated: Boolean(a.simulated),
      signed: Boolean(a.signature),
      at: a.at,
    })),
    required: quorumOf(run),
    amount: money(total(run)),
    id: run.id,
  });
});

treasury.get('/suppliers/:id', (req, res) => {
  const v: Viewer = (req as any).viewer;
  res.send(supplier(v, req.params.id, req.query.done as string, req.query.err as string));
});

treasury.post('/suppliers/:id/bank', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const change = requestBankChange(
    v.realm, req.params.id, String(req.body?.bsb ?? ''), String(req.body?.account ?? ''), v.person,
  );
  const msg = change
    ? `Requested ${change.id}. It needs a different person to approve before any money moves.`
    : '';
  res.redirect(`/treasury/suppliers/${req.params.id}?done=${encodeURIComponent(msg)}`);
});

treasury.post('/suppliers/:id/bank/:changeId/approve', (req, res) => {
  const v: Viewer = (req as any).viewer;
  const r = approveBankChange(v.realm, req.params.changeId, v.person, v.roles);
  const q = r.ok ? `done=${encodeURIComponent('Bank details updated.')}` : `err=${encodeURIComponent(r.reason)}`;
  res.redirect(`/treasury/suppliers/${req.params.id}?${q}`);
});
