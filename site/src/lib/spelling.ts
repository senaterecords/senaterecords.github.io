// "Did you mean": the most used word from the transcripts within two edits of what was typed.

export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** null when the word is already known, or nothing is close enough. */
export function closestWord(word: string, counts: Record<string, number>): string | null {
  // The word lists hold words of four letters or more, so a shorter word would always look misspelled.
  if (word.length < 4 || counts[word]) return null;
  let best: string | null = null;
  let bestCount = 0;
  let bestDistance = 3;
  for (const [candidate, n] of Object.entries(counts)) {
    if (Math.abs(candidate.length - word.length) > 2) continue;
    const d = editDistance(word, candidate);
    if (d > 2) continue;
    if (d < bestDistance || (d === bestDistance && n > bestCount)) { best = candidate; bestCount = n; bestDistance = d; }
  }
  return best;
}
