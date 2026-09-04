import type { Account, PaymentRun, Supplier, Txn } from './types.js';

/**
 * Two weeks of plausible history.
 *
 * This is not decoration. A treasury console with four transactions reads as a toy; one where
 * a finance person can ask "what happened last Thursday" and get an answer reads as a system.
 * Balances below are consistent with the transaction list — if they drift, the demo quietly
 * stops being believable to exactly the audience it is aimed at.
 */

const day = (offset: number, h = 10, m = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const ACCOUNTS: Account[] = [
  { id: 'acc-op', name: 'Operating', bsb: '083-004', number: '••• 4471', balanceCents: 1_284_65000 },
  { id: 'acc-pay', name: 'Payroll', bsb: '083-004', number: '••• 8820', balanceCents: 412_09000 },
  { id: 'acc-res', name: 'Reserve', bsb: '083-004', number: '••• 1163', balanceCents: 3_500_00000 },
];

export const SUPPLIERS: Supplier[] = [
  { id: 'sup-1', name: 'Kestrel Logistics', abn: '54 112 887 001', bsb: '063-118', account: '••• 2214',
    terms: 'Net 30', lastPaid: day(-9), bankChangedAt: null },
  { id: 'sup-2', name: 'Halden Print & Packaging', abn: '18 004 552 118', bsb: '013-442', account: '••• 7781',
    terms: 'Net 14', lastPaid: day(-4), bankChangedAt: null },
  { id: 'sup-3', name: 'Ridgeway Facilities', abn: '77 610 224 903', bsb: '083-170', account: '••• 3390',
    terms: 'Net 30', lastPaid: day(-12), bankChangedAt: day(-31) },
  { id: 'sup-4', name: 'Ambourne Legal', abn: '29 445 118 226', bsb: '032-002', account: '••• 5518',
    terms: 'Net 7', lastPaid: day(-2), bankChangedAt: null },
  { id: 'sup-5', name: 'Northwind Cloud Services', abn: '91 338 774 210', bsb: '062-000', account: '••• 9004',
    terms: 'Net 30', lastPaid: day(-6), bankChangedAt: null },
];

export const TXNS: Txn[] = [
  { id: 't-1', accountId: 'acc-op', at: day(-13, 9, 12), desc: 'Customer receipt · Brightline Pty Ltd', cents: 148_20000 },
  { id: 't-2', accountId: 'acc-op', at: day(-12, 14, 40), desc: 'PR-2277 · Ridgeway Facilities', cents: -18_40000 },
  { id: 't-3', accountId: 'acc-pay', at: day(-11, 6, 0), desc: 'Payroll run · 34 employees', cents: -186_55000 },
  { id: 't-4', accountId: 'acc-op', at: day(-9, 15, 22), desc: 'PR-2281 · Kestrel Logistics', cents: -42_80000 },
  { id: 't-5', accountId: 'acc-op', at: day(-8, 11, 5), desc: 'Customer receipt · Ardenne Group', cents: 96_75000 },
  { id: 't-6', accountId: 'acc-op', at: day(-6, 16, 48), desc: 'PR-2284 · Northwind Cloud Services', cents: -12_18000 },
  { id: 't-7', accountId: 'acc-res', at: day(-5, 10, 0), desc: 'Transfer from Operating', cents: 250_00000 },
  { id: 't-8', accountId: 'acc-op', at: day(-5, 10, 0), desc: 'Transfer to Reserve', cents: -250_00000 },
  { id: 't-9', accountId: 'acc-op', at: day(-4, 13, 30), desc: 'PR-2287 · Halden Print & Packaging', cents: -7_44000 },
  { id: 't-10', accountId: 'acc-op', at: day(-2, 9, 55), desc: 'PR-2289 · Ambourne Legal', cents: -9_90000 },
  { id: 't-11', accountId: 'acc-op', at: day(-1, 15, 10), desc: 'Customer receipt · Brightline Pty Ltd', cents: 212_40000 },
];

/**
 * One run already released, one overdue and waiting. The waiting one is deliberately over the
 * threshold, so the four-eyes moment is the first thing a visitor meets rather than something
 * they have to construct.
 */
export const RUNS: PaymentRun[] = [
  {
    id: 'PR-2289', accountId: 'acc-op', status: 'released',
    createdAt: day(-2, 9, 20), createdBy: { sub: 'seed-analyst', name: 'Priya Raman' },
    lines: [{ supplierId: 'sup-4', invoice: 'AL-88214', cents: 9_90000 }],
    // Seeded approvals are marked simulated for the same reason the staged colleagues are:
    // they are history invented for the demo, not signatures anyone produced. Only the
    // visitor's own approval should ever render as "signed".
    approvals: [
      { by: { sub: 'seed-analyst', name: 'Priya Raman' }, at: day(-2, 9, 21), device: 'Chrome · macOS', simulated: true },
      { by: { sub: 'seed-controller', name: 'Marcus Chen' }, at: day(-2, 9, 48), device: 'iPhone', simulated: true },
    ],
    releasedAt: day(-2, 9, 55),
  },
  {
    id: 'PR-2291', accountId: 'acc-op', status: 'awaiting_approval',
    createdAt: day(-1, 14, 22), createdBy: { sub: 'seed-analyst', name: 'Priya Raman' },
    lines: [
      { supplierId: 'sup-1', invoice: 'KL-40118', cents: 28_60000 },
      { supplierId: 'sup-3', invoice: 'RF-20894', cents: 12_15000 },
      { supplierId: 'sup-5', invoice: 'NW-77310', cents: 6_25000 },
    ],
    approvals: [{ by: { sub: 'seed-analyst', name: 'Priya Raman' }, at: day(-1, 14, 22), device: 'Chrome · macOS', simulated: true }],
    releasedAt: null,
  },
];

/** Anything at or above this needs a second, different approver. */
export const THRESHOLD_CENTS = 10_000_00;
