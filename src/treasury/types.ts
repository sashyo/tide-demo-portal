export type Person = { sub: string; name: string };

export type Account = {
  id: string; name: string; bsb: string; number: string; balanceCents: number;
};

export type Supplier = {
  id: string; name: string; abn: string; bsb: string; account: string;
  terms: string; lastPaid: string | null;
  /** Set when bank details were changed — the field auditors actually look at. */
  bankChangedAt: string | null;
};

export type Txn = { id: string; accountId: string; at: string; desc: string; cents: number };

export type Approval = {
  by: Person;
  at: string;
  device: string;
  /**
   * True for a staged colleague rather than a real signer.
   *
   * This flag exists so the UI can SAY SO. A demo may stage what a three-person quorum looks
   * like, but it may not present a staged approval as a cryptographic signature — that is the
   * one claim the whole product rests on, and faking it in the demo would be the single most
   * damaging thing here.
   */
  simulated?: boolean;
  /**
   * Base64 threshold signature produced in the approver's enclave.
   *
   * Its presence is the ONLY thing that lets an approval be described as signed. An approval
   * without it is not a signature and must never be rendered as one.
   */
  signature?: string;
};

export type RunStatus = 'draft' | 'awaiting_approval' | 'released' | 'cancelled';

export type PaymentRun = {
  id: string;
  accountId: string;
  status: RunStatus;
  createdAt: string;
  createdBy: Person;
  lines: { supplierId: string; invoice: string; cents: number }[];
  approvals: Approval[];
  releasedAt: string | null;
  /** How many approvals this run is presented as needing. */
  threshold?: number;
};

/** A pending change to a supplier's bank details — the invoice-redirection control. */
export type BankChange = {
  id: string;
  supplierId: string;
  bsb: string;
  account: string;
  requestedAt: string;
  requestedBy: Person;
  approvals: Approval[];
  appliedAt: string | null;
};
