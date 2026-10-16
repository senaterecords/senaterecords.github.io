// Find in a transcript: matching that ignores capitals and accents while keeping every character where it was, so a
// match's place in the folded text is its place on the page.

/** The text with capitals and accents folded away, one character for each character. */
export function foldForFind(text: string): string {
  const out = new Array<string>(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out[i] = ch.charCodeAt(0) < 128 ? ch.toLowerCase() : ((ch.normalize("NFD")[0] ?? ch).toLowerCase()[0] ?? ch);
  }
  return out.join("");
}

/** Where a (folded) phrase occurs in (folded) text, one after another, at most `limit` places. */
export function findAll(text: string, phrase: string, limit: number): number[] {
  const found: number[] = [];
  if (!phrase) return found;
  for (let at = text.indexOf(phrase); at !== -1 && found.length < limit; at = text.indexOf(phrase, at + phrase.length)) found.push(at);
  return found;
}

/** Which piece of text a position falls in, and where in it: `starts` holds each piece's first position, in order. */
export function locate(starts: number[], position: number): { piece: number; offset: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= position) lo = mid;
    else hi = mid - 1;
  }
  return { piece: lo, offset: position - starts[lo] };
}
