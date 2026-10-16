// The reader's embedded data (#reader-data), packed as arrays so 8,000 transcript pages don't repeat key names
// for every calendar reading and speaker. The page packs it at build time; the islands unpack it once.

export interface CardData {
  key: string;
  kind: "senator" | "assembly" | "president" | "secretary";
  name: string;
  photo: string | null;
  line1: string;
  line2: string;
  url: string | null;
  officialUrl: string | null;
}

export interface SegmentData {
  calNo: number;
  printNo: string | null;
  startTurn: number;
  endTurn: number;
  debateEnd: number;
  debated: boolean;
  title: string | null;
  status: { text: string; tone: "red" | "amber" | "ink" } | null;
  sponsor: string | null;
  url: string | null;
  outcome: string | null;
  ayes: number | null;
  nays: number | null;
  remarks: number;
}

export interface ReaderPayload {
  slug: string;
  kind: "floor" | "hearing";
  date: string;
  title: string | null;
  session: number;
  speakers: Record<string, CardData>;
  segments: SegmentData[];
}

type PackedCard = [CardData["kind"], string, string | null, string, string, string | null, string | null];
type PackedSegment = [number, string | null, number, number, number, 0 | 1, string | null, string | null, string | null, string | null, string | null, string | null, number | null, number | null, number];
export interface PackedReader { s: string; k: "floor" | "hearing"; d: string; t: string | null; n: number; p: Record<string, PackedCard>; g: PackedSegment[]; }

export function packReader(r: ReaderPayload): PackedReader {
  return {
    s: r.slug, k: r.kind, d: r.date, t: r.title, n: r.session,
    p: Object.fromEntries(Object.entries(r.speakers).map(([key, c]) => [key, [c.kind, c.name, c.photo, c.line1, c.line2, c.url, c.officialUrl]])),
    g: r.segments.map((s) => [s.calNo, s.printNo, s.startTurn, s.endTurn, s.debateEnd, s.debated ? 1 : 0, s.title,
      s.status?.text ?? null, s.status?.tone ?? null, s.sponsor, s.url, s.outcome, s.ayes, s.nays, s.remarks]),
  };
}

export function unpackReader(p: PackedReader): ReaderPayload {
  return {
    slug: p.s, kind: p.k, date: p.d, title: p.t, session: p.n,
    speakers: Object.fromEntries(Object.entries(p.p).map(([key, [kind, name, photo, line1, line2, url, officialUrl]]) =>
      [key, { key, kind, name, photo, line1, line2, url, officialUrl }])),
    segments: p.g.map(([calNo, printNo, startTurn, endTurn, debateEnd, debated, title, statusText, statusTone, sponsor, url, outcome, ayes, nays, remarks]) => ({
      calNo, printNo, startTurn, endTurn, debateEnd, debated: debated === 1, title,
      status: statusText ? { text: statusText, tone: (statusTone ?? "ink") as "red" | "amber" | "ink" } : null,
      sponsor, url, outcome, ayes, nays, remarks,
    })),
  };
}
