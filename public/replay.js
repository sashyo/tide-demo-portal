/* Replay of another person's screen — shared by Treasury and the Clinic.
 *
 * A quorum or a two-person rule has an obvious problem in a single-user demo: the other party
 * is elsewhere, so the most important part of the mechanism happens where nobody can see it.
 * This shows it — their window, their colour, their avatar, their enclave prompt.
 *
 * Every window is stamped SIMULATED. The action being gated is real; only the second person is
 * staged, and saying so is the difference between a demo and a false claim. */
(function () {
  var PEOPLE = {
    'Alice Nakamura': { hue: 322, initials: 'AN', role: 'Controller' },
    'Bill Fraser':    { hue: 22,  initials: 'BF', role: 'Controller' },
    'Priya Raman':    { hue: 200, initials: 'PR', role: 'Analyst' },
    'Marcus Chen':    { hue: 140, initials: 'MC', role: 'Controller' },
    'Dr Ellis':       { hue: 168, initials: 'DE', role: 'Treating clinician' },
    'Dr Hale':        { hue: 96 , initials: 'DH', role: 'Clinical lead' },
  };
  var FALLBACK = { hue: 42 , initials: '··', role: 'Colleague' };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

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
    stage.style.setProperty('--ch', who.hue);
    stage.innerHTML =
      '<div class="sim-win">' +
        '<div class="sim-bar">' +
          '<span class="sim-avatar">' + who.initials + '</span>' +
          '<span class="sim-name">' + o.name + '<em>' + who.role + '</em></span>' +
          '<span class="sim-tagline">simulated</span>' +
        '</div>' +
        '<div class="sim-body">' +
          '<div class="sim-app">' + o.app + '</div>' +
          (o.ref ? '<div class="sim-run">' + o.ref + '</div>' : '') +
          '<div class="sim-amt">' + o.headline + '</div>' +
          '<button class="sim-approve" type="button">' + (o.action || 'Approve') + '</button>' +
        '</div>' +
        '<div class="sim-enclave" hidden>' +
          '<div class="sim-enclave-head">Tide enclave</div>' +
          '<p>' + o.question + '</p>' +
          '<div class="sim-enclave-actions">' +
            '<button class="sim-deny" type="button">Deny</button>' +
            '<button class="sim-yes" type="button">Approve</button>' +
          '</div>' +
        '</div>' +
        '<div class="sim-done" hidden>' + (o.settled || 'Signed in enclave') + '</div>' +
      '</div><div class="sim-cursor"></div>';
    document.body.appendChild(stage);

    var cursor = stage.querySelector('.sim-cursor');
    var approve = stage.querySelector('.sim-approve');
    var enclave = stage.querySelector('.sim-enclave');
    var yes = stage.querySelector('.sim-yes');
    var done = stage.querySelector('.sim-done');

    await wait(120); stage.classList.add('in');
    await wait(450); moveCursor(cursor, approve, stage);
    await wait(700); cursor.classList.add('click'); approve.classList.add('pressed');
    await wait(220); cursor.classList.remove('click');

    enclave.hidden = false;
    await wait(500); moveCursor(cursor, yes, stage);
    await wait(750); cursor.classList.add('click'); yes.classList.add('pressed');
    await wait(240); cursor.classList.remove('click');

    enclave.hidden = true; done.hidden = false;
    await wait(950);
    stage.classList.remove('in');
    await wait(320); stage.remove();
  }

  window.TideReplay = { play: play, people: PEOPLE };
})();
