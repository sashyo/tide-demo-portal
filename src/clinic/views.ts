const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function page(realm: string): string {
  return `<!doctype html><html lang="en" data-app="clinic"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Northside Clinic</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230d4ec4'/%3E%3Ctext x='16' y='23' font-size='18' font-weight='900' fill='white' text-anchor='middle' font-family='system-ui'%3EN%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/treasury.css"><link rel="stylesheet" href="/clinic.css"><link rel="stylesheet" href="/sim.css"><link rel="stylesheet" href="/demos.css">
</head><body data-realm="${esc(realm)}">
<div class="wrap">
  <div class="mast"><div class="mark" aria-hidden="true">N</div>
    <div style="flex:1"><h1>Northside Clinic</h1>
      <div class="host" id="whoami">Connecting…</div></div>
    <a href="/" class="back"><span aria-hidden="true">&larr;</span> Portal</a></div>

  <section class="card">
    <div class="meta"><h2>Today</h2><span class="badge" id="policy-state">Checking…</span></div>
    <p class="sub" id="status">Loading…</p>
    <div class="note note-err" id="err" hidden></div>

    <div class="note note-warn" id="sign-panel" hidden>
      <strong>Encryption policy not signed</strong>
      Clinical notes cannot be encrypted on this realm until an administrator signs the policy.
      This opens the Tide enclave and asks for your approval. It is the one step that cannot be
      automated, because only your browser can produce the signature.
      <p style="margin-top:12px"><button class="btn-ghost" id="sign-btn" type="button">Sign the encryption policy</button></p>
    </div>

    <div class="note note-warn" id="sign-blocked" hidden>
      <strong>Waiting on an administrator</strong>
      This realm's encryption policy has not been signed yet. Only a realm administrator can do
      it, so notes stay unreadable until then.
    </div>
  </section>

  <section class="card">
    <h2>Triage assistant</h2>
    <p class="sub">It runs on our server, where a Tide credential cannot exist. Ask it to work
      your queue, then ask it to read a note.</p>
    <div class="dm-chat">
      <div class="dm-chat-head"><span class="dm-bot-face">&#9679;</span>
        <b>Northside Triage</b><i>online</i></div>
      <div class="dm-thread" id="tri-thread"></div>
      <div class="tri-compose">
        <input id="tri-input" type="text" autocomplete="off"
          placeholder="who is my next patient?" aria-label="Message the assistant">
        <button id="tri-send" class="btn-ghost" type="button">Send</button>
      </div>
    </div>
    <div class="tri-net" id="tri-net" hidden></div>
    <div class="tri-mine" id="tri-mine" hidden></div>
  </section>

  <section class="card" id="doctor-tools" hidden>
    <h2>Write a consultation note</h2>
    <p class="sub">Encrypted in your browser before it is sent. The server stores ciphertext and
       has no way to read it back.</p>
    <div class="bank-form">
      <label for="note-patient">Patient</label>
      <select id="note-patient">
        <option value="pt1">Margaret Cole</option>
        <option value="pt2">Aaron Whitlock</option>
        <option value="pt3">Fatima Nasser</option>
      </select>
      <label for="note-text">Note</label>
      <input type="text" id="note-text" placeholder="Reviewed post-op recovery…">
      <button class="btn-ghost" id="note-btn" type="button">Encrypt and save</button>
    </div>
  </section>

  <section class="card">
    <h2>Patients</h2>
    <div id="patients"></div>
  </section>
</div>
<script src="/replay.js"></script>
<script src="/clinic.bundle.js"></script>
</body></html>`;
}
