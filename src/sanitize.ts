const ZWSP = '​';

/** Strip HTML comment delimiters and neutralise @mentions in untrusted text. */
export function sanitize(text: string): string {
  let out = text;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replaceAll('<!--', '').replaceAll('-->', ''); // loop: removal can splice a new delimiter together
  }
  return out.replace(/@(?=[A-Za-z0-9_])/g, `@${ZWSP}`); // zero-width space: no notification
}
