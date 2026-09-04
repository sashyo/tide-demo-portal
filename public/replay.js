/* Replay of another person's screen. Shared by Treasury and the Clinic.
 *
 * A quorum or a two-person rule has an obvious problem in a single-user demo: the other party
 * is elsewhere, so the most important part of the mechanism happens where nobody can see it.
 * This shows it: their device, their face, their colour, their enclave prompt.
 *
 * It takes over the screen on purpose. The earlier version was a 300px card in the corner,
 * which read as a notification from this app rather than as a window into somebody else's
 * session, and the whole point is that a second person had to act. So: your page dims behind
 * a scrim, a caption names whose screen you are watching, and the window wears its own
 * browser chrome in their colour.
 *
 * Every window is stamped SIMULATED. The action being gated is real; only the second person is
 * staged, and saying so is the difference between a demo and a false claim. */
(function () {
  /* Portraits are drawn here rather than loaded, because the CSP on this app allows no
   * external images and a demo should not depend on a face service being up. Each person gets
   * a fixed set of features so they are recognisably the same person every time they appear. */
  var PEOPLE = {
    'Alice Nakamura': {
      hue: 322, initials: 'AN', role: 'Controller', handle: 'alice.nakamura',
      face: { skin: '#e8b98f', hair: '#2b2118', style: 'bob', top: '#3d4a63', glasses: false },
    },
    'Bill Fraser': {
      hue: 22, initials: 'BF', role: 'Controller', handle: 'bill.fraser',
      face: { skin: '#f0c9a4', hair: '#8a5a32', style: 'short', top: '#5a6b7a', glasses: true },
    },
    'Priya Raman': {
      hue: 200, initials: 'PR', role: 'Analyst', handle: 'priya.raman',
      face: { skin: '#c68b62', hair: '#1a1410', style: 'long', top: '#7a4b63', glasses: false },
    },
    'Marcus Chen': {
      hue: 140, initials: 'MC', role: 'Controller', handle: 'marcus.chen',
      face: { skin: '#dda87c', hair: '#231a14', style: 'short', top: '#3f5c4a', glasses: false },
    },
    'Dr Ellis': {
      hue: 168, initials: 'DE', role: 'Treating clinician', handle: 'e.ellis',
      face: { skin: '#b0784f', hair: '#141010', style: 'curls', top: '#e8eef2', glasses: true },
    },
    'Dr Hale': {
      hue: 96, initials: 'DH', role: 'Clinical lead', handle: 'j.hale',
      face: { skin: '#f2d3b3', hair: '#b9b3ab', style: 'short', top: '#e8eef2', glasses: true },
    },
  };
  var FALLBACK = {
    hue: 42, initials: '··', role: 'Colleague', handle: 'colleague',
    face: { skin: '#ddb894', hair: '#3a3028', style: 'short', top: '#61708a', glasses: false },
  };

  /* Beats, in milliseconds. Tuned to be watchable rather than efficient: the whole point of
   * the replay is that somebody sees the second approval happen, and at the original pace the
   * enclave prompt was gone before it could be read. Roughly twelve seconds end to end. */
  var T = {
    fadeIn: 180,
    settle: 1500,   // window on screen, nothing happening yet, time to take it in
    travel: 1200,   // cursor crossing to the button
    press: 380,     // button held down
    afterPress: 600,
    readPrompt: 2000, // the enclave question on screen before the cursor moves
    afterYes: 900,    // the button held down and visibly pressed, before anything changes
    cursorOut: 320,   // pointer fades before the result panel takes over
    showDone: 2400,
    fadeOut: 420,
  };

  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** A small flat portrait. Inline SVG, so no img-src and no network. */
  function portrait(f) {
    var hair = {
      short: '<path d="M14 30c0-9 6-15 16-15s16 6 16 15c0 0-3-6-16-6s-16 6-16 6z" fill="' + f.hair + '"/>',
      bob: '<path d="M13 34c0-11 7-19 17-19s17 8 17 19v6h-6V29c0-5-11-4-11-4s-11-1-11 4v11h-6z" fill="' + f.hair + '"/>',
      long: '<path d="M13 34c0-11 7-19 17-19s17 8 17 19v18h-7V29c0-5-10-4-10-4s-10-1-10 4v23h-7z" fill="' + f.hair + '"/>',
      curls: '<g fill="' + f.hair + '"><circle cx="18" cy="26" r="7"/><circle cx="30" cy="20" r="8"/>'
           + '<circle cx="42" cy="26" r="7"/><circle cx="24" cy="21" r="7"/><circle cx="36" cy="21" r="7"/></g>',
    }[f.style] || '';
    return '<svg viewBox="0 0 60 60" width="100%" height="100%" aria-hidden="true">'
      + '<circle cx="30" cy="30" r="30" fill="#fff" opacity=".9"/>'
      + '<path d="M8 60c0-11 10-17 22-17s22 6 22 17z" fill="' + f.top + '"/>'
      + '<rect x="21" y="33" width="18" height="12" rx="5" fill="' + f.skin + '"/>'
      + '<ellipse cx="30" cy="30" rx="13" ry="15" fill="' + f.skin + '"/>'
      + hair
      + '<circle cx="25" cy="30" r="1.7" fill="#2a2320"/><circle cx="35" cy="30" r="1.7" fill="#2a2320"/>'
      + '<path d="M26 37c2 2 6 2 8 0" stroke="#2a2320" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
      + (f.glasses
          ? '<g stroke="#2a2320" stroke-width="1.3" fill="none" opacity=".85">'
            + '<circle cx="25" cy="30" r="4.6"/><circle cx="35" cy="30" r="4.6"/>'
            + '<path d="M29.6 30h.8M20.4 29l-2-1M39.6 29l2-1"/></g>'
          : '')
      + '</svg>';
  }

  function moveCursor(cursor, target, stage) {
    var t = target.getBoundingClientRect(), s = stage.getBoundingClientRect();
    cursor.style.left = (t.left - s.left + t.width / 2) + 'px';
    cursor.style.top = (t.top - s.top + t.height / 2) + 'px';
  }

  /**
   * @param {{name:string, app:string, ref?:string, headline:string,
   *          question:string, action?:string, settled?:string}} o
   */
  async function play(o) {
    var who = PEOPLE[o.name] || FALLBACK;
    var stage = document.createElement('div');
    stage.className = 'sim-stage';
    stage.setAttribute('role', 'dialog');
    stage.setAttribute('aria-label', 'Simulated view of ' + o.name + "'s screen");
    stage.style.setProperty('--ch', who.hue);
    stage.innerHTML =
      '<div class="sim-scrim"></div>' +
      '<div class="sim-frame">' +
        '<div class="sim-caption">' +
          '<span class="sim-live"><i></i>Another person, another device</span>' +
          '<span class="sim-said">You are watching <strong>' + esc(o.name) +
          '</strong> act on their own screen</span>' +
        '</div>' +
        '<div class="sim-win">' +
          '<div class="sim-chrome">' +
            '<span class="sim-dots"><i></i><i></i><i></i></span>' +
            '<span class="sim-url">' + esc(o.app) + '<span>/' + esc(who.handle) + '</span></span>' +
            '<span class="sim-tagline">simulated</span>' +
          '</div>' +
          '<div class="sim-bar">' +
            '<span class="sim-avatar">' + portrait(who.face) + '</span>' +
            '<span class="sim-name">' + esc(o.name) + '<em>' + esc(who.role) + '</em></span>' +
            '<span class="sim-session">signed in</span>' +
          '</div>' +
          '<div class="sim-screen">' +
            '<div class="sim-body">' +
              (o.ref ? '<div class="sim-run">' + esc(o.ref) + '</div>' : '') +
              '<div class="sim-amt">' + esc(o.headline) + '</div>' +
              '<button class="sim-approve" type="button">' + esc(o.action || 'Approve') + '</button>' +
            '</div>' +
            /* Drawn to match the real Tide enclave: blue diagonal ground, the round Tide
             * Cloak badge on the left, a white card on the right with a pill button. It is
             * deliberately NOT in the person's hue. The enclave looks the same for everyone
             * because it is not their app, and that is the point being demonstrated. */
            '<div class="sim-enclave" hidden>' +
              '<div class="sim-enc-badge"><span>Tide</span><b>CLOAK</b></div>' +
              '<div class="sim-enc-card">' +
                '<div class="sim-enc-back">&larr; Back</div>' +
                '<h4>Approve request</h4>' +
                '<p>' + esc(o.question) + '</p>' +
                '<div class="sim-enclave-actions">' +
                  '<button class="sim-deny" type="button">Deny</button>' +
                  '<button class="sim-yes" type="button">Approve</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="sim-done" hidden>' +
              '<span class="sim-tick">✓</span>' + esc(o.settled || 'Signed in enclave') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sim-cursor"></div>';
    document.body.appendChild(stage);

    var cursor = stage.querySelector('.sim-cursor');
    var approve = stage.querySelector('.sim-approve');
    var enclave = stage.querySelector('.sim-enclave');
    var yes = stage.querySelector('.sim-yes');
    var done = stage.querySelector('.sim-done');

    await wait(T.fadeIn); stage.classList.add('in');
    await wait(T.settle); moveCursor(cursor, approve, stage);
    await wait(T.travel); cursor.classList.add('click'); approve.classList.add('pressed');
    await wait(T.press); cursor.classList.remove('click');
    await wait(T.afterPress);

    enclave.hidden = false;
    await wait(T.readPrompt); moveCursor(cursor, yes, stage);
    await wait(T.travel); cursor.classList.add('click'); yes.classList.add('pressed');
    await wait(T.press); cursor.classList.remove('click');
    await wait(T.afterYes);

    // Take the pointer away before the result panel replaces the buttons. Left on screen it
    // hovers over an empty panel and reads as a click landing on nothing, which is the one
    // impression this whole sequence must not give.
    cursor.classList.add('gone');
    await wait(T.cursorOut);

    enclave.hidden = true; done.hidden = false;
    await wait(T.showDone);
    stage.classList.remove('in');
    await wait(T.fadeOut); stage.remove();
  }

  window.TideReplay = { play: play, people: PEOPLE, timings: T };
})();
