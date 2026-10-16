// Build-time access to data/site (Node only). Small files are cached; transcripts are read fresh each time.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BILL_DATA_START } from "../config";
import type {
  AssemblyMember, BillEntry, Meta, SenatorIndexEntry, SenatorPage, Transcript, TranscriptSummary,
} from "./types";

export const DATA_DIR = resolve(process.env.OTR_DATA ?? join(process.cwd(), "..", "data", "site"));

const cache = new Map<string, unknown>();

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, rel), "utf-8")) as T;
}

function cached<T>(key: string, load: () => T): T {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key) as T;
}

export const meta = () => cached("meta", () => readJson<Meta>("meta.json"));
export const transcriptIndex = () => cached("index", () => readJson<TranscriptSummary[]>("transcripts.json"));
export const transcript = (slug: string) => readJson<Transcript>(`transcripts/${slug}.json`);
export const senators = () => cached("senators", () => readJson<SenatorIndexEntry[]>("senators.json"));
export const senatorPage = (slug: string) => readJson<SenatorPage>(`senators/${slug}.json`);
export const assembly = () => cached("assembly", () => readJson<Record<string, AssemblyMember>>("assembly.json"));

export const senatorsBySlug = () => cached("bySlug", () => new Map(senators().map((s) => [s.slug, s])));
export const senatorsByMemberId = () => cached("byId", () => new Map(senators().map((s) => [s.memberId, s])));
export const senatorPageSlugs = () =>
  cached("pageSlugs", () => new Set(readdirSync(join(DATA_DIR, "senators")).map((f) => f.replace(/\.json$/, ""))));

export const billSessions = () =>
  cached("sessions", () => readdirSync(join(DATA_DIR, "bills")).map((f) => Number(f.replace(/\.json$/, ""))).sort((a, b) => a - b));

export const billsFor = (session: number) =>
  cached(`bills-${session}`, () => readJson<{ session: number; bills: BillEntry[] }>(`bills/${session}.json`).bills);

export function bill(session: number, base: string): BillEntry | undefined {
  const map = cached(`billmap-${session}`, () => new Map(billsFor(session).map((b) => [b.basePrintNo, b])));
  return map.get(base);
}

const getsPage = (b: BillEntry) => b.session >= BILL_DATA_START || b.segments.length > 0;

/** Whether /bills/{session}/{base}/ exists: the same rule as billPages(). */
export function hasBillPage(session: number, base: string): boolean {
  const entry = bill(session, base);
  return !!entry && getsPage({ ...entry, session });
}

/** Every bill from 2009 on gets a page; earlier bills only when read on the floor (they have debates, no details). */
export function billPages(): { session: number; base: string; printNo: string }[] {
  return billSessions().flatMap((session) =>
    billsFor(session)
      .filter((b) => getsPage({ ...b, session }))
      .map((b) => ({ session, base: b.basePrintNo, printNo: b.card?.printNo ?? b.basePrintNo })),
  );
}

/** The latest session with bill details: the default for the bills list and "Most debated". */
export const currentSession = () => Math.max(...billSessions().filter((s) => s >= BILL_DATA_START));

export function years(): { year: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const t of transcriptIndex()) counts.set(Number(t.date.slice(0, 4)), (counts.get(Number(t.date.slice(0, 4))) ?? 0) + 1);
  return [...counts].map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
}

/** Where "Transcripts" and "Bills" lead: straight to the latest year and the current session, not through a redirect. */
export const transcriptsHome = () => `/browse/${years()[0]?.year ?? ""}/`.replace("//", "/");
export const billsHome = () => `/bills/${currentSession()}/`;

export function words(prefix: string): Record<string, number> {
  const rel = `words/${prefix}.json`;
  return existsSync(join(DATA_DIR, rel)) ? cached(rel, () => readJson<Record<string, number>>(rel)) : {};
}
