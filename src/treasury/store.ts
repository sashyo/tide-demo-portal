import { ACCOUNTS, RUNS, SUPPLIERS, THRESHOLD_CENTS, TXNS } from './seed.js';
import type { Account, BankChange, PaymentRun, Person, Supplier, Txn } from './types.js';

/**
 * Per-realm treasury state.
 *
 * Each tenant realm gets its own books, seeded fresh. In memory on purpose: a demo should
 * reset cleanly, and nothing here is worth persisting. State that matters — who someone is
 * and what they may do — lives in the realm, not in this file.
 */
type Book = {
  accounts: Account[];
  suppliers: Supplier[];
  txns: Txn[];
  runs: PaymentRun[];
  bankChanges: BankChange[];
  seq: number;
};

const books = new Map<string, Book>();

export function book(realm: string): Book {
  let b = books.get(realm);
  if (!b) {
    b = {
      accounts: structuredClone(ACCOUNTS),
      suppliers: structuredClone(SUPPLIERS),
      txns: structuredClone(TXNS),
      runs: structuredClone(RUNS),
      bankChanges: [],
      seq: 2292,
    };
    books.set(realm, b);
  }
  return b;
}

export function reset(realm: string): void {
  books.delete(realm);
}

export const total = (run: PaymentRun): number => run.lines.reduce((n, l) => n + l.cents, 0);

export const needsTwo = (run: PaymentRun): boolean => total(run) >= THRESHOLD_CENTS;

/**
 * Colleagues staged after the visitor approves, so one person can see what a quorum looks like.
 *
 * REAL authority is threshold-of-one here: the visitor's approval is what actually releases the
 * money, and it is the only one carrying a genuine identity. These two exist to show the shape
 * of a 3-of-3 treasury, and every surface that renders them marks them as staged.
 */
const COLLEAGUES: Person[] = [
  { sub: 'demo-alice', name: 'Alice Nakamura' },
  { sub: 'demo-bill', name: 'Bill Fraser' },
];

/** How many approvals a large run is PRESENTED as needing. */
export const QUORUM = 3;

export const quorumOf = (run: PaymentRun): number =>
  needsTwo(run) ? (run.threshold ?? QUORUM) : 1;

export const quorumMet = (run: PaymentRun): boolean => run.approvals.length >= quorumOf(run);

/**
 * Why a given person may not approve right now — or null if they may.
 *
 * Four eyes means two DIFFERENT people, and "different" is decided on the subject claim from a
 * verified token, never on a display name or an email a caller could set. The person who
 * prepared the run has already contributed their approval by preparing it, so they cannot also
 * be the second signature; this is the rule the whole demo turns on.
 */
export function approvalBlocker(run: PaymentRun, who: Person, roles: string[]): string | null {
  if (run.status === 'released') return 'This run has already been released.';
  if (run.status === 'cancelled') return 'This run was cancelled.';
  if (!roles.includes('treasury-controller') && !roles.includes('treasury-analyst')) {
    return 'You do not have a treasury role on this realm.';
  }
  if (run.approvals.some((a) => a.by.sub === who.sub)) {
    return run.createdBy.sub === who.sub
      ? 'You prepared this run, so your approval already counts once. It needs a different person.'
      : 'You have already approved this run.';
  }
  if (needsTwo(run) && !roles.includes('treasury-controller')) {
    return 'Runs at or above $10,000 need a controller as the second approver.';
  }
  return null;
}

export function approve(
  realm: string, runId: string, who: Person, roles: string[], device: string, signature?: string,
): { ok: true; run: PaymentRun } | { ok: false; reason: string } {
  const b = book(realm);
  const run = b.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, reason: 'No such payment run.' };

  const blocker = approvalBlocker(run, who, roles);
  if (blocker) return { ok: false, reason: blocker };

  run.approvals.push({ by: who, at: new Date().toISOString(), device, signature });

  // Stage the colleagues arriving one at a time, so the run page (which polls) shows them
  // appearing rather than materialising all at once. The money moves when the quorum is
  // complete, which keeps the on-screen sequence honest about the order of events.
  const needed = quorumOf(run) - run.approvals.length;
  for (let i = 0; i < Math.min(needed, COLLEAGUES.length); i++) {
    const person = COLLEAGUES[i];
    const delay = 2500 * (i + 1);
    setTimeout(() => {
      const live = book(realm).runs.find((r) => r.id === runId);
      if (!live || live.status !== 'awaiting_approval') return;
      if (live.approvals.some((a) => a.by.sub === person.sub)) return;
      live.approvals.push({
        by: person,
        at: new Date().toISOString(),
        device: 'Simulated colleague',
        simulated: true,
      });
      if (live.approvals.length >= quorumOf(live)) release(book(realm), live);
    }, delay).unref?.();
  }

  if (run.approvals.length >= quorumOf(run)) release(b, run);
  return { ok: true, run };
}

