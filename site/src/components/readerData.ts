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

export function readerData(): ReaderData {
  cached ??= JSON.parse(document.getElementById("reader-data")?.textContent ?? "null") as ReaderData;
  return cached;
}

export const turnSection = (i: number) => document.querySelector<HTMLElement>(`section.turn[data-i="${i}"]`);

/** "Sen. Joseph P. Addabbo Jr." -> "Addabbo". */
export function surname(name: string): string {
  const words = name.replace(/^(Sen\.|Asm\.|Lt\. Gov\.)\s+/, "").split(/\s+/).filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w));
  return words[words.length - 1] ?? name;
}
