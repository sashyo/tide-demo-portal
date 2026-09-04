export type Note = { id: string; ciphertext: string; by: string; at: string };
export type Patient = {
  id: string; name: string; age: number; appt: string;
  mobile: string; address: string; balance: string;
  notes: Note[];
};

type Practice = { patients: Patient[]; seq: number };
const practices = new Map<string, Practice>();

/**
 * Notes start EMPTY, deliberately.
 *
 * Seeding ciphertext is impossible honestly: only a doctor's browser can produce it, via the
 * ORKs. Faking it with server-side encryption would make the app's central claim — that the
 * server never holds plaintext — false. So the demo begins with a doctor writing one.
 */
export function practice(realm: string): Practice {
  let p = practices.get(realm);
  if (!p) {
    p = {
      seq: 1,
      patients: [
        { id: 'pt1', name: 'Margaret Cole', age: 61, appt: '10:40 · Dr Ellis',
          mobile: '0412 338 907', address: '14 Rosslyn St, Carlton', balance: '$45.00 outstanding', notes: [] },
        { id: 'pt2', name: 'Aaron Whitlock', age: 34, appt: '11:05 · Dr Ellis',
          mobile: '0455 210 664', address: '2/9 Herbert Ave, Brunswick', balance: 'Nil', notes: [] },
        { id: 'pt3', name: 'Fatima Nasser', age: 47, appt: '11:30 · Nurse Kaur',
          mobile: '0431 887 002', address: '88 Wren St, Northcote', balance: '$18.50 outstanding', notes: [] },
      ],
    };
    practices.set(realm, p);
  }
  return p;
}

export function addNote(realm: string, patientId: string, ciphertext: string, by: string): Note | null {
  const pr = practice(realm);
  const pt = pr.patients.find((x) => x.id === patientId);
  if (!pt) return null;
  const note: Note = { id: `n${pr.seq++}`, ciphertext, by, at: new Date().toISOString() };
  pt.notes.push(note);
  return note;
}
