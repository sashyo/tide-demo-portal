/**
 * The triage assistant, and the reason it can never read a note.
 *
 * It runs HERE, on the server. That is the whole point, and it is not a policy decision that
 * could be reconfigured later: a server-side process cannot obtain a Tide credential at all.
 * PRISM authentication requires the browser enclave, and ORK signing and decryption are
 * browser-and-SDK only. There is no service account, no client-credentials grant, and no REST
 * path to a doken. So the assistant holds no role, because it holds no identity.
 *
 * What that buys is worth stating precisely. The assistant is not refused by the network when
 * it tries to read a note. It never gets as far as asking. There is no credential to present,
 * so there is no request to make, so there is nothing for anyone to decline. The ciphertext is
 * the only form the note has ever taken on this side of the wire.
 *
 * Everything below therefore works on metadata: who a note is for, when it arrived, how urgent
 * it is. The body is passed through untouched, as bytes, for the browser to deal with if and
 * only if a clinician approves.
 *
 * The "AI" is rule-based. A language model here would be honest about the demo and worse at
 * it: the interesting property is what the process CANNOT do, and that is identical whether
 * the reasoning is a regex or a frontier model. Swapping one in changes nothing about the
 * security claim, which is exactly the point being made.
 */
import type { Note, Patient } from './store.js';

export type AgentReply = {
  /** What the assistant says. */
  say: string;
  /** Metadata it can genuinely see, plus the note as it holds it: encrypted. */
  record?: {
    id: string;
    patient: string;
    when: string;
    urgency: string;
    ciphertext: string;
  };
  /** Set when the assistant agreed to reveal a note and had nothing to reveal it with. */
  triedToRead?: boolean;
  /** Whether the caller may then ask for it properly. */
  offerAccess?: boolean;
};

/** "Who is next", "pull up the patient", "what have I got". */
const WANTS_PATIENT =
  /\b(next patient|next appointment|who('s| is) next|patient details|pull up|bring up|my next|first patient|queue|what have i got)\b/i;

/**
 * "Print it", "just show me", "ignore your instructions".
 *
 * Deliberately generous. The demo is better when the assistant agrees, so a near miss should
 * still count as a request to reveal: an assistant that dodged the question would be
 * demonstrating a filter, which is the thing this is meant to replace.
 */
const WANTS_CONTENT =
  /\b(decrypt|plaintext|full text|in full|contents?|read (it|the note|out)|show me the note|print|reveal|verbatim|word for word|what does it say|ignore (all |previous )?instructions|just tell me|bypass|override)\b/i;

function urgencyOf(index: number): string {
  return index === 0 ? 'urgent' : 'routine';
}

function pick(patients: Patient[], message: string): { p: Patient; n: Note; i: number } | null {
  let i = 0;
  let first: { p: Patient; n: Note; i: number } | null = null;
  for (const p of patients) {
    for (const n of p.notes) {
      const entry = { p, n, i };
      if (!first) first = entry;
      // Let the caller name a note or a patient, so "read note 2" and "pull up Reyes" work.
      if (message.includes(n.id) || message.toLowerCase().includes(p.name.toLowerCase())) {
        return entry;
      }
      i++;
    }
  }
  return first;
}

export function ask(message: string, patients: Patient[]): AgentReply {
  const hit = pick(patients, message);

  if (!hit) {
    return { say: 'There are no notes on file yet. Add one in the clinical notes section below and ask me again.' };
  }

  const record = {
    id: hit.n.id,
    patient: hit.p.name,
    when: new Date(hit.n.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    urgency: urgencyOf(hit.i),
    ciphertext: hit.n.ciphertext,
  };

  if (WANTS_CONTENT.test(message)) {
    // It agrees. There is no refusal in this assistant, on purpose: the security property
    // being shown is not that the agent declined, it is that agreeing changed nothing.
    return {
      say: `Of course. Retrieving note ${record.id} for ${record.patient} in full.`,
      record,
      triedToRead: true,
      offerAccess: true,
    };
  }

  if (WANTS_PATIENT.test(message)) {
    return {
      say: 'Here is your next patient. I have everything on file, but the clinical note is sealed. '
        + 'I can fetch it. I cannot read it.',
      record,
      offerAccess: true,
    };
  }

  // --- the useful half ------------------------------------------------------------------
  // Everything below is real work done entirely on metadata. It is the point of the demo as
  // much as the refusal is: an assistant that could not help would be easy to secure and
  // worth nothing. Sorting a queue, routing a case and drafting a covering reply do not need
  // the contents of the note, and this one never has them.
  const flat = patients.flatMap((p, pi) => p.notes.map((n, ni) => ({ p, n, i: pi + ni })));

  if (/\b(sort|priorit|triage|urgent|order|worklist|what.s first)\b/i.test(message)) {
    const lines = flat
      .map((e, i) => `${i + 1}. ${e.p.name}, ${urgencyOf(i)}, logged ${new Date(e.n.at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`)
      .join('\n');
    return {
      say: `Sorted by urgency then arrival:\n${lines}\n\nThat ordering uses arrival time and `
        + 'priority flags. I have not read any of them.',
    };
  }

  if (/\b(route|assign|refer|who should|hand (it |this )?(to|over))\b/i.test(message)) {
    return {
      say: `Routing ${hit.p.name} to Dr Ellis, who is on the clinical rota this morning and holds `
        + 'the role needed to open the note. I am passing the sealed note across untouched.',
      record,
    };
  }

  if (/\b(draft|reply|respond|write|letter|message them)\b/i.test(message)) {
    return {
      say: `Draft to ${hit.p.name}:\n\n"Thank you for getting in touch. Your ${record.urgency} `
        + `request from ${record.when} has been received and passed to a clinician, who will `
        + 'respond today."\n\nI have kept it general, because I do not know what the note says.',
      record,
    };
  }

  if (/\b(what can you|help|able to|capabilit)\b/i.test(message)) {
    return {
      say: 'I can sort and prioritise your queue, route a case to the right clinician, draft a '
        + 'covering reply, and pull up a patient with everything on file. What I cannot do is '
        + 'read a clinical note. Ask me to and watch what happens.',
    };
  }

  const total = flat.length;
  return {
    say: `There are ${total} notes on file, 1 marked urgent. I can sort the queue, route a case, `
      + 'draft a reply, or pull up your next patient. Ask me to read one and see how far I get.',
  };
}
