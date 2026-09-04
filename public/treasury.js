/* Run page: watch for approvals, and replay each colleague's approval on screen.
 *
 * A quorum demo has an obvious problem for one person: the other approvers are elsewhere, so
 * the most important part of the mechanism happens where you cannot see it. This replays it —
 * a small window in the other person's context, in their colour, with their own enclave prompt.
 *
 * It is explicitly labelled SIMULATED. Showing someone else's approval without saying so would
 * misrepresent the one thing the demo exists to demonstrate. */
(function () {
  var runId = location.pathname.split('/').pop();
  var seen = null;          // names already shown
  var busy = false;         // a replay is on screen
  var pending = [];         // colleagues waiting to be replayed

  async function replay(name, meta) {
    busy = true;
    await window.TideReplay.play({
      name: name,
      app: 'Northwind Treasury',
      ref: meta.id,
      headline: meta.amount || '',
      question: 'Approve ' + (meta.id || 'this payment') + ' for ' + (meta.amount || '') + '?',
    });
    busy = false;
  }

  async function drain(meta) {
    while (pending.length) {
      await replay(pending.shift(), meta);
    }
    // Re-render once the queue is empty so the page reflects the final state.
    location.reload();
  }

  setInterval(function () {
    if (busy || pending.length) return;
    fetch('/treasury/api/runs/' + encodeURIComponent(runId), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.approvals)) return;
        var names = d.approvals.map(function (a) { return a.name; });
        if (seen === null) { seen = names; return; }          // first poll sets the baseline
        var fresh = names.filter(function (n) { return seen.indexOf(n) === -1; });
        if (!fresh.length) return;
        seen = names;
        // Replay staged colleagues; a real approver's own action needs no dramatisation.
        var staged = d.approvals.filter(function (a) {
          return a.simulated && fresh.indexOf(a.name) !== -1;
        }).map(function (a) { return a.name; });
        if (staged.length) { pending = staged; drain(d); }
        else location.reload();
      })
      .catch(function () {});
  }, 1500);
})();
