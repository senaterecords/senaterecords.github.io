// The transcripts several Pagefind searches found (an OR, or a speaker searched by printed name), in one order. Each
// search ranks only its own results, so one after the other would list every transcript of the first before any of
// the second; instead they are interleaved by Pagefind's score, or by each transcript's date.

export type Sort = "relevance" | "newest" | "oldest";

/** One list of results: a transcript found by several searches counts once, at its best score. Dates (by result id)
 * order a date sort; without them, each search's own order is kept, one after the other. */
export function inOrder<T extends { id: string; score?: number }>(lists: T[][], sort: Sort, dates: Record<string, string> | null): T[] {
  const best = new Map<string, { result: T; score: number; at: number }>();
  for (const list of lists) {
    for (const result of list) {
      const had = best.get(result.id);
      const score = result.score ?? 0;
      if (!had) best.set(result.id, { result, score, at: best.size });
      else if (score > had.score) had.score = score;
    }
  }
  const all = [...best.values()];
  if (lists.length > 1) {
    if (sort === "relevance") all.sort((a, b) => b.score - a.score || a.at - b.at);
    else if (dates) {
      const sign = sort === "newest" ? -1 : 1;
      // A transcript without a known date goes after the dated ones, in the order it was found.
      all.sort((a, b) => {
        const x = dates[a.result.id];
        const y = dates[b.result.id];
        if (!x || !y) return (x ? -1 : 0) + (y ? 1 : 0) || a.at - b.at;
        return x === y ? a.at - b.at : (x < y ? -sign : sign);
      });
    }
  }
  return all.map((x) => x.result);
}
