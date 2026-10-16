// What the search results and a senator's page export: the same content as a Word document or a spreadsheet.
import { csv } from "./csv";
import type { Block } from "./docx";
import { longDate, plural } from "./format";

/** One search result, as exported. */
export interface ResultItem {
  date: string; record: string; transcript: string; speaker: string; page: number | null;
  excerpt: string; text: string; cite: string; link: string;
}

export function resultsBlocks(query: string, summary: string, items: ResultItem[]): Block[] {
  const blocks: Block[] = [{ kind: "title", text: `Search: ${query}` }, { kind: "meta", text: summary }];
  for (const r of items) {
    blocks.push(
      { kind: "heading", text: `${longDate(r.date)} · ${r.speaker}${r.page != null ? ` · p. ${r.page}` : ""}` },
      { kind: "meta", text: r.transcript },
      { kind: "para", text: r.text },
      { kind: "meta", runs: [{ text: `${r.cite} · ` }, { text: "Read in context", link: r.link }] },
    );
  }
  return blocks;
}

export const resultsCsv = (items: ResultItem[]) => csv([
  ["Date", "Record", "Transcript", "Speaker", "Page", "Excerpt", "Full remark", "Citation", "Link"],
  ...items.map((r) => [r.date, r.record, r.transcript, r.speaker, r.page, r.excerpt, r.text, r.cite, r.link]),
]);

/** A senator's page data, as the page embeds it for export. */
export interface SenatorExport {
  name: string; service: string; slug: string;
  recent: { date: string; page: number | null; text: string; href: string }[];
  appearances: { date: string; title: string | null; kind: string; remarks: number; presiding: number; href: string }[];
}

const recordOf = (kind: string) => (kind === "floor" ? "Floor session" : "Public hearing");
const times = (n: number) => (n === 1 ? "once" : `${n} times`);

export function senatorBlocks(d: SenatorExport, source: string, abs: (href: string) => string): Block[] {
  const blocks: Block[] = [
    { kind: "title", text: d.name },
    { kind: "meta", text: d.service },
    { kind: "meta", runs: [{ text: "Source: " }, { text: source, link: source }] },
    { kind: "heading", text: "Recent remarks" },
  ];
  for (const r of d.recent) {
    blocks.push({ kind: "para", runs: [
      { text: `${longDate(r.date)}${r.page != null ? `, p. ${r.page}` : ""}: `, bold: true },
      { text: `“${r.text}” ` },
      { text: "Read in context", link: abs(r.href) },
    ] });
  }
  blocks.push({ kind: "heading", text: "Transcripts" });
  for (const a of d.appearances) {
    blocks.push({ kind: "para", runs: [
      { text: `${longDate(a.date)}, ${a.title ?? recordOf(a.kind)}: `, bold: true },
      { text: `${plural(a.remarks, "remark")}${a.presiding ? `, presiding ${times(a.presiding)}` : ""} ` },
      { text: "Open", link: abs(a.href) },
    ] });
  }
  return blocks;
}

export const senatorCsv = (d: SenatorExport, abs: (href: string) => string) => csv([
  ["Date", "Record", "Transcript", "Remarks", "Presiding", "Link"],
  ...d.appearances.map((a) => [a.date, recordOf(a.kind), a.title ?? recordOf(a.kind), a.remarks, a.presiding, abs(a.href)]),
]);
