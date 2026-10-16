// A bill's appearances on the floor, for its page (spec 8.2): the longest debate leads, the rest are listed as
// earlier or later than it, newest first.
import type { BillSegment } from "./types";

const newestFirst = (a: BillSegment, b: BillSegment) => b.date.localeCompare(a.date) || b.startTurn - a.startTurn;

export function floorAppearances(segments: BillSegment[]): { main: BillSegment | null; earlier: BillSegment[]; later: BillSegment[] } {
  const debated = segments.filter((s) => s.debated);
  const main = debated.length ? [...debated].sort((a, b) => b.remarks - a.remarks || newestFirst(a, b))[0] : null;
  const others = segments.filter((s) => s !== main).sort(newestFirst);
  if (!main) return { main, earlier: others, later: [] };
  const after = (s: BillSegment) => newestFirst(main, s) > 0;
  return { main, earlier: others.filter((s) => !after(s)), later: others.filter(after) };
}
