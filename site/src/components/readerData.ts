// The reader page embeds its speakers and calendar as JSON (#reader-data); the reader islands share one parsed copy.
import type { SpeakerInfo } from "../lib/speakers";

declare global {
  interface Window {
    /** Name clicks and J/K presses made before the islands started, queued by an inline script on the reader page. */
    __otrEarly?: { clicks: HTMLElement[]; keys: string[] };
    __otrCards?: boolean;
    __otrNav?: boolean;
  }
}

export interface ReaderSegment {
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

export interface ReaderData {
  slug: string;
  kind: "floor" | "hearing";
  date: string;
  title: string | null;
  session: number;
  speakers: Record<string, SpeakerInfo>;
  segments: ReaderSegment[];
}

let cached: ReaderData | null = null;

const SPOKEN = new Set(["senator", "chair", "assembly"]);

/** The speaker key of a turn, from its label (turns without a label have none). */
export const keyOfTurn = (section: Element) => section.querySelector<HTMLElement>(":scope > h3[data-key]")?.dataset.key ?? null;

/** The page a turn starts on: its remark anchor (w-{i}-{page}-{key}) says, or data-page on turns without a label. */
export function pageOfTurn(section: HTMLElement): number | null {
  if (section.dataset.page) return Number(section.dataset.page);
  const page = Number(section.querySelector("h3 > span[id^='w-']")?.id.split("-")[2]);
  return page || null;
}

export function readerData(): ReaderData {
  if (cached) return cached;
  cached = JSON.parse(document.getElementById("reader-data")?.textContent ?? "null") as ReaderData;
  // Each speaker's turns are read from the page rather than shipped twice.
  for (const s of Object.values(cached.speakers)) { s.remarks = []; s.presiding = []; }
  for (const section of document.querySelectorAll<HTMLElement>("#transcript section.turn")) {
    const speaker = cached.speakers[keyOfTurn(section) ?? ""];
    if (speaker) (SPOKEN.has(section.dataset.role ?? "") ? speaker.remarks : speaker.presiding).push(Number(section.dataset.i));
  }
  return cached;
}

export const turnSection = (i: number) => document.querySelector<HTMLElement>(`section.turn[data-i="${i}"]`);

/** "Sen. Joseph P. Addabbo Jr." -> "Addabbo". */
export function surname(name: string): string {
  const words = name.replace(/^(Sen\.|Asm\.|Lt\. Gov\.)\s+/, "").split(/\s+/).filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w));
  return words[words.length - 1] ?? name;
}
