// The search query layer (spec 9.1): parse what the reader typed, plan the Pagefind searches, and keep only the
// remarks that really match. Pagefind finds pages; this decides which remarks on those pages count.
import { fold } from "./names";

export interface Branch { words: string[]; phrases: string[]; near: [string, string][]; }
export interface Filters { speaker?: string; bill?: string; years?: number[]; type?: "floor" | "hearing"; committee?: string; }
export interface ParsedQuery { branches: Branch[]; not: string[]; filters: Filters; }

const FIELDS = new Set(["speaker", "bill", "year", "type", "committee"]);
const NEAR_WORDS = 10;

type Token = { kind: "word" | "phrase" | "op"; value: string; field?: string; negated?: boolean };

function tokenize(q: string): Token[] {
  const tokens: Token[] = [];
  const re = /(-?)(?:([A-Za-z]+):(?:"([^"]*)"?|(\S+))|"([^"]*)"?|(\S+))/g;
  for (const m of q.matchAll(re)) {
    const [, minus, field, fieldQuoted, fieldBare, phrase, bare] = m;
    if (field && FIELDS.has(field.toLowerCase())) {
      tokens.push({ kind: "word", field: field.toLowerCase(), value: (fieldQuoted ?? fieldBare ?? "").trim() });
    } else if (phrase !== undefined) {
      if (phrase.trim()) tokens.push({ kind: "phrase", value: phrase.trim().replace(/\s+/g, " "), negated: !!minus });
    } else {
      const text = field ? `${field}:${fieldQuoted ?? fieldBare ?? ""}` : bare!;
      if (!minus && /^(AND|OR|NOT|NEAR)$/.test(text)) tokens.push({ kind: "op", value: text });
      else if (text) tokens.push({ kind: "word", value: text, negated: !!minus });
    }
  }
  return tokens;
}

function applyFilter(filters: Filters, field: string, value: string) {
  if (!value) return;
  if (field === "speaker") filters.speaker = value;
  else if (field === "committee") filters.committee = value;
  else if (field === "type") {
    const t = value.toLowerCase();
    if (t === "floor" || t === "hearing") filters.type = t;
  } else if (field === "bill") {
    const m = value.toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^([SA])(\d+)/);
    if (m) filters.bill = `${m[1]}${m[2]}`;
  } else if (field === "year") {
    const m = value.match(/^(\d{4})(?:-(\d{4}))?$/);
    if (m) {
      const from = Number(m[1]);
      const to = Number(m[2] ?? m[1]);
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      filters.years = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    }
  }
}

export function parseQuery(q: string): ParsedQuery {
  const filters: Filters = {};
  const not: string[] = [];
  const branches: Branch[] = [{ words: [], phrases: [], near: [] }];
  const tokens = tokenize(q);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const branch = branches[branches.length - 1];
    if (t.field) { applyFilter(filters, t.field, t.value); continue; }
    if (t.kind === "op") {
      if (t.value === "OR") branches.push({ words: [], phrases: [], near: [] });
      else if (t.value === "NOT") {
        const next = tokens[i + 1];
        if (next && next.kind !== "op" && !next.field) { not.push(next.value); i++; }
      } else if (t.value === "NEAR") {
        const next = tokens[i + 1];
        const previous = branch.words.pop();
        if (previous && next?.kind === "word" && !next.field && !next.negated) { branch.near.push([previous, next.value]); i++; }
        else if (previous) branch.words.push(previous);
      }
      continue;
    }
    if (t.negated) { not.push(t.value); continue; }
    if (t.kind === "phrase") branch.phrases.push(t.value);
    else branch.words.push(t.value);
  }
  // "a OR" with nothing after it leaves an empty branch; keep it only when it is the only one.
  const kept = branches.filter((b) => b.words.length || b.phrases.length || b.near.length);
  return { branches: kept.length ? kept : [{ words: [], phrases: [], near: [] }], not, filters };
}

export const pagefindTerm = (b: Branch) =>
  [...b.words, ...b.phrases.map((p) => `"${p}"`), ...b.near.flat()].join(" ");

