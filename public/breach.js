/* The breach demo: run the same attack twice, once on an ordinary service and once here.
 *
 * The static two-column comparison this replaces was an explainer, and an explainer asks the
 * reader to take the interesting step themselves: understanding that a scrambled password is
 * still a password. Nobody does that on a page about renewing a licence.
 *
 * So it plays out instead. The attacker dumps a users table, cracks it, reuses what falls out,
 * and opens accounts. Then the same attacker runs the same tool against this service and gets
 * nothing, because the column they need is empty.
 *
 * Stamped SIMULATED ATTACK throughout. The row counts, the other victims and the cracking
 * output are invented; the one fact carried in from outside is whether THIS service actually
 * stores a password, read from the identity store before the page rendered. If it ever does,
 * the second act has to show the same carnage as the first, so it does. */
(function () {
  var T = {
    boot: 700,        // terminal opens, before anything is typed
    line: 240,        // between dumped rows
    beat: 900,        // between one step of the attack and the next
    crackTick: 90,    // progress bar step
    verdict: 2600,    // the count of opened accounts, held so it can be read
    actGap: 1400,     // between the two acts
    outro: 3200,
  };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  var VICTIMS = [
    ['j.denes@example.com', '$2b$12$eR9xK7pQ2mVt0aZ.uY4'],
    ['m.oyelaran@example.com', '$2b$12$Lp3wQ8sTnB1kX.vC7a'],
    ['s.whitlam@example.com', '$2b$12$Hd6yR2fJmW9pE.zN4t'],
    ['a.kaur@example.com', '$2b$12$Qc8vT5nZxK3rG.bM1s'],
  ];

  function el(stage, sel) { return stage.querySelector(sel); }

  async function typeLines(host, rows, cls) {
    for (var i = 0; i < rows.length; i++) {
      var d = document.createElement('div');
      d.className = 'bx-row' + (cls ? ' ' + cls : '');
      d.innerHTML = rows[i];
      host.appendChild(d);
      host.scrollTop = host.scrollHeight;
      await wait(T.line);
    }
  }

  async function say(host, text, cls) {
    var d = document.createElement('div');
    d.className = 'bx-say' + (cls ? ' ' + cls : '');
    d.innerHTML = text;
    host.appendChild(d);
    host.scrollTop = host.scrollHeight;
    await wait(T.beat);
    return d;
  }

  async function crack(host, willBreak) {
    var wrap = document.createElement('div');
    wrap.className = 'bx-crack';
    wrap.innerHTML = '<div class="bx-cmd">$ hashcat -m 3200 users.txt rockyou.txt</div>'
      + '<div class="bx-bar"><i></i></div><div class="bx-pct">0%</div>';
    host.appendChild(wrap);
    host.scrollTop = host.scrollHeight;
    var bar = wrap.querySelector('i');
    var pct = wrap.querySelector('.bx-pct');

    if (!willBreak) {
      // Nothing to work on. The tool exits immediately, which is the whole point.
      await wait(T.beat);
      pct.textContent = '';
      wrap.classList.add('bx-crack-empty');
      pct.innerHTML = '<span class="bx-none">no hashes found in input, nothing to attack</span>';
      await wait(T.beat);
      return;
    }
    for (var p = 0; p <= 100; p += 4) {
      bar.style.width = p + '%';
      pct.textContent = p + '%';
      await wait(T.crackTick);
    }
    pct.innerHTML = '<span class="bx-hit">recovered: hunter2</span>';
    await wait(T.beat);
  }

  /** @param {{hasPassword:boolean, totp:boolean, service:string}} o */
  async function play(o) {
    var stage = document.createElement('div');
    stage.className = 'bx-stage';
    stage.setAttribute('role', 'dialog');
    stage.setAttribute('aria-label', 'Simulated breach demonstration');
    stage.innerHTML =
      '<div class="bx-scrim"></div>' +
      '<div class="bx-frame">' +
        '<div class="bx-caption">' +
          '<span class="bx-tag">Simulated attack</span>' +
          '<span class="bx-act">Act 1 of 2</span>' +
        '</div>' +
        '<div class="bx-win">' +
          '<div class="bx-chrome"><span class="bx-dots"><i></i><i></i><i></i></span>' +
            '<span class="bx-title">stolen-data</span>' +
            '<button class="bx-close" type="button" aria-label="Close">Skip</button></div>' +
          '<div class="bx-term"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(stage);
    await wait(60);
    stage.classList.add('in');

    var term = el(stage, '.bx-term');
    var act = el(stage, '.bx-act');
    var closed = false;
    var done = function () { closed = true; };
    el(stage, '.bx-close').addEventListener('click', done);
    el(stage, '.bx-scrim').addEventListener('click', done);

    var stop = function () { return closed; };

    await wait(T.boot);

    // --- Act 1: an ordinary service -------------------------------------------------
    if (stop()) return teardown(stage);
    await say(term, '$ cat users.sql &nbsp;<span class="bx-dim">// ordinary service</span>', 'bx-cmd');
    await typeLines(term, VICTIMS.map(function (v) {
      return '<span class="bx-em">' + esc(v[0]) + '</span>'
        + '<span class="bx-hash">' + esc(v[1]) + '</span>';
    }));
    if (stop()) return teardown(stage);
    await say(term, '<span class="bx-dim">4,182,904 rows, every one with a password on it</span>');
    await crack(term, true);
    if (stop()) return teardown(stage);
    await say(term, '$ reuse hunter2 --on gmail,paypal,work-vpn,facebook', 'bx-cmd');
    await say(term, '<span class="bx-bad">3 of 4 accounts opened</span>'
      + '<span class="bx-dim">the password was used elsewhere, as passwords are</span>', 'bx-verdict bx-verdict-bad');
    await wait(T.verdict);

    // --- Act 2: this service ---------------------------------------------------------
    if (stop()) return teardown(stage);
    act.textContent = 'Act 2 of 2';
    term.innerHTML = '';
    await wait(T.actGap);
    await say(term, '$ cat users.sql &nbsp;<span class="bx-dim">// ' + esc(o.service) + '</span>', 'bx-cmd');
    await typeLines(term, VICTIMS.map(function (v) {
      return '<span class="bx-em">' + esc(v[0]) + '</span>'
        + (o.hasPassword
            ? '<span class="bx-hash">' + esc(v[1]) + '</span>'
            : '<span class="bx-empty">no password on file</span>');
    }));
    if (stop()) return teardown(stage);
    await say(term, '<span class="bx-dim">4,182,904 rows, and the password column does not exist</span>');
    await crack(term, o.hasPassword);
    if (stop()) return teardown(stage);
    await say(term, '$ reuse ??? --on gmail,paypal,work-vpn,facebook', 'bx-cmd');
    await say(term, o.hasPassword
        ? '<span class="bx-bad">3 of 4 accounts opened</span>'
          + '<span class="bx-dim">this service is storing passwords after all</span>'
        : '<span class="bx-good">0 accounts opened</span>'
          + '<span class="bx-dim">there was never anything here to reuse</span>',
      'bx-verdict ' + (o.hasPassword ? 'bx-verdict-bad' : 'bx-verdict-good'));

    await say(term, 'Same thief. Same effort. Nothing taken.', 'bx-outro');
    await wait(T.outro);
    teardown(stage);
  }

  function teardown(stage) {
    stage.classList.remove('in');
    setTimeout(function () { stage.remove(); }, 320);
  }

  window.TideBreach = { play: play, timings: T };

  /* Wired from a data attribute rather than an inline onclick, because script-src on this app
   * is 'self' with no unsafe-inline: an inline handler is silently dropped by CSP and the
   * button does nothing at all, with no error anywhere the author would look. */
  function bind() {
    var btn = document.querySelector('[data-breach]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      play({
        hasPassword: btn.dataset.hasPassword === 'true',
        totp: btn.dataset.totp === 'true',
        service: btn.dataset.service || 'this service',
      }).finally(function () { btn.disabled = false; });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
