// The search query layer (spec 9.1): parse what the reader typed, plan the Pagefind searches, and keep only the
// remarks that really match. Pagefind finds pages; this decides which remarks on those pages count.
import { fold } from "./names";

export interface Branch { words: string[]; phrases: string[]; near: [string, string][]; }
export interface Filters { speaker?: string; bill?: string; session?: number; years?: number[]; type?: "floor" | "hearing"; committee?: string; }
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
      // A lowercase "and" means AND (already the default between terms), not a word to find.
      if (!minus && (/^(AND|OR|NOT|NEAR)$/.test(text) || text === "and")) tokens.push({ kind: "op", value: text.toUpperCase() });
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
    // "S4597" is that number in any session; "S4597/2025" (either year of the session) is that session's bill.
    const [number, year] = value.split("/");
    const m = number.toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^([SA])(\d+)/);
    if (m) {
      filters.bill = `${m[1]}${m[2]}`;
      if (/^\d{4}$/.test(year ?? "")) filters.session = Number(year) % 2 ? Number(year) : Number(year) - 1;
    }
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

/** The searches Pagefind runs for a branch: each phrase on its own (Pagefind searches a phrase exactly only when it is
 * the whole term, and finds nothing for a term with several), then the other words together. The page keeps the
 * transcripts every search found, and each remark is still checked for every phrase and word (spec 9.1). */
export function pagefindTerms(b: Branch): string[] {
  const words = [...b.words, ...b.near.flat()].join(" ");
  const terms = [...b.phrases.map((p) => `"${p}"`), ...(words ? [words] : [])];
  return terms.length ? terms : [""];
}

/** Pagefind filters for a query. A range of years needs "any"; a plain list would require every year at once. */
export function pagefindFilters(f: Filters, speakerSlug: string | null): Record<string, string | string[] | { any: string[] }> {
  const out: Record<string, string | string[] | { any: string[] }> = {};
  if (f.years?.length) out.year = f.years.length === 1 ? [String(f.years[0])] : { any: f.years.map(String) };
  if (f.type) out.type = f.type;
  if (f.bill) out.bill = f.bill;
  if (f.session) out.session = String(f.session);
  if (f.committee) out.committee = f.committee;
  if (speakerSlug) out.senator = speakerSlug;
  return out;
}

/** One remark found on a page. breaks are [word index in text, page] for each page that begins inside it. */
export interface Remark { url: string; turn: number; page: number | null; speaker: string | null; label: string; text: string; breaks: [number, number][]; }

interface PageData { url: string; content: string; anchors: { element: string; id: string; text: string; location: number }[]; }

/** A page's remarks: each labelled turn (r-) up to the next turn of either kind, so stage directions and roll calls
 * (t-) are not glued onto the remark before them. A transcript without labels (the plain-text fallback) is searched
 * as its unlabelled text. Page breaks (p{N}) give the page of every word. */
export function remarksOf(data: PageData): Remark[] {
  const words = data.content.split(/\s+/).filter(Boolean);
  const turns = data.anchors.filter((a) => /^[rt]-\d+$/.test(a.id)).sort((a, b) => a.location - b.location);
  const pages = data.anchors.flatMap((a) => {
    const m = a.id.match(/^p(\d+)$/);
    return m ? [[a.location, Number(m[1])] as [number, number]] : [];
  }).sort((a, b) => a[0] - b[0]);
  const who = new Map<number, { page: number | null; speaker: string | null; label: string }>();
  for (const a of data.anchors) {
    const m = a.id.match(/^w-(\d+)-(\d+)-(.+)$/);
    if (m) who.set(Number(m[1]), { page: Number(m[2]) || null, speaker: m[3] === "x" ? null : m[3], label: a.text });
  }
  const labelled = turns.some((a) => a.id.startsWith("r-"));
  return turns.flatMap((a, idx) => {
    if (labelled && a.id.startsWith("t-")) return [];
    const turn = Number(a.id.slice(2));
    const start = a.location;
    const end = turns[idx + 1]?.location ?? words.length;
    const breaks = pages.filter(([at]) => at >= start && at < end).map(([at, page]) => [at - start, page] as [number, number]);
    const w = who.get(turn);
    // An unlabelled turn's first page is the one before its first break (pages run in order).
    const page = w ? w.page : breaks.length ? breaks[0][1] - (breaks[0][0] === 0 ? 0 : 1) : null;
    return [{
      url: `${data.url}#${a.id}`, turn, page, speaker: w?.speaker ?? null,
      label: w?.label ?? (a.id.startsWith("r-") ? a.text : ""), text: words.slice(start, end).join(" "), breaks,
    }];
  });
}

