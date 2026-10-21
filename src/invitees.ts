export interface Person {
  name: string;
  aliases: string[];
  email: string;
}

export const MAX_INVITEES = 10;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive: the match may not touch a letter, digit or underscore. */
function appearsIn(term: string, text: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(term)}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

const isPerson = (p: Person, name: string): boolean => [p.name, ...p.aliases].some((t) => t.toLowerCase() === name.toLowerCase());

/**
 * FR-4a: code, not Claude, picks who is invited. `attendees` are the names Claude returned,
 * `text` is the dump plus Siam's comments. Skipped entries are ready to show as comment lines.
 */
export function resolveInvitees(attendees: string[], people: Person[], text: string): { invited: Person[]; skipped: string[] } {
  const invited: Person[] = [];
  const skipped: string[] = [];
  for (const raw of attendees) {
    const name = raw.trim();
    const person = name.includes('@') ? undefined : people.find((p) => isPerson(p, name)); // an email is never an invitee
    if (!person) skipped.push(`${name} — not in people.yml, invite manually`);
    else if (!appearsIn(person.name, text) && !person.aliases.some((a) => appearsIn(a, text))) skipped.push(`${name} — not named in the dump, skipped`);
    else if (invited.includes(person)) continue;
    else if (invited.length >= MAX_INVITEES) skipped.push(`${name} — over the limit of ${MAX_INVITEES} invitees, invite manually`);
    else invited.push(person);
  }
  return { invited, skipped };
}
