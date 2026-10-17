// The data contract the pipeline writes to data/site/ (spec section 7). Shared by pages and islands.
export type Role = "record" | "secretary" | "president" | "presiding" | "senator" | "assembly" | "chair" | "guest";

export interface Turn {
  i: number;
  label: string | null;
  role: Role;
  senator: string | null;
  assembly?: string;
  text: string;
  page: number | null;
  breaks: [number, number][]; // [character offset in text, page that starts there]
  bills: string[];
}

export interface ExcerptTurn { label: string; senator: string | null; text: string; }

export interface Segment {
  calNo: number;
  printNo: string | null; // null: a special-session reading the API has no bill for
  sponsor: string | null;
  startTurn: number;
  endTurn: number;
  debateEnd: number;
  debated: boolean;
  outcome: "passed" | "lost" | "adopted" | "laid_aside" | null;
  ayes: number | null;
  nays: number | null;
  remarks: number;
  speakers: Record<string, number>;
  pages: [number, number] | null;
  excerpt: ExcerptTurn[];
  reading?: string; // the reading's words, which a link to it washes yellow
}

export interface Officer { name: string; title: string; from?: number; until?: number | null; }

export interface Transcript {
  kind: "floor" | "hearing";
  slug: string;
  date: string;
  session: number;
  sessionType: string | null;
  dayType: string | null;
  title: string | null;
  location: string | null;
  committees: string[];
  pages: [number, number] | null;
  coverage: number;
  plainText: boolean;
  empty: boolean;
  corrected: string | null;
  turns: Turn[];
  segments: Segment[];
  unresolvedBillMentions: number;
  officers: { president: Officer | null; secretary: Officer | null };
}

export interface TranscriptSummary {
  slug: string;
  kind: "floor" | "hearing";
  date: string;
  title: string | null;
  sessionType: string | null;
  dayType: string | null;
  pages: [number, number] | null;
  committees: string[];
  speakers: number;
  billsDebated: number;
  plainText: boolean;
  corrected: string | null;
}

export interface ServicePeriod { from: number; to: number | null; beforeRecords?: boolean; }

export interface SenatorIndexEntry {
  slug: string;
  memberId: number;
  name: string;
  photo: string | null;
  officialUrl: string | null;
  service: ServicePeriod[];
  sessions: Record<string, number | null>;
  remarks: number;
  presiding: number;
  transcripts: number;
}

export interface Appearance {
  transcript: string; date: string; kind: "floor" | "hearing"; title: string | null;
  remarks: number; presiding: number; firstTurn: number; firstPage: number | null;
}

export interface RecentRemark {
  transcript: string; date: string; kind: "floor" | "hearing"; title: string | null;
  turn: number; page: number | null; text: string; bills: string[];
}

export interface SenatorBillRow { session: number; basePrintNo: string; printNo: string; remarks: number; sponsor: boolean; }

export interface SenatorPage {
  slug: string; memberId: number; name: string; photo: string | null; officialUrl: string | null;
  service: ServicePeriod[]; sessions: Record<string, number | null>;
  totals: { remarks: number; presiding: number; transcripts: number };
  appearances: Appearance[]; bills: SenatorBillRow[]; recent: RecentRemark[];
}

export interface AssemblyMember {
  memberId: number; name: string; sessions: Record<string, number | null>; photo: string | null; officialUrl: string | null;
}

export interface FloorVote { date: string; version: string; counts: Record<string, number>; members: Record<string, number[]>; }

export interface BillCard {
  printNo: string; basePrintNo: string; session: number; title: string | null;
  sponsor: { memberId: number | null; name: string | null; shortName: string | null } | null;
  status: { type: string | null; text: string | null; date: string | null };
  milestones: { type: string | null; text: string | null; date: string | null }[];
  signed: boolean; vetoed: boolean; floorVotes: FloorVote[]; sameAs: string[];
  committee: string | null; coSponsors: number;
}

/** The first time a transcript names a bill: the page, the remark and the sentence it is named in. */
export interface Mention {
  transcript: string; kind: "floor" | "hearing"; date: string; title: string | null; page: number | null;
  turn?: number | null; said?: string | null;
}

export interface BillSegment extends Segment { transcript: string; date: string; }

export interface BillEntry {
  basePrintNo: string; session: number; card: BillCard | null; segments: BillSegment[]; mentionedIn: Mention[];
}

export interface Meta {
  updatedAt: string;
  counts: { floorTranscripts: number; hearings: number; senators: number; bills: number };
}
