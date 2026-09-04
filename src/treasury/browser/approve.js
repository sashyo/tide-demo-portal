import { IAMService, initTide, isPopupBlocked, POPUP_HELP } from '../../clinic/browser/tide.js';
import { Models, Tools } from '@tidecloak/js';

const { BaseTideRequest } = Models;
const { TideMemory } = Tools;

/**
 * Approve a payment run on the Tide network.
 *
 * Sequence, and none of it is a free choice — this follows a working Tide signing integration:
 *
 *   BaseTideRequest(wrappedName, wrappedVersion, "Policy:1", payloadBytes)
 *     .addPolicy(signedPolicyBytes)          <- without this the ORKs reject outright
 *   createTideRequest(...)                    <- enclave runs the auth flow with the session doken
 *   requestTideOperatorApproval(...)          <- the popup; runs ONLY under ApprovalType.EXPLICIT
 *   executeSignRequest(initialized, true)     <- waitForAll, else the threshold is incomplete
 *
 * The name and version must carry the BasicCustom<> wrappers: the ORKs reject a bare model name
 * with "not found in registry", and the policy declares the wrapped id.
 *
 * No doken handling here on purpose. createTideRequest delegates to the request enclave, which
 * runs the authorisation flow with the session's own doken and stamps a network-signed creation
 * time; attaching an authorizer by hand would duplicate work using state this code cannot see.
 */
const $ = (id) => document.getElementById(id);
const say = (m) => { const e = $('approve-status'); if (e) e.textContent = m; };
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

function fail(msg, html) {
  say('');
  const box = $('approve-result');
  box.hidden = false;
  box.className = 'note note-warn';
  box.innerHTML = html
    ? html
    : '<strong>Not approved — nothing was recorded</strong>' + String(msg).replace(/[<>]/g, '');
  // Re-enable so the retry comes from a fresh click, which is what the popup rule requires.
  const btn = $('enclave-approve');
  if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
}

/**
 * ORK denials arrive as a THRESHOLD_FAILURE wrapping one near-identical line per ORK, each
 * hundreds of characters of url, vuid and gas accounting. Shown raw, the one sentence that
 * matters — the contract's own reason — is buried under many copies of the same noise.
 */
function readableOrkError(err) {
  const raw = err?.message ?? String(err);
  const denial = raw.match(/Deny(?:ing)?[:\s]+([^"'\\\n]{8,200})/i);
  if (denial) return `The contract refused this approval: ${denial[1].trim()}`;
  if (/not found in registry/i.test(raw)) {
    return 'The ORKs do not recognise this request model. The signed policy must declare the ' +
           'wrapped id BasicCustom&lt;NorthwindPayment&gt;:BasicCustom&lt;1&gt;.';
  }
  if (/policy/i.test(raw) && /sign/i.test(raw)) {
    return 'The ORKs rejected the attached policy. It has to be the VVK-signed bytes from the ' +
           'setup ceremony, not the unsigned policy.';
  }
  return raw.slice(0, 300);
}

async function approve(runId, payload) {
  const btn = $('enclave-approve');
  btn.disabled = true;
  try {
    // Signed in already — see boot(). Doing it here would spend the click on a login redirect
    // and force the user to press the button a second time.
    const cfg = await (await fetch('/treasury/api/signing')).json();
    if (!cfg.signed) {
      return fail('This realm has no signed payment policy yet. Complete realm setup first — ' +
                  'the policy is signed there, while the realm is still firstAdmin.');
    }

    const tc = IAMService.getTideCloakClient();
    if (!tc) throw new Error('Tide client not ready.');

    /**
     * The draft must be TIDEMEMORY-STRUCTURED, not raw bytes.
     *
     * Before showing an approval the enclave builds a human-readable summary:
     *
     *   humanReadableJson = JSON.parse(StringFromUint8Array(GetValue(request.draft, 0)))
     *   humanReadableName = humanReadableJson["humanReadableName"]
     *   getRequestDataJson() -> humanReadableJson["additionalInfo"]
     *
     * so segment 0 has to be that JSON object. Passing a flat JSON payload makes GetValue read
     * a length prefix out of arbitrary bytes, which is the
     * "Index out of range: requested segment 0 … exceeds buffer length" failure — an error that
     * says nothing about the draft's shape.
     *
     * Segment 1 carries the payment itself, and the contract's ValidateData probes segment 0,
     * so both are satisfied by the same structure.
     */
    const enc = new TextEncoder();
    const summary = {
      humanReadableName: `Approve ${payload.run} — ${payload.amount}`,
      additionalInfo: payload,
    };
    const draft = TideMemory.CreateFromArray([
      enc.encode(JSON.stringify(summary)),
      enc.encode(JSON.stringify(payload)),
    ]);

    const request = new BaseTideRequest(cfg.requestName, cfg.requestVersion, cfg.authFlow, draft);
    request.setCustomExpiry(60);
    request.addPolicy(b64ToBytes(cfg.policyB64));

    say('Preparing the approval…');
    let initialized = await tc.createTideRequest(request.encode());

    say('Approve this payment in the Tide window…');
    const approved = await tc.requestTideOperatorApproval([{ id: `payment-${runId}`, request: initialized }]);
    if (!approved?.[0]?.request) throw new Error('The approval was declined or did not complete.');
    initialized = approved[0].request;

    say('Collecting the threshold signature…');
    const signatures = await tc.executeSignRequest(initialized, true);
    if (!signatures?.length) throw new Error('The ORK network returned no signature.');

    const sig = signatures[0] instanceof Uint8Array ? signatures[0] : new Uint8Array(signatures[0]);
    if (sig.length !== 64) throw new Error(`Expected a 64-byte Ed25519 signature, got ${sig.length}.`);

    say('Recording…');
    const res = await fetch(`/treasury/runs/${encodeURIComponent(runId)}/approve-signed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: bytesToB64(sig) }),
    });
    if (!res.ok) throw new Error(((await res.json()) || {}).error || 'The server refused the approval.');
    location.reload();
  } catch (e) {
    if (isPopupBlocked(e)) fail(null, POPUP_HELP);
    else fail(readableOrkError(e));
  }
}

/**
 * Sign in on page load; keep the click for the enclave.
 *
 * Two separate constraints pull in opposite directions and both must be respected:
 *   - Signing in is a top-level redirect and needs NO user gesture, so it can happen on load.
 *   - Opening the Tide enclave DOES need a gesture, so it must happen in the click handler.
 *
 * Doing the login inside the click satisfies the second but wastes the first: the click is
 * consumed by the redirect and the user has to press the button again after returning.
 */
(async function boot() {
  const btn = $('enclave-approve');
  if (!btn) return;

  btn.disabled = true;
  say('Connecting to Tide…');
  try {
    if (!(await initTide(location.pathname))) return;   // redirected to sign in
    say('');
    btn.disabled = false;
    btn.addEventListener('click', () => approve(btn.dataset.run, JSON.parse(btn.dataset.payload)));
  } catch (e) {
    fail(readableOrkError(e));
  }
})();