/** Move the money and write the ledger, so balances and history stay consistent. */
function release(b: Book, run: PaymentRun): void {
  const account = b.accounts.find((a) => a.id === run.accountId);
  const amount = total(run);
  if (account) account.balanceCents -= amount;

  const names = run.lines
    .map((l) => b.suppliers.find((s) => s.id === l.supplierId)?.name ?? 'Supplier')
    .filter((v, i, arr) => arr.indexOf(v) === i);

  b.txns.unshift({
    id: `t-${run.id}`,
    accountId: run.accountId,
    at: new Date().toISOString(),
    desc: `${run.id} · ${names.join(', ')}`,
    cents: -amount,
  });
  run.status = 'released';
  run.releasedAt = new Date().toISOString();
}

/**
 * Changing a supplier's bank details goes through the same second signature as a large
 * payment. This is the control that invoice-redirection fraud attacks: an email asking finance
 * to "update our account for future invoices", and one person able to act on it.
 */
export function requestBankChange(
  realm: string, supplierId: string, bsb: string, account: string, who: Person,
): BankChange | null {
  const b = book(realm);
  if (!b.suppliers.some((s) => s.id === supplierId)) return null;
  const change: BankChange = {
    id: `BC-${b.seq++}`,
    supplierId, bsb, account,
    requestedAt: new Date().toISOString(),
    requestedBy: who,
    approvals: [{ by: who, at: new Date().toISOString(), device: 'this session' }],
    appliedAt: null,
  };
  b.bankChanges.push(change);
  return change;
}

export function approveBankChange(realm: string, id: string, who: Person, roles: string[]):
  { ok: true; change: BankChange } | { ok: false; reason: string } {
  const b = book(realm);
  const change = b.bankChanges.find((c) => c.id === id);
  if (!change) return { ok: false, reason: 'No such request.' };
  if (change.appliedAt) return { ok: false, reason: 'Already applied.' };
  if (change.approvals.some((a) => a.by.sub === who.sub)) {
    return { ok: false, reason: 'You requested this change, so it needs a different person to approve it.' };
  }
  if (!roles.includes('treasury-controller')) {
    return { ok: false, reason: 'Bank detail changes need a controller to approve.' };
  }

  change.approvals.push({ by: who, at: new Date().toISOString(), device: 'this session' });
  const supplier = b.suppliers.find((s) => s.id === change.supplierId);
  if (supplier) {
    supplier.bsb = change.bsb;
    supplier.account = change.account;
    supplier.bankChangedAt = new Date().toISOString();
  }
  change.appliedAt = new Date().toISOString();
  return { ok: true, change };
}

export function createRun(
  realm: string, accountId: string, lines: PaymentRun['lines'], who: Person,
): PaymentRun {
  const b = book(realm);
  const run: PaymentRun = {
    id: `PR-${b.seq++}`,
    accountId,
    status: 'awaiting_approval',
    createdAt: new Date().toISOString(),
    createdBy: who,
    lines,
    // Preparing a run IS the first approval. Making that explicit is what lets the app say
    // "your approval already counts once" rather than silently requiring two more clicks.
    approvals: [{ by: who, at: new Date().toISOString(), device: 'this session' }],
    releasedAt: null,
  };
  b.runs.unshift(run);
  // Preparing a run counts as its first approval, so a run below the threshold already has
  // everything it needs. Without this it sits in the queue forever waiting for a second
  // signature the policy never asked for.
  if (!needsTwo(run)) release(b, run);
  return run;
}

export { THRESHOLD_CENTS, COLLEAGUES };
export type { Supplier, PaymentRun, Person };
