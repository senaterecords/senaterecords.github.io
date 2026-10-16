// The reader page embeds its speakers and calendar as JSON (#reader-data); the reader islands share one parsed copy.
import { unpackReader, type PackedReader } from "../lib/payload";
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

const LABEL = /^w-(\d+)-(\d+)-(.+)$/;

/** A speaker label's key, from its id (w-{i}-{page}-{key}); "x" means the label names no one we know. */
export function keyOfLabel(h3: Element | null): string | null {
  const key = h3?.id.match(LABEL)?.[3];
  return key && key !== "x" ? key : null;
}

/** The speaker key of a turn, from its label (turns without a label have none). */
export const keyOfTurn = (section: Element) => keyOfLabel(section.querySelector(":scope > h3.sp"));

/** A turn's index, from its id: r-{i} with a label, t-{i} without. */
export const indexOfTurn = (section: Element) => Number(section.id.slice(2));

/** The page a turn starts on: its label's id says, or data-page on turns without a label. */
export function pageOfTurn(section: HTMLElement): number | null {
  if (section.dataset.page) return Number(section.dataset.page);
  return Number(section.querySelector(":scope > h3.sp")?.id.match(LABEL)?.[2]) || null;
}

export function readerData(): ReaderData {
  if (cached) return cached;
  const payload = unpackReader(JSON.parse(document.getElementById("reader-data")?.textContent ?? "null") as PackedReader);
  // Each speaker's turns are read from the page rather than shipped twice.
  const speakers = Object.fromEntries(Object.entries(payload.speakers).map(([key, card]) => [key, { ...card, remarks: [], presiding: [] } as SpeakerInfo]));
  cached = { ...payload, speakers };
  for (const section of document.querySelectorAll<HTMLElement>("#transcript section.turn")) {
    const speaker = cached.speakers[keyOfTurn(section) ?? ""];
    if (speaker) (SPOKEN.has(section.dataset.role ?? "") ? speaker.remarks : speaker.presiding).push(indexOfTurn(section));
  }
  return cached;
}

export const turnSection = (i: number) => document.getElementById(`r-${i}`) ?? document.getElementById(`t-${i}`);

/** "Sen. Joseph P. Addabbo Jr." -> "Addabbo". */
export function surname(name: string): string {
  const words = name.replace(/^(Sen\.|Asm\.|Lt\. Gov\.)\s+/, "").split(/\s+/).filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w));
  return words[words.length - 1] ?? name;
}