/** A remark's words without the speaker's label that heads it, so a name matches what was said, not who said it. */
export function spokenText(r: Remark): Remark {
  if (!r.label || !r.text.startsWith(r.label)) return r;
  const text = r.text.slice(r.label.length).replace(/^[\s.:]+/, "");
  const dropped = r.text.split(" ").length - (text ? text.split(" ").length : 0);
  return { ...r, text, breaks: r.breaks.map(([at, page]) => [Math.max(0, at - dropped), page] as [number, number]) };
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

// A senator presiding speaks as "ACTING PRESIDENT X"; the site counts those turns apart from remarks.
const PRESIDING = /^acting president\b/i;

export function keepRemark(r: Remark, b: Branch, not: string[], speakerSlug: string | null): boolean {
  if (speakerSlug && (r.speaker !== speakerSlug || PRESIDING.test(r.label))) return false;
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

/** Across a whole transcript (which holds every term): a remark that holds any of the branch's terms, still honouring
 * NOT and speaker:. With no terms it is the same as keepRemark. */
export function mentionsAny(r: Remark, b: Branch, not: string[], speakerSlug: string | null): boolean {
  const terms = [...b.words, ...b.near.flat()];
  if (!b.phrases.length && !terms.length) return keepRemark(r, b, not, speakerSlug);
  if (speakerSlug && (r.speaker !== speakerSlug || PRESIDING.test(r.label))) return false;
  const words = foldedWords(r.text);
  if (not.some((n) => present(words, n))) return false;
  return b.phrases.some((p) => hasPhrase(words, p)) || terms.some((t) => present(words, t));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const L = "\\p{L}\\p{N}";
const EXCERPT = 360;

/** The hits of a branch in a text, as merged [start, end) character ranges. */
function hits(text: string, b: Branch): [number, number][] {
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
  return merged;
}

/** The [from, to) characters shown for a remark: all of it, or a window around the first hit when it is long. */
function windowOf(text: string, merged: [number, number][]): [number, number] {
  let from = 0;
  let to = text.length;
  if (text.length > EXCERPT) {
    const first = merged[0]?.[0] ?? 0;
    from = Math.max(0, first - 120);
    if (from > 0) from = text.indexOf(" ", from) + 1 || from;
    to = Math.min(text.length, from + EXCERPT);
    if (to < text.length) to = text.lastIndexOf(" ", to) > from ? text.lastIndexOf(" ", to) : to;
  }
  return [from, to];
}

/** The remark as safe HTML with hits in <mark>, trimmed around the first hit when it is long. */
export function excerpt(r: Remark, b: Branch): string {
  const text = r.text;
  const merged = hits(text, b);
  const [from, to] = windowOf(text, merged);
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

/** The plain words of a remark's excerpt: what its result row shows. */
export function excerptText(r: Remark, b: Branch): string {
  const [from, to] = windowOf(r.text, hits(r.text, b));
  return r.text.slice(from, to);
}

/** The page of a remark's first hit, and the pages its excerpt spans, for "p. N" and the citation. */
export function excerptPages(r: Remark, b: Branch): { hit: number | null; start: number | null; end: number | null } {
  const merged = hits(r.text, b);
  const [from, to] = windowOf(r.text, merged);
  const wordAt = (offset: number) => (r.text.slice(0, offset).match(/ /g) ?? []).length;
  const pageAt = (word: number) => r.breaks.reduce<number | null>((page, [at, p]) => (at <= word ? p : page), r.page);
  return { hit: pageAt(wordAt(merged[0]?.[0] ?? from)), start: pageAt(wordAt(from)), end: pageAt(wordAt(Math.max(from, to - 1))) };
}

// A query's tokens as typed: a shortcut with a quoted value ("committee:\"Ways and Means\""), a phrase, or a word.
const TOKENS = /-?[A-Za-z]+:"[^"]*"?|"[^"]*"?|\S+/g;
const sameToken = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether a shortcut such as type:hearing is already in the query. */
export const hasShortcut = (q: string, shortcut: string) => (q.match(TOKENS) ?? []).some((t) => sameToken(t, shortcut));

/** The query with a shortcut added, or taken out when it is there. */
export function toggleShortcut(q: string, shortcut: string): string {
  return hasShortcut(q, shortcut)
    ? (q.match(TOKENS) ?? []).filter((t) => !sameToken(t, shortcut)).join(" ")
    : `${q.trim()} ${shortcut}`.trim();
}

/** Whether to fetch another batch for the first screen: until five remarks show, and at most three batches. */
export const fillMore = (kept: number, batches: number) => kept < 5 && batches < 3;
