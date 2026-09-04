/* The other half of BYOiD: walking up to a service that has never heard of you.
 *
 * The breach demo covers the security half, which is that no password is stored because no
 * party ever learns one. This covers the half the name is actually about. You are not issued
 * an identity by each service. You already have one, and you bring it.
 *
 * Argued as a race, because ease of use is the kind of claim that dies in prose and survives
 * a clock. Both columns start together. The right one finishes and then sits there, visibly
 * waiting, while the left is still choosing a password that satisfies somebody's regex. The
 * waiting is the point, so it is not skipped.
 *
 * Every step on the left is one that a real signup asks for. Nothing is exaggerated to make
 * the comparison land; it does not need to be. */
(function () {
  // Each step is [label, how long it takes, optional friction shown underneath].
  var SLOW = [
    ['Find the sign up link', 2200],
    ['Type your email address', 3400],
    ['Choose a password', 5200, 'must contain a number and a symbol'],
    ['Type the password again', 2600, 'passwords do not match'],
    ['Check your email', 6800, 'nothing yet. check spam'],
    ['Click the verification link', 2400],
    ['Set up two factor', 5600, 'scan the code, then type the six digits'],
    ['Accept the terms', 1800],
    ['Account created', 900],
  ];
  var FAST = [
    ['Continue with your identity', 1400],
    ['Signed in', 800],
  ];

  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var clock = function (ms) {
    var s = Math.floor(ms / 1000);
    return (s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's');
  };

  /* The clock is driven off a start timestamp rather than incremented, so a backgrounded tab
   * that stops firing timers comes back showing the real elapsed time instead of a number
   * that quietly fell behind. */
  function runClock(node, mult) {
    var t0 = Date.now();
    var id = setInterval(function () { node.textContent = clock((Date.now() - t0) * mult); }, 90);
    return function stop() { clearInterval(id); return (Date.now() - t0) * mult; };
  }

  async function runColumn(stage, side, steps, mult, done) {
    var list = stage.querySelector('.su-' + side + ' .su-steps');
    var face = stage.querySelector('.su-' + side + ' .su-clock');
    var stop = runClock(face, mult);

    for (var i = 0; i < steps.length; i++) {
      if (stage.dataset.cancelled) return;
      var li = document.createElement('li');
      li.className = 'su-step su-running';
      li.innerHTML = '<span class="su-tick"></span><span class="su-label">' + esc(steps[i][0]) + '</span>'
        + (steps[i][2] ? '<span class="su-friction">' + esc(steps[i][2]) + '</span>' : '');
      list.appendChild(li);
      await wait(steps[i][1]);
      li.classList.remove('su-running');
      li.classList.add('su-done');
    }
    var total = stop();
    stage.querySelector('.su-' + side).classList.add('su-finished');
    face.textContent = clock(total);
    done(total);
  }

  /** @param {{service:string}} o */
  async function play(o) {
    var stage = document.createElement('div');
    stage.className = 'su-stage';
    stage.setAttribute('role', 'dialog');
    stage.setAttribute('aria-label', 'Signing up, compared');
    stage.innerHTML =
      '<div class="su-scrim"></div>' +
      '<div class="su-frame">' +
        '<div class="su-head">' +
          '<div><strong>' + esc(o.service) + ' has never heard of you</strong>' +
            '<span>Two people open it for the first time, right now.</span></div>' +
          '<button class="su-close" type="button">Skip</button>' +
        '</div>' +
        '<div class="su-cols">' +
          '<section class="su-slow su-col"><header><h4>Signing up the usual way' +
            '<span class="su-world su-world-off">Not secured by Tide</span></h4>' +
            '<div class="su-clock">0s</div></header><ol class="su-steps"></ol>' +
            '<div class="su-out"></div></section>' +
          '<section class="su-fast su-col"><header><h4>Bringing your own identity' +
            '<span class="su-world su-world-on">Secured by Tide</span></h4>' +
            '<div class="su-clock">0s</div></header><ol class="su-steps"></ol>' +
            '<div class="su-out"></div></section>' +
        '</div>' +
        '<div class="su-verdict" hidden></div>' +
      '</div>';
    document.body.appendChild(stage);
    await wait(60);
    stage.classList.add('in');

    var cancel = function () { stage.dataset.cancelled = '1'; teardown(stage); };
    stage.querySelector('.su-close').addEventListener('click', cancel);
    stage.querySelector('.su-scrim').addEventListener('click', cancel);

    var slowMs = 0, fastMs = 0;
    var fastOut = stage.querySelector('.su-fast .su-out');
    var slowOut = stage.querySelector('.su-slow .su-out');

    await Promise.all([
      runColumn(stage, 'slow', SLOW, 1, function (t) {
        slowMs = t;
        slowOut.innerHTML = '<span class="su-cost">A new password to remember</span>'
          + '<span class="su-cost">A new account that can be breached</span>';
      }),
      runColumn(stage, 'fast', FAST, 1, function (t) {
        fastMs = t;
        // The waiting is the argument, so it is stated rather than left as dead space.
        fastOut.innerHTML = '<div class="su-waiting"><span class="su-spin"></span>'
          + 'Done. Waiting for the other one to finish.</div>';
      }),
    ]);
    if (stage.dataset.cancelled) return;

    fastOut.innerHTML = '<span class="su-win">No form. No password. No account created.</span>';
    var v = stage.querySelector('.su-verdict');
    v.innerHTML = 'Same person, same service, same minute. One of them had to invent a password '
      + 'and hand it over. The other already had an identity and simply used it.';
    v.hidden = false;

    await wait(6500);
    teardown(stage);
  }

  function teardown(stage) {
    stage.classList.remove('in');
    setTimeout(function () { stage.remove(); }, 320);
  }

  window.TideSignup = { play: play };

  /* Bound from a data attribute: script-src is 'self' with no unsafe-inline, so an inline
   * handler is dropped by CSP and the button does nothing with no error to find. */
  function bind() {
    var btn = document.querySelector('[data-signup]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      play({ service: btn.dataset.service || 'This service' })
        .finally(function () { btn.disabled = false; });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
