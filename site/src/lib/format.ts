// Display formatting shared by pages and islands: no Node or browser APIs beyond Intl.
import { RECORDS_START } from "../config";
import type { BillCard, ServicePeriod } from "./types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEGAL = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

export const longDate = (iso: string) => { const [y, m, d] = ymd(iso); return `${MONTHS[m - 1]} ${d}, ${y}`; };
export const shortDate = (iso: string) => { const [y, m, d] = ymd(iso); return `${SHORT[m - 1]} ${d}, ${y}`; };
export const legalDate = (iso: string) => { const [y, m, d] = ymd(iso); return `${LEGAL[m - 1]} ${d}, ${y}`; };
export const dayDate = (iso: string) => {
  const [y, m, d] = ymd(iso);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${SHORT[m - 1]} ${d}`;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayDate = (iso: string) => {
  const [y, m, d] = ymd(iso);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${longDate(iso)}`;
};

/** Cover-page locations come in capitals or on several lines: "Hearing Room B, Legislative Office Building, Albany, New York". */
export function placeText(location: string | null): string {
  if (!location) return "";
  return location.split(/\n+/).map((line) => line.trim()).filter(Boolean).map(hearingTitle).join(", ");
}

export const pageLabel = (page: number) => `p. ${page}`;

/** Legal page spans drop repeated leading digits but keep at least two: 5780–81, 5798–802. */
export function legalPages(start: number, end?: number | null): string {
  if (end == null || end === start) return String(start);
  const a = String(start), b = String(end);
  if (a.length !== b.length) return `${a}–${b}`;
  let i = 0;
  while (i < a.length - 2 && a[i] === b[i]) i++;
  return `${a}–${b.slice(i)}`;
}

export const plainPages = (start: number, end?: number | null) =>
  end != null && end !== start ? `pp. ${start}–${end}` : `p. ${start}`;

export function serviceText(periods: ServicePeriod[]): string {
  if (!periods.length) return "";
  if (periods.length === 1) {
    const [p] = periods;
    if (p.beforeRecords) return p.to === null ? `In the Senate since before ${RECORDS_START}` : `In the Senate from before ${RECORDS_START} to ${p.to}`;
    return p.to === null ? `In the Senate since ${p.from}` : `In the Senate ${p.from}–${p.to}`;
  }
  const spans = periods.map((p, i) => `${i === 0 && p.beforeRecords ? `before ${RECORDS_START}` : p.from}–${p.to ?? "present"}`);
  return `In the Senate ${spans.join(", ")}`;
}

const PARTICLE = /^(Mc|Mac|De|Di|Da|Du|La|Le)([A-Z].*)$/;

