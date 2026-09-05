/* Northwind Access: asking for privileged access, for real.
 *
 * Everything on this panel is a live call against the workspace. Pressing the button files an
 * actual IGA change request to grant a role to the signed-in administrator, and the panel then
 * reads the realm's own pending list back and tries to approve it.
 *
 * The approval fails, and that is the demonstration. The person asking is the only
 * administrator this workspace has, holds every other role, and still cannot give themselves
 * this one, because the request needs a signature from somebody who did not raise it. There is
 * no override, no break-glass and no support desk that can be talked into it. Not because the
 * app refuses, but because the network will not seal a change the governance model has not
 * approved.
 *
 * The role is access-break-glass, which is deliberately left out of the default composite when
 * a workspace is created. Every other role is handed to everyone on sight so the demos work
 * without an admin in the loop; this one has to be something you genuinely do not have, or
 * asking for it proves nothing. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function line(html, cls) {
    var log = $('ax-log');
    var d = document.createElement('div');
    d.className = 'ax-line' + (cls ? ' ' + cls : '');
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function verdict(state, title, body) {
    var v = $('ax-verdict');
    v.hidden = false;
    v.className = 'ax-verdict ax-verdict-' + state;
    v.innerHTML = '<strong>' + title + '</strong><span>' + body + '</span>';
    v.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function run(btn) {
    btn.disabled = true;
    $('ax-log').innerHTML = '';
    $('ax-verdict').hidden = true;

    try {
      line('Asking the workspace for <b>access-break-glass</b>...');
      var r = await fetch('/access/api/break-glass', { method: 'POST' });
      var out = await r.json();

      if (!r.ok && !out.queued) {
        line('The request was rejected: ' + esc(out.error || r.status), 'ax-bad');
        verdict('bad', 'Could not file the request',
          'This usually means the workspace predates the break-glass role. A workspace created '
          + 'from here on will have it.');
        btn.disabled = false;
        return;
      }

      // 202, not 200. The grant is not applied; it is filed.
      line('Filed. The workspace answered <b>202 Accepted</b>, not 200.', 'ax-ok');
      line('Nothing has been granted yet. A change request now exists on the realm.');
      await wait(900);

      line('Reading the realm\'s pending change requests...');
      var list = await (await fetch('/access/api/change-requests?status=PENDING')).json();
      var items = Array.isArray(list) ? list : (list.requests || list.changeRequests || []);
      var mine = items.filter(function (i) {
        return /ROLE/i.test(i.actionType || '') || /ROLE/i.test(i.action || '');
      });
      var item = mine[0] || items[0];

      if (!item) {
        line('No pending request came back, which should not happen after a 202.', 'ax-bad');
        verdict('bad', 'Filed, but not visible',
          'The grant was accepted and the pending list is empty. Worth checking the realm '
          + 'directly before trusting either answer.');
        btn.disabled = false;
        return;
      }

      var id = item.draftRecordId || item.id;
      line('<b>' + esc(item.actionType || 'ROLE CHANGE') + '</b> '
        + '<span class="ax-dim">' + esc(String(id).slice(0, 8)) + '</span> '
        + esc(item.status || 'PENDING'), 'ax-ok');
      await wait(900);

      // The point of the whole panel.
      line('Trying to approve it, as the administrator who asked for it...');
      var ap = await fetch('/access/api/change-requests/' + encodeURIComponent(id) + '/approval-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      var apOut = await ap.json().catch(function () { return {}; });
      await wait(600);

      if (ap.status === 409) {
        line('<b>409</b> ' + esc(apOut.error || 'a different administrator must approve this'), 'ax-bad');
        verdict('good', 'You cannot approve your own request',
          'You are the only administrator this workspace has. You hold every other role in it. '
          + 'And you cannot give yourself this one, because the change needs a signature from '
          + 'somebody who did not raise it. There is no override to find: the network will not '
          + 'seal a change the governance model has not approved.');
      } else if (ap.ok) {
        line('approval-model returned ' + ap.status, 'ax-ok');
        verdict('bad', 'It let you approve your own request',
          'That should not happen on a Tide-attested realm. Worth checking whether this '
          + 'workspace is running in Tideless mode, where the quorum is counted by server '
          + 'logic rather than enforced cryptographically.');
      } else {
        line(esc(String(ap.status)) + ' ' + esc(apOut.error || 'approval refused'), 'ax-bad');
        verdict('good', 'The request is still sitting there',
          'It was filed, it is pending, and it did not go through on your say-so. It waits for '
          + 'an approver who did not raise it.');
      }
    } catch (err) {
      line('Request failed: ' + esc(String(err && err.message ? err.message : err)), 'ax-bad');
      verdict('bad', 'Could not reach the workspace', 'Nothing was changed.');
    }
    btn.disabled = false;
  }

  /* Bound from a data attribute: script-src here is 'self' with no unsafe-inline, so an inline
   * handler is dropped by CSP and the button does nothing with no error to find. */
  function bind() {
    var btn = document.querySelector('[data-breakglass]');
    if (btn) btn.addEventListener('click', function () { run(btn); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