/** Pagefind filters for a query. A range of years needs "any"; a plain list would require every year at once. */
export function pagefindFilters(f: Filters, speakerSlug: string | null): Record<string, string | string[] | { any: string[] }> {
  const out: Record<string, string | string[] | { any: string[] }> = {};
  if (f.years?.length) out.year = f.years.length === 1 ? [String(f.years[0])] : { any: f.years.map(String) };
  if (f.type) out.type = f.type;
  if (f.bill) out.bill = f.bill;
  if (f.committee) out.committee = f.committee;
  if (speakerSlug) out.senator = speakerSlug;
  return out;
}

export interface Remark { url: string; turn: number; page: number | null; speaker: string | null; label: string; text: string; }

interface PageData { url: string; content: string; anchors: { element: string; id: string; text: string; location: number }[]; }

export function remarksOf(data: PageData): Remark[] {
  const words = data.content.split(/\s+/).filter(Boolean);
  const starts = data.anchors.filter((a) => /^r-\d+$/.test(a.id)).sort((a, b) => a.location - b.location);
  const who = new Map<number, { page: number | null; speaker: string | null; label: string }>();
  for (const a of data.anchors) {
    const m = a.id.match(/^w-(\d+)-(\d+)-(.+)$/);
    if (m) who.set(Number(m[1]), { page: Number(m[2]) || null, speaker: m[3] === "x" ? null : m[3], label: a.text });
  }
  return starts.map((a, idx) => {
    const turn = Number(a.id.slice(2));
    const end = starts[idx + 1]?.location ?? words.length;
    return {
      url: `${data.url}#r-${turn}`,
      turn,
      page: who.get(turn)?.page ?? null,
      speaker: who.get(turn)?.speaker ?? null,
      label: who.get(turn)?.label ?? a.text,
      text: words.slice(a.location, end).join(" "),
    };
  });
}

const foldedWords = (text: string) => fold(text).split(" ").filter(Boolean);

function positions(words: string[], term: string): number[] {
  const t = fold(term).replace(/ /g, "");
  return t ? words.flatMap((w, i) => (w.startsWith(t) ? [i] : [])) : [];
}

function hasPhrase(words: string[], phrase: string): boolean {
  const p = fold(phrase);
  return !!p && ` ${words.join(" ")} `.includes(` ${p} `);
}

function present(words: string[], term: string): boolean {
  return fold(term).includes(" ") ? hasPhrase(words, term) : positions(words, term).length > 0;
}

export function keepRemark(r: Remark, b: Branch, not: string[], speakerSlug: string | null): boolean {
  if (speakerSlug && r.speaker !== speakerSlug) return false;
  const words = foldedWords(r.text);
  if (!b.words.every((w) => present(words, w))) return false;
  if (!b.phrases.every((p) => hasPhrase(words, p))) return false;
  for (const [a, c] of b.near) {
    const pa = positions(words, a);
    const pc = positions(words, c);
    if (!pa.some((i) => pc.some((j) => i !== j && Math.abs(i - j) <= NEAR_WORDS))) return false;
  }
  return !not.some((n) => present(words, n));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const L = "\\p{L}\\p{N}";
const EXCERPT = 360;

/** The remark as safe HTML with hits in <mark>, trimmed around the first hit when it is long. */
export function excerpt(r: Remark, b: Branch): string {
  const text = r.text;
  const patterns = [
    ...b.phrases.map((p) => p.split(/\s+/).map(escapeRegex).join(`[^${L}]+`) + `(?![${L}])`),
    ...[...b.words, ...b.near.flat()].map((w) => `${escapeRegex(w)}[${L}]*`),
  ];
  const ranges: [number, number][] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(new RegExp(`(?<![${L}])${p}`, "giu"))) ranges.push([m.index!, m.index! + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  let from = 0;
  let to = text.length;
  if (text.length > EXCERPT) {
    const first = merged[0]?.[0] ?? 0;
    from = Math.max(0, first - 120);
    if (from > 0) from = text.indexOf(" ", from) + 1 || from;
    to = Math.min(text.length, from + EXCERPT);
    if (to < text.length) to = text.lastIndexOf(" ", to) > from ? text.lastIndexOf(" ", to) : to;
  }
  let html = from > 0 ? "… " : "";
  let at = from;
  for (const [start, end] of merged) {
    if (end <= from || start >= to) continue;
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    html += escapeHtml(text.slice(at, s)) + `<mark>${escapeHtml(text.slice(s, e))}</mark>`;
    at = e;
  }
  html += escapeHtml(text.slice(at, to)) + (to < text.length ? " …" : "");
  return html;
}
