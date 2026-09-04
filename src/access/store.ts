export type Person = { sub: string; name: string };
export type Kind = 'staff' | 'contractor' | 'service';

export type Member = {
  id: string; name: string; team: string; kind: Kind;
  /** Null for permanent staff. Contractors always have one — that is the point of them. */
  accessEnds: string | null;
  sessions: number;
  grants: string[];
};

export type Elevation = {
  id: string; who: string; scope: string; reason: string;
  minutes: number; requestedAt: string;
  approvedBy: string | null; approvedAt: string | null;
};

type Org = { people: Member[]; elevations: Elevation[]; seq: number };

const orgs = new Map<string, Org>();
const at = (days: number, h = 9): string => {
  const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString();
};

export function org(realm: string): Org {
  let o = orgs.get(realm);
  if (!o) {
    o = {
      people: [
        { id: 'p1', name: 'Priya Raman', team: 'Finance', kind: 'staff', accessEnds: null, sessions: 2,
          grants: ['Treasury · Analyst'] },
        { id: 'p2', name: 'Marcus Chen', team: 'Finance', kind: 'staff', accessEnds: null, sessions: 1,
          grants: ['Treasury · Controller'] },
        { id: 'p3', name: 'Sam Okafor', team: 'Engineering', kind: 'staff', accessEnds: null, sessions: 3,
          grants: ['Production · read'] },
        { id: 'p4', name: 'Dan Whitfield', team: 'External', kind: 'contractor', accessEnds: at(18, 17), sessions: 1,
          grants: ['Treasury · read-only'] },
        { id: 'p5', name: 'Ana Boyd', team: 'External', kind: 'contractor', accessEnds: at(-3, 17), sessions: 0,
          grants: [] },
        { id: 'p6', name: 'nightly-reconcile', team: 'Automation', kind: 'service', accessEnds: null, sessions: 0,
          grants: ['Treasury · read'] },
      ],
      elevations: [
        // Approved 8 minutes ago, so a visitor always finds it live with ~22 minutes left.
        // Pinning it to a wall-clock hour meant it read as expired for most of the day.
        { id: 'EL-4402', who: 'Sam Okafor', scope: 'Production database · read/write', minutes: 30,
          reason: 'INC-2214 — payment retries stuck',
          requestedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
          approvedBy: 'Marcus Chen', approvedAt: new Date(Date.now() - 8 * 60_000).toISOString() },
      ],
      seq: 4403,
    };
    orgs.set(realm, o);
  }
  return o;
}

export const expired = (m: Member): boolean =>
  m.accessEnds !== null && new Date(m.accessEnds).getTime() < Date.now();

/** Minutes left on an elevation, or 0 once it has lapsed. Nothing revokes it — time does. */
export function remaining(e: Elevation): number {
  if (!e.approvedAt) return 0;
  const endsAt = new Date(e.approvedAt).getTime() + e.minutes * 60_000;
  return Math.max(0, Math.round((endsAt - Date.now()) / 60_000));
}

export function addContractor(realm: string, name: string, days: number, grant: string): Member {
  const o = org(realm);
  const m: Member = {
    id: `p${o.seq++}`, name, team: 'External', kind: 'contractor',
    accessEnds: at(days, 17), sessions: 0, grants: [grant],
  };
  o.people.push(m);
  return m;
}

export function requestElevation(realm: string, who: string, scope: string, reason: string, minutes: number): Elevation {
  const o = org(realm);
  const e: Elevation = {
    id: `EL-${o.seq++}`, who, scope, reason, minutes,
    requestedAt: new Date().toISOString(), approvedBy: null, approvedAt: null,
  };
  o.elevations.unshift(e);
  return e;
}

export function approveElevation(realm: string, id: string, by: Person):
  { ok: true } | { ok: false; reason: string } {
  const e = org(realm).elevations.find((x) => x.id === id);
  if (!e) return { ok: false, reason: 'No such request.' };
  if (e.approvedAt) return { ok: false, reason: 'Already approved.' };
  // Same rule as the treasury: you cannot approve your own elevation. Compare the request's
  // owner against the APPROVER — an earlier signature took the requester as a separate
  // argument, which meant callers compared the requester with themselves and every legitimate
  // approval was refused.
  if (e.who === by.name) return { ok: false, reason: 'You requested this elevation, so someone else has to approve it.' };
  e.approvedBy = by.name;
  e.approvedAt = new Date().toISOString();
  return { ok: true };
}
