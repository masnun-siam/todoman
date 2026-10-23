import { createHash } from 'node:crypto';

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/** Lowercase base32hex (RFC 4648) without padding: only a-v and 0-9, as Google event ids require. */
function base32hex(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32HEX[(acc >> bits) & 31];
    }
  }
  if (bits) out += BASE32HEX[(acc << (5 - bits)) & 31];
  return out;
}

/** Deterministic calendar event id from values the code controls, so a retry never creates a second event. */
export function eventId(repoFullName: string, dump: number, start: string): string {
  const utc = new Date(start).toISOString();
  return base32hex(createHash('sha256').update(`${repoFullName}\n${dump}\n${utc}`).digest());
}
