/**
 * Marrindale Services — a citizen services portal for a deliberately invented jurisdiction.
 *
 * The name is fictional on purpose. Borrowing a real government service's name or crest would
 * make this an impersonation of a live public system rather than a demo, and the comparison
 * lands anyway: it happens in the visitor's memory of using the real thing.
 */
export type AgencyId = 'transport' | 'revenue' | 'health';

export type Agency = {
  id: AgencyId; name: string; blurb: string; icon: string;
  /** Exactly what this agency is told. Different per agency — that is the whole argument. */
  discloses: string[];
  action: string;
};

export const AGENCIES: Agency[] = [
  {
    id: 'transport', name: 'Marrindale Transport', icon: '🚗',
    blurb: 'Driver licence renewal',
    discloses: ['A stable identifier', 'Your residential address'],
    action: 'Renew licence · $52.40',
  },
  {
    id: 'revenue', name: 'Marrindale Revenue', icon: '📄',
    blurb: 'Concession entitlement check',
    discloses: ['A stable identifier'],
    action: 'Check entitlement',
  },
  {
    id: 'health', name: 'Marrindale Health', icon: '💉',
    blurb: 'Vaccination booking',
    discloses: ['A stable identifier'],
    action: 'Book appointment',
  },
];

export type Use = { agency: AgencyId; firstUsed: string; lastUsed: string; result: string };

type Citizen = { uses: Use[] };
const citizens = new Map<string, Citizen>();

const key = (realm: string, sub: string) => `${realm}::${sub}`;

export function record(realm: string, sub: string, agency: AgencyId, result: string): Use {
  const k = key(realm, sub);
  let c = citizens.get(k);
  if (!c) { c = { uses: [] }; citizens.set(k, c); }
  const now = new Date().toISOString();
  const existing = c.uses.find((u) => u.agency === agency);
  if (existing) { existing.lastUsed = now; existing.result = result; return existing; }
  const use: Use = { agency, firstUsed: now, lastUsed: now, result };
  c.uses.push(use);
  return use;
}

export function uses(realm: string, sub: string): Use[] {
  return citizens.get(key(realm, sub))?.uses ?? [];
}

/**
 * Revoke is real: the agency's record of this citizen is dropped. It is here because a consent
 * view with a button that does nothing is worse than no button.
 */
export function revoke(realm: string, sub: string, agency: AgencyId): boolean {
  const c = citizens.get(key(realm, sub));
  if (!c) return false;
  const before = c.uses.length;
  c.uses = c.uses.filter((u) => u.agency !== agency);
  return c.uses.length !== before;
}