/** After an apostrophe only a one-letter prefix keeps the next letter capital: O'Mara, but State's. */
function capital(word: string): string {
  const parts = word.split(/(['’-])/);
  return parts.map((part, i) => {
    if (/^['’-]$/.test(part)) return part;
    const lower = part.toLowerCase();
    const possessive = i >= 2 && /['’]/.test(parts[i - 1]) && parts[i - 2].length > 1;
    return possessive ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join("");
}

const HONORIFICS = new Set(["MR", "MRS", "MS", "DR", "JR", "SR", "ST"]);

/** An all-capital word with no vowels is an acronym (DTF, NYC), unless it is an honorific (Mr., Dr.). */
function isAcronym(word: string): boolean {
  const letters = word.replace(/[^A-Za-z]/g, "");
  const vowels = letters.length <= 3 ? /[AEIOU]/ : /[AEIOUY]/; // Y is a vowel in names (Lynch), not in NYC
  return letters.length >= 2 && letters === letters.toUpperCase() && !vowels.test(letters) && !HONORIFICS.has(letters);
}

/** "ACTING PRESIDENT BRENNAN" -> "Acting President Brennan"; keeps "DeFRANCISCO" as "DeFrancisco" and "DTF" as "DTF". */
export function titleCase(label: string): string {
  return label.split(/\s+/).filter(Boolean).map((word) => {
    if (isAcronym(word)) return word;
    const particle = word.match(PARTICLE);
    return particle ? particle[1] + capital(particle[2]) : capital(word);
  }).join(" ");
}

const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

/** Hearing titles and committee names arrive in capitals, or mostly capitals; others are left as written. */
export function hearingTitle(title: string): string {
  const letters = title.replace(/[^A-Za-z]/g, "");
  const capitals = letters.replace(/[^A-Z]/g, "").length;
  if (!letters.length || capitals / letters.length < 0.6) return title;
  return titleCase(title).split(" ").map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(" ");
}

/** Committee names as written in prose: "Ways and Means", whatever case the API sends. */
export function committeeName(name: string): string {
  return hearingTitle(name).split(" ").map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(" ");
}

/** How a transcript is named in lists: the session type for floor days, the readable title for hearings. */
export function transcriptTitle(t: { kind: "floor" | "hearing"; sessionType: string | null; title: string | null; dayType?: string | null }): string {
  if (t.kind === "floor") return t.dayType === "LEGISLATIVE" ? "Legislative day" : t.sessionType || "Floor session";
  if (!t.title) return "Public hearing";
  const title = hearingTitle(t.title);
  return /\b(hearing|forum|roundtable|meeting|summit)\b/i.test(title) ? title : `Public hearing: ${title}`;
}

export const plural = (n: number, noun: string) => `${count(n)} ${noun}${n === 1 ? "" : "s"}`;

const PREFIX = /^(SENATOR|ACTING PRESIDENT|ASSEMBLYMAN|ASSEMBLYWOMAN|ASSEMBLYMEMBER|ASSEMBLY MEMBER|CHAIRMAN|CHAIRWOMAN|CHAIRPERSON|CHAIR)\s+/i;

export type SpeakerKind = "senator" | "assembly" | "secretary" | "president" | "other";

/** Short form for legal citations ("Sen. Ortega"), full form for plain ones ("Sen. Marisol Ortega"). */
export function speakerForms(kind: SpeakerKind, label: string | null, fullName?: string | null): { short: string; full: string } {
  if (kind === "secretary") return { short: "the Secretary", full: "the Secretary" };
  if (kind === "president") return { short: "the President", full: fullName ? `Lt. Gov. ${fullName}` : "the President" };
  const surname = titleCase((label ?? "").replace(PREFIX, ""));
  if (kind === "senator") return { short: `Sen. ${surname}`, full: `Sen. ${fullName ?? surname}` };
  if (kind === "assembly") return { short: `Asm. ${surname}`, full: `Asm. ${fullName ?? surname}` };
  const named = titleCase(label ?? "");
  return { short: named, full: named };
}

export interface CiteInput {
  kind: "floor" | "hearing";
  date: string;
  title: string | null;
  start: number | null;
  end?: number | null;
  speaker: { short: string; full: string };
}

// A hearing is cited by its own title wherever the citation is made; lists may call it "Public hearing: …".
const citedTitle = (title: string | null) => (title ?? "").replace(/^Public hearing: /, "") || "Public hearing";

export function legalCite(c: CiteInput): string {
  const at = c.start == null ? "" : `, at ${legalPages(c.start, c.end)}`;
  const who = ` (remarks of ${c.speaker.short})`;
  return c.kind === "floor"
    ? `N.Y. Senate Tr., ${legalDate(c.date)}${at}${who}`
    : `N.Y. Senate Pub. Hr'g Tr., ${citedTitle(c.title)}, ${legalDate(c.date)}${at}${who}`;
}

export function plainCite(c: CiteInput): string {
  const p = c.start == null ? "" : `, ${plainPages(c.start, c.end)}`;
  return c.kind === "floor"
    ? `NY Senate floor transcript, ${longDate(c.date)}${p} (${c.speaker.full})`
    : `NY Senate public hearing, ${citedTitle(c.title)}, ${longDate(c.date)}${p} (${c.speaker.full})`;
}

export function outcomeText(s: { debated: boolean; outcome: string | null; ayes: number | null; nays: number | null }): string {
  const votes = s.ayes != null ? `, ${s.ayes}–${s.nays ?? 0}` : "";
  switch (s.outcome) {
    case "passed": return s.debated ? `Debated and passed${votes}` : `Passed${votes}`;
    case "lost": return s.debated ? `Debated and lost${votes}` : `Lost${votes}`;
    case "adopted": return "Adopted";
    case "laid_aside": return s.debated ? "Debated, then laid aside. No vote." : "Brought up, then laid aside. No vote.";
    default: return s.debated ? "Debated. No vote recorded." : "Read on the floor. No vote recorded.";
  }
}

export function billStatus(card: Pick<BillCard, "vetoed" | "signed" | "status"> | null): { text: string; tone: "red" | "amber" | "ink" } | null {
  if (!card) return null;
  if (card.vetoed) return { text: "Vetoed", tone: "red" };
  if (card.signed) return { text: "Signed by Governor", tone: "ink" };
  const text = card.status?.text || "Introduced";
  return { text, tone: /amend/i.test(text) ? "amber" : "ink" };
}

const MILESTONE: Record<string, string> = {
  INTRODUCED: "Introduced",
  IN_SENATE_COMM: "In Senate committee",
  SENATE_FLOOR: "On the Senate floor",
  PASSED_SENATE: "Passed Senate",
  IN_ASSEMBLY_COMM: "In Assembly committee",
  ASSEMBLY_FLOOR: "On the Assembly floor",
  PASSED_ASSEMBLY: "Passed Assembly",
  DELIVERED_TO_GOV: "Delivered to Governor",
  SIGNED_BY_GOV: "Signed by Governor",
  VETOED: "Vetoed",
};

/** A bill's milestones so far, then the steps still ahead on its chamber's path (none after the Governor acts). */
export function timelineSteps(card: Pick<BillCard, "basePrintNo" | "milestones">): { label: string; date: string | null; done: boolean }[] {
  const done = card.milestones.map((m) => ({ label: (m.type && MILESTONE[m.type]) || m.text || "Step", date: m.date, done: true }));
  const types = new Set(card.milestones.map((m) => m.type));
  if (types.has("SIGNED_BY_GOV") || types.has("VETOED")) return done;
  const path = card.basePrintNo.startsWith("A")
    ? ["PASSED_ASSEMBLY", "PASSED_SENATE", "DELIVERED_TO_GOV", "GOVERNOR"]
    : ["PASSED_SENATE", "PASSED_ASSEMBLY", "DELIVERED_TO_GOV", "GOVERNOR"];
  const reached = path.reduce((at, type, i) => (types.has(type) ? i : at), -1);
  const ahead = path.slice(reached + 1).map((type) => ({ label: MILESTONE[type] ?? "Governor", date: null, done: false }));
  return [...done, ...ahead];
}

/** The pipeline writes New York wall-clock times without a zone; compare against New York's clock. */
export const nyClock = (date: Date) => new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));

export function relativeTime(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const count = (n: number) => n.toLocaleString("en-US");
