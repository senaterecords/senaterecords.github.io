// The search query layer (spec 9.1): parse what the reader typed, plan the Pagefind searches, and keep only the
// remarks that really match. Pagefind finds pages; this decides which remarks on those pages count.
import { fold } from "./names";
import { stem } from "./stem";

/** Two terms (each a word or a phrase) within so many words of each other in one remark. */
export interface Near { a: string; b: string; within: number; }
/** Words, phrases and NEAR pairs a remark must all hold. */
export interface Terms { words: string[]; phrases: string[]; near: Near[]; }
/** A speaker: or senator: in the query, as typed (senator: looks among senators only). */
export interface SpeakerFilter { text: string; senate: boolean; }
/** The shortcuts in a query. Several values of one shortcut mean any of them; different shortcuts must all hold. */
export interface Filters {
  speakers?: SpeakerFilter[]; bills?: string[]; session?: number; years?: number[]; types?: ("floor" | "hearing")[]; committees?: string[];
}
/** What a NOT leaves out: remarks that hold all of its terms, by one of its speakers, in one of its transcripts. */
export interface Exclusion extends Terms { filters: Filters; }
/** One way for a remark to match: all of its terms, its shortcuts, and none of its exclusions. */
export interface Branch extends Terms { filters: Filters; not: Exclusion[]; }
/** A query as any of its branches (brackets and OR worked out). filters holds the shortcuts written outside brackets,
 * which narrow every branch; tooMany says the query works out to more branches than can be searched. */
export interface ParsedQuery { branches: Branch[]; filters: Filters; tooMany: boolean; }

const FIELDS = new Set(["speaker", "senator", "bill", "year", "type", "committee"]);
/** Branches searched at most, and how far the working out may grow before it stops. */
export const MAX_BRANCHES = 16;
const LIMIT = 256;

/** A word every indexed transcript holds once (hidden in the page): a search with only filters looks it up, because
 * Pagefind given no word at all loads its whole index (measured: 1,002 files, 73 MB, for speaker:luis-r-sepulveda). */
export const EVERY_PAGE = "otrrecordpage";
const NEAR_WORDS = 10;

type Token =
  | { kind: "word" | "phrase"; value: string; negated: boolean }
  | { kind: "field"; field: string; value: string; negated: boolean }
  | { kind: "op"; value: string }
  | { kind: "open"; negated: boolean }
  | { kind: "close" };

const isNot = (t: Token | undefined) => t?.kind === "op" && t.value === "NOT";

function tokenize(q: string): Token[] {
  const tokens: Token[] = [];
  // Inside speaker:( … ) and the like: every word or phrase is one more value of that shortcut, which already means
  // any of them, so its ORs and brackets need no working out.
  let group: { field: string; negated: boolean; depth: number } | null = null;
  const quoted = (from: number): [string, number] => {
    const end = q.indexOf('"', from + 1);
    return end < 0 ? [q.slice(from + 1), q.length] : [q.slice(from + 1, end), end + 1];
  };
  const add = (text: string, phrase: boolean, negated: boolean) => {
    // "tax!" (as Westlaw and Lexis write it) is "tax*": any word that starts with tax.
    const value = phrase ? text.trim().replace(/\s+/g, " ") : text.replace(/!$/, "*");
    if (!fold(value)) return; // punctuation alone: nothing to find
    if (group) tokens.push({ kind: "field", field: group.field, value, negated: group.negated !== negated });
    else tokens.push({ kind: phrase ? "phrase" : "word", value, negated });
  };
  let i = 0;
  while (i < q.length) {
    if (/\s/.test(q[i])) { i++; continue; }
    if (q[i] === ")") {
      i++;
      if (!group) tokens.push({ kind: "close" });
      else if (group.depth-- === 0) group = null;
      continue;
    }
    const negated = q[i] === "-" && i + 1 < q.length && !/[\s)]/.test(q[i + 1]);
    let j = negated ? i + 1 : i;
    if (q[j] === "(") {
      i = j + 1;
      if (group) group.depth++;
      else tokens.push({ kind: "open", negated });
      continue;
    }
    if (q[j] === '"') {
      const [text, next] = quoted(j);
      i = next;
      add(text, true, negated);
      continue;
    }
    const named = /^([A-Za-z]+):/.exec(q.slice(j));
    if (named && !group && FIELDS.has(named[1].toLowerCase())) {
      const field = named[1].toLowerCase();
      j += named[0].length;
      if (q[j] === "(") {
        // A NOT before speaker:( … ) leaves out every one of them, as a minus does.
        let not = negated;
        for (; isNot(tokens[tokens.length - 1]); not = !not) tokens.pop();
        group = { field, negated: not, depth: 0 };
        i = j + 1;
        continue;
      }
      let value: string;
      if (q[j] === '"') [value, i] = quoted(j);
      else { value = /^[^\s)]*/.exec(q.slice(j))![0]; i = j + value.length; }
      tokens.push({ kind: "field", field, value: value.trim(), negated });
      continue;
    }
    // A word runs to a space or a closing bracket.
    const text = /^[^\s)]+/.exec(q.slice(j))![0];
    i = j + text.length;
    // A lowercase "and" means AND (already the default between terms), not a word to find; "near/3" in any case can
    // only mean NEAR. A plain lowercase "near" stays a word ("homes near water").
    const op = !negated && (/^(AND|OR|NOT|NEAR(\/\d{1,3})?)$/.test(text) || text === "and" || /^near\/\d{1,3}$/i.test(text));
    if (op && !group) tokens.push({ kind: "op", value: text.toUpperCase() });
    else if (!op) add(text, false, negated);
  }
  return tokens;
}

/** A query as written: terms, shortcuts and what joins them. */
type Node =
  | { t: "term"; value: string; phrase: boolean }
  | { t: "field"; field: string; value: string }
  | { t: "and" | "or"; items: Node[] }
  | { t: "not"; item: Node }
  | { t: "near"; a: Node; b: Node; within: number };

/** Reads the tokens with the usual precedence: brackets first, then NOT, NEAR, AND (also unwritten), and OR last. An
 * unclosed bracket closes at the end, and an operator with nothing to work on is passed over. */
function parse(tokens: Token[]): Node | null {
  let i = 0;
  const join = (t: "and" | "or", items: Node[]): Node | null => (items.length > 1 ? { t, items } : items[0] ?? null);
  const isOr = (t: Token | undefined) => t?.kind === "op" && t.value === "OR";
  const unary = (): Node | null => {
    const t = tokens[i];
    if (!t || t.kind === "close" || isOr(t)) return null;
    i++;
    if (t.kind === "op") {
      if (t.value !== "NOT") return null; // AND or NEAR with nothing before it
      const item = unary();
      return item && { t: "not", item };
    }
    let node: Node | null;
    if (t.kind === "open") {
      node = or();
      if (tokens[i]?.kind === "close") i++;
    } else node = t.kind === "field" ? { t: "field", field: t.field, value: t.value } : { t: "term", value: t.value, phrase: t.kind === "phrase" };
    return node && (t.negated ? { t: "not", item: node } : node);
  };
  const near = (): Node | null => {
    let left = unary();
    for (let t = tokens[i]; left && t?.kind === "op" && t.value.startsWith("NEAR"); t = tokens[i]) {
      i++;
      const right = unary();
      if (!right) break;
      left = { t: "near", a: left, b: right, within: Number(t.value.split("/")[1] ?? NEAR_WORDS) };
    }
    return left;
  };
  const and = (): Node | null => {
    const items: Node[] = [];
    for (let t = tokens[i]; t && t.kind !== "close" && !isOr(t); t = tokens[i]) {
      if (t.kind === "op" && t.value === "AND") { i++; continue; }
      const item = near();
      if (item) items.push(item);
    }
    return join("and", items);
  };
  const or = (): Node | null => {
    const items: Node[] = [];
    const first = and();
    if (first) items.push(first);
    while (isOr(tokens[i])) {
      i++;
      const next = and();
      if (next) items.push(next);
    }
    return join("or", items);
  };
  const parts: Node[] = [];
  while (i < tokens.length) {
    const part = or();
    if (part) parts.push(part);
    if (tokens[i]?.kind === "close") i++; // a closing bracket with none open
  }
  return join("and", parts);
}

/** One branch while the query is worked out. */
type Conj = Branch;
const noTerms = (): Terms => ({ words: [], phrases: [], near: [] });
const empty = (): Conj => ({ ...noTerms(), filters: {}, not: [] });
const hasTerms = (t: Terms) => t.words.length + t.phrases.length + t.near.length > 0;
/** Whether shortcuts ask for certain transcripts (a year, a type, a committee, a bill), as speakers ask for remarks. */
const hasPlace = (f: Filters) => !!(f.years?.length || f.types?.length === 1 || f.committees?.length || f.bills?.length);
const hasFilters = (f: Filters) => !!(f.speakers?.length || hasPlace(f) || f.types?.length);

class TooMany extends Error {}

function mergeFilters(a: Filters, b: Filters): Filters {
  const out: Filters = { ...a };
  const add = <T>(x: T[] | undefined, y: T[] | undefined, key: (v: T) => string = String) =>
    [...new Map([...(x ?? []), ...(y ?? [])].map((v) => [key(v), v])).values()];
  if (b.speakers) out.speakers = add(a.speakers, b.speakers, (s) => `${s.senate}:${s.text.toLowerCase()}`);
  if (b.committees) out.committees = add(a.committees, b.committees);
  if (b.bills) out.bills = add(a.bills, b.bills);
  if (b.types) out.types = add(a.types, b.types);
  if (b.years) out.years = add(a.years, b.years).sort((x, y) => x - y);
  if (b.session) out.session = b.session;
  return out;
}

const combine = (a: Conj, b: Conj): Conj => ({
  words: [...a.words, ...b.words], phrases: [...a.phrases, ...b.phrases], near: [...a.near, ...b.near],
  filters: mergeFilters(a.filters, b.filters), not: [...a.not, ...b.not],
});

/** Every pairing of a branch of a with a branch of b: what AND makes of two lists of branches. */
function cross(a: Conj[], b: Conj[]): Conj[] {
  if (a.length * b.length > LIMIT) throw new TooMany();
  return a.flatMap((x) => b.map((y) => combine(x, y)));
}

/** A query worked out into branches, any of which may match (OR of ANDs). */
function branchesOf(node: Node): Conj[] {
  switch (node.t) {
    case "term": return [node.phrase ? { ...empty(), phrases: [node.value] } : { ...empty(), words: [node.value] }];
    case "field": {
      const filters: Filters = {};
      applyFilter(filters, node.field, node.value);
      return [{ ...empty(), filters }];
    }
    case "and": return node.items.reduce((all, item) => cross(all, branchesOf(item)), [empty()]);
    case "or": {
      const all = node.items.flatMap(branchesOf);
      if (all.length > LIMIT) throw new TooMany();
      return all;
    }
    case "near": {
      const a = branchesOf(node.a);
      const b = branchesOf(node.b);
      // NEAR pairs a word or phrase with another; with a bracket of them on a side, each one is paired. Anything more
      // (a bracket holding a shortcut or a NOT) can only ask that both be there.
      // A quoted single word keeps its quotes there, so it still matches only itself.
      const term = (c: Conj) => (!c.near.length && !c.not.length && !hasFilters(c.filters) && c.words.length + c.phrases.length === 1
        ? c.words[0] ?? (isPhrase(c.phrases[0]) ? c.phrases[0] : `"${c.phrases[0]}"`) : null);
      if (![...a, ...b].every(term)) return cross(a, b);
      if (a.length * b.length > LIMIT) throw new TooMany();
      return a.flatMap((x) => b.map((y) => ({ ...empty(), near: [{ a: term(x)!, b: term(y)!, within: node.within }] })));
    }
    case "not": {
      // NOT (x OR y) is NOT x AND NOT y; NOT (x AND NOT y) is NOT x OR y.
      return branchesOf(node.item).map((c) => {
        const options: Conj[] = c.not.map((e) => ({ ...e, not: [] }));
        const kept: Exclusion = { words: c.words, phrases: c.phrases, near: c.near, filters: c.filters };
        if (hasTerms(kept) || hasFilters(kept.filters)) options.unshift({ ...empty(), not: [kept] });
        return options.length ? options : [empty()]; // NOT of a shortcut that names nothing changes nothing
      }).reduce((all, options) => cross(all, options), [empty()]);
    }
  }
}

function applyFilter(filters: Filters, field: string, value: string) {
  if (!value) return;
  // Several speaker: or senator: mean any of those people (a remark has one speaker).
  if (field === "speaker" || field === "senator") filters.speakers = [...(filters.speakers ?? []), { text: value, senate: field === "senator" }];
  else if (field === "committee") filters.committees = [...(filters.committees ?? []), value];
  else if (field === "type") {
    const t = value.toLowerCase();
    if ((t === "floor" || t === "hearing") && !filters.types?.includes(t)) filters.types = [...(filters.types ?? []), t];
  } else if (field === "bill") {
    // "S4597" is that number in any session; "S4597/2025" (either year of the session) is that session's bill.
    const [number, year] = value.split("/");
    const m = number.toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^([SA])(\d+)/);
    if (m) {
      filters.bills = [...(filters.bills ?? []), `${m[1]}${m[2]}`];
      if (/^\d{4}$/.test(year ?? "")) filters.session = Number(year) % 2 ? Number(year) : Number(year) - 1;
    }
  } else if (field === "year") {
    const m = value.match(/^(\d{4})(?:-(\d{4}))?$/);
    if (m) {
      const from = Number(m[1]);
      const to = Number(m[2] ?? m[1]);
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      const years = new Set([...(filters.years ?? []), ...Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)]);
      filters.years = [...years].sort((a, b) => a - b);
    }
  }
}

export function parseQuery(q: string): ParsedQuery {
  // Shortcuts outside brackets narrow the whole query wherever they stand ("tolls OR fares year:2019" is either word,
  // in 2019), as the filters beside the results add them; inside brackets they belong to their group.
  const outside = empty();
  const rest: Token[] = [];
  let depth = 0;
  for (const t of tokenize(q)) {
    if (t.kind === "open") depth++;
    if (t.kind === "close") depth = Math.max(0, depth - 1);
    if (t.kind !== "field" || depth > 0) { rest.push(t); continue; }
    let not = false; // each NOT just before it turns it around
    for (; isNot(rest[rest.length - 1]); not = !not) rest.pop();
    const filters: Filters = {};
    applyFilter(filters, t.field, t.value);
    if (t.negated === not) outside.filters = mergeFilters(outside.filters, filters);
    else if (hasFilters(filters)) outside.not.push({ ...noTerms(), filters });
  }
  const tree = parse(rest);
  try {
    const branches = cross(tree ? branchesOf(tree) : [empty()], [outside]);
    if (branches.length > MAX_BRANCHES) throw new TooMany();
    return { branches: branches.length ? branches : [outside], filters: outside.filters, tooMany: false };
  } catch (error) {
    if (!(error instanceof TooMany)) throw error;
    return { branches: [outside], filters: outside.filters, tooMany: true };
  }
}

/** The searches Pagefind runs for a branch: each phrase on its own (Pagefind searches a phrase exactly only when it is
 * the whole term, and finds nothing for a term with several), then the other words together. The page keeps the
 * transcripts every search found, and each remark is still checked for every phrase and word (spec 9.1). */
export function pagefindTerms(b: Terms): string[] {
  const nearTerms = b.near.flatMap((n) => [n.a, n.b]);
  const words = [...b.words, ...nearTerms.filter((t) => !isPhrase(t))].map(bare).join(" ");
  const terms = [...[...b.phrases, ...nearTerms.filter(isPhrase)].map((p) => `"${p}"`), ...(words ? [words] : [])];
  return terms.length ? terms : [EVERY_PAGE];
}

const isPhrase = (term: string) => /\s/.test(term.trim());
/** A word as Pagefind is asked for it, without the * of "tax*" or the quotes of an exact word in a NEAR: its own
 * matching (forms, and the start of a word) finds at least as much, and each remark is then checked exactly. */
const bare = (word: string) => word.replace(/[*!]$/, "").replace(/^"(.*)"$/, "$1");

/** Filters as Pagefind takes them: values, "any" lists, and "none" for transcripts left out. */
export type PagefindFilters = { [key: string]: string | string[] | { any: string[] } | PagefindFilters[] };

/** Pagefind filters for a branch. A range of years needs "any"; a plain list would require every year at once. A NOT
 * that rules out whole transcripts (a year, a type, a committee, a bill) is left to Pagefind too; one that names
 * words or a speaker is a matter for each remark. */
export function pagefindFilters(f: Filters, speakers: string | string[] | null, not: Exclusion[] = []): PagefindFilters {
  const slugs = speakers == null ? [] : Array.isArray(speakers) ? speakers : [speakers];
  const out: PagefindFilters = {};
  const oneOrAny = (values: string[]) => (values.length === 1 ? values[0] : { any: values });
  if (f.years?.length) out.year = f.years.length === 1 ? [String(f.years[0])] : { any: f.years.map(String) };
  if (f.types?.length === 1) out.type = f.types[0]; // both record types is no filter
  if (f.bills?.length) out.bill = oneOrAny(f.bills);
  if (f.session && f.bills?.length === 1) out.session = String(f.session);
  if (f.committees?.length) out.committee = oneOrAny(f.committees);
  if (slugs.length) out.senator = oneOrAny(slugs);
  const none = not.filter((e) => !hasTerms(e) && !e.filters.speakers?.length && hasPlace(e.filters)).map((e) => pagefindFilters(e.filters, null));
  if (none.length) out.none = none;
  return out;
}

/** One remark found on a page. breaks are [word index in text, page] for each page that begins inside it. */
export interface Remark { url: string; turn: number; page: number | null; speaker: string | null; label: string; text: string; breaks: [number, number][]; }

/** A transcript's filter values, as Pagefind keeps them with its text: year, type, committee, bill, session. */
export type PageFilters = Record<string, string[]>;

/** Where each bill is in a transcript: the turns of its readings and debate, and each turn that mentions it. */
export type BillPlaces = Map<string, [number, number][]>;

/** The places a transcript page records with its text ("A10176=632-643,700|S4149=12-20"). */
export function billPlaces(meta: string | undefined): BillPlaces | undefined {
  if (!meta) return undefined;
  const out: BillPlaces = new Map();
  for (const part of meta.split("|")) {
    const [bill, spans] = part.split("=");
    if (!bill || !spans) continue;
    out.set(bill, spans.split(",").map((span) => {
      const [from, to] = span.split("-").map(Number);
      return [from, Number.isFinite(to) ? to : from] as [number, number];
    }));
  }
  return out;
}

/** Whether a remark is one a branch's bill: asks for: in the reading or debate of one of its bills, or mentioning one.
 * A transcript without recorded places keeps all its remarks, as before. */
function atBill(r: Remark, f: Filters, places?: BillPlaces): boolean {
  if (!f.bills?.length || !places) return true;
  return f.bills.some((bill) => (places.get(bill) ?? []).some(([from, to]) => r.turn >= from && r.turn <= to));
}

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

/** How one search word matches a remark's words: by its forms ("tax": taxes, taxed, taxing, as the index stems them),
 * as the start of a word ("tax*" or "tax!": taxpayer, taxation), or exactly (a quoted word, "\"tax\"", as a NEAR
 * keeps it). Null for a word that folds to several (co-op), which matches as a phrase. */
function matcher(term: string): ((word: string) => boolean) | null {
  const text = fold(term);
  if (!text || text.includes(" ")) return null;
  if (/^".*"$/.test(term.trim())) return (w) => w === text;
  if (/[*!]$/.test(term)) return (w) => w.startsWith(text);
  const s = stem(text);
  // A word's stem keeps all but its last few letters, so only words that start alike need stemming.
  const head = s.slice(0, Math.max(1, s.length - 4));
  return (w) => w.startsWith(head) && stem(w) === s;
}

function positions(words: string[], term: string): number[] {
  const hit = matcher(term);
  return hit ? words.flatMap((w, i) => (hit(w) ? [i] : [])) : [];
}

function hasPhrase(words: string[], phrase: string): boolean {
  const p = fold(phrase);
  return !!p && ` ${words.join(" ")} `.includes(` ${p} `);
}

function present(words: string[], term: string): boolean {
  return fold(term).includes(" ") ? hasPhrase(words, term) : positions(words, term).length > 0;
}

/** Where a word (as it matches) or a phrase (all its words) occurs, as [first, last] word indexes. */
function spans(words: string[], term: string): [number, number][] {
  const parts = fold(term).split(" ").filter(Boolean);
  if (parts.length <= 1) return positions(words, term).map((i) => [i, i] as [number, number]);
  const out: [number, number][] = [];
  for (let i = 0; i + parts.length <= words.length; i++) {
    if (parts.every((part, k) => words[i + k] === part)) out.push([i, i + parts.length - 1]);
  }
  return out;
}

/** Whether the two sides of a NEAR come within its distance: words between their closest ends. */
function near(words: string[], n: Near): boolean {
  const as = spans(words, n.a);
  const bs = spans(words, n.b);
  return as.some(([a0, a1]) => bs.some(([b0, b1]) => !(a0 === b0 && a1 === b1) && Math.max(0, b0 - a1, a0 - b1) <= n.within));
}

// A senator presiding speaks as "ACTING PRESIDENT X"; the site counts those turns apart from remarks.
const PRESIDING = /^acting president\b/i;

/** Who speaker: asked for: people the site knows (by slug), and names as the transcripts print them (folded), for
 * speakers the Senate's data doesn't know, such as hearing witnesses. A bare slug or list of slugs means people only. */
export interface Speakers { slugs: string[]; labels: string[]; }
export type SpeakerMatch = string | string[] | Speakers | null;

const speakersOf = (s: SpeakerMatch): Speakers | null =>
  s == null ? null : typeof s === "string" ? { slugs: [s], labels: [] } : Array.isArray(s) ? { slugs: s, labels: [] } : s;

/** Whether a remark is by one of the asked-for speakers (any remark when none was asked for). */
function bySpeaker(r: Remark, speakers: SpeakerMatch): boolean {
  const asked = speakersOf(speakers);
  if (!asked) return true;
  if (r.speaker && asked.slugs.includes(r.speaker) && !PRESIDING.test(r.label)) return true;
  const label = fold(r.label);
  const words = label.split(" ");
  // A printed name matches by the start of any of its words ("hil" finds HILLER), or as a whole phrase.
  return asked.labels.some((name) => (name.includes(" ") ? label.includes(name) : words.some((w) => w.startsWith(name))));
}

/** Whether a transcript is one a branch's shortcuts ask for (speakers are a matter for each remark). A page whose
 * filter values are unknown passes. */
function onPage(page: PageFilters | undefined, f: Filters): boolean {
  if (!page) return true;
  const any = (key: string, values: string[]) => values.some((v) => (page[key] ?? []).includes(v));
  if (f.years?.length && !any("year", f.years.map(String))) return false;
  if (f.types?.length === 1 && !any("type", f.types)) return false;
  if (f.committees?.length && !any("committee", f.committees)) return false;
  if (f.bills?.length && !any("bill", f.bills)) return false;
  return !(f.session && f.bills?.length === 1 && !any("session", [String(f.session)]));
}

const holds = (words: string[], t: Terms) =>
  t.words.every((w) => present(words, w)) && t.phrases.every((p) => hasPhrase(words, p)) && t.near.every((n) => near(words, n));

/** Whether a NOT takes a remark out: it holds all of the NOT's terms, is by one of its speakers and is in one of its
 * transcripts (whichever of those it names). Speakers not yet looked up are matched by the name as typed. */
function excluded(r: Remark, words: string[], e: Exclusion, who: SpeakerMatch, page?: PageFilters): boolean {
  const terms = hasTerms(e);
  const people = !!e.filters.speakers?.length;
  const place = hasPlace(e.filters);
  if (!terms && !people && !place) return false;
  const typed = (): Speakers => ({ slugs: e.filters.speakers!.map((s) => s.text.toLowerCase()), labels: e.filters.speakers!.map((s) => fold(s.text.replace(/-/g, " "))) });
  return (!terms || holds(words, e)) && (!people || bySpeaker(r, who ?? typed())) && (!place || (!!page && onPage(page, e.filters)));
}

/** Whether a remark matches a branch: by its speakers (looked up), in its transcripts, with all its terms, and taken out
 * by none of its NOTs (whose speakers, looked up, come one per NOT). */
export function keepRemark(r: Remark, b: Branch, speakers: SpeakerMatch = null, notSpeakers: SpeakerMatch[] = [], page?: PageFilters, places?: BillPlaces): boolean {
  if (!bySpeaker(r, speakers) || !onPage(page, b.filters) || !atBill(r, b.filters, places)) return false;
  const words = foldedWords(r.text);
  return holds(words, b) && !b.not.some((e, k) => excluded(r, words, e, notSpeakers[k] ?? null, page));
}

/** Across a whole transcript (which holds every term): a remark that holds any of the branch's terms, still honouring
 * NOT and speaker:. With no terms it is the same as keepRemark. */
/** Whether "anywhere in a transcript" can change what a search finds: some branch has two or more words or phrases
 * that must come together in one remark (a NEAR pair counts as two). For any other search the choice isn't offered. */
export function whereMatters(p: ParsedQuery): boolean {
  return p.branches.some((b) => b.words.length + b.phrases.length + 2 * b.near.length > 1);
}

export function mentionsAny(r: Remark, b: Branch, speakers: SpeakerMatch = null, notSpeakers: SpeakerMatch[] = [], page?: PageFilters, places?: BillPlaces): boolean {
  const terms = [...b.words, ...b.near.flatMap((n) => [n.a, n.b])];
  if (!b.phrases.length && !terms.length) return keepRemark(r, b, speakers, notSpeakers, page, places);
  if (!bySpeaker(r, speakers) || !onPage(page, b.filters) || !atBill(r, b.filters, places)) return false;
  const words = foldedWords(r.text);
  if (b.not.some((e, k) => excluded(r, words, e, notSpeakers[k] ?? null, page))) return false;
  return b.phrases.some((p) => hasPhrase(words, p)) || terms.some((t) => present(words, t));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const L = "\\p{L}\\p{N}";
const EXCERPT = 360;

interface Hit { start: number; end: number; term: string; }

/** Every hit of a branch's terms in a text, in order, each with the term it belongs to: marked by the same rules as
 * the remark was matched by (a word's forms, the start of a word with *, an exact word or phrase in quotes). */
function termHits(text: string, b: Branch): Hit[] {
  const nearTerms = b.near.flatMap((n) => [n.a, n.b]);
  const phrase = (p: string) => p.split(/\s+/).map(escapeRegex).join(`[^${L}]+`) + `(?![${L}])`;
  const out: Hit[] = [];
  const find = (term: string, pattern: string) => {
    for (const m of text.matchAll(new RegExp(`(?<![${L}])${pattern}`, "giu"))) out.push({ start: m.index!, end: m.index! + m[0].length, term });
  };
  for (const t of [...b.phrases, ...nearTerms.filter(isPhrase)]) find(t, phrase(t));
  const forms: { term: string; hit: (word: string) => boolean }[] = [];
  for (const t of [...b.words, ...nearTerms.filter((w) => !isPhrase(w))]) {
    const exact = /^"(.*)"$/.exec(t.trim());
    if (exact) find(t, `${escapeRegex(exact[1])}(?![${L}])`);
    else if (/[*!]$/.test(t)) find(t, `${escapeRegex(t.slice(0, -1))}[${L}]*`);
    else if (fold(t).includes(" ")) find(t, phrase(t));
    else forms.push({ term: t, hit: matcher(t)! });
  }
  // A word's forms are found word by word: each word of the text with the search word's stem.
  if (forms.length) {
    for (const m of text.matchAll(new RegExp(`[${L}]+(?:['’][${L}]+)*`, "gu"))) {
      const word = fold(m[0]).replace(/ /g, "");
      const found = forms.find((f) => f.hit(word));
      if (found) out.push({ start: m.index!, end: m.index! + m[0].length, term: found.term });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Hits as merged [start, end) character ranges, for marking. */
function merge(all: Hit[]): [number, number][] {
  const merged: [number, number][] = [];
  for (const { start, end } of all) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Where a long remark's excerpt is centred: on the closest pair of a NEAR (the place that matched), else where the
 * most different terms come together, else on the first hit. */
function anchorOf(b: Branch, all: Hit[]): number {
  if (!all.length) return 0;
  const n = b.near[0];
  if (n) {
    let best: { gap: number; at: number } | null = null;
    for (const x of all) {
      if (x.term !== n.a) continue;
      for (const y of all) {
        if (y.term !== n.b || y === x) continue;
        const gap = Math.max(0, y.start - x.end, x.start - y.end);
        if (!best || gap < best.gap) best = { gap, at: Math.min(x.start, y.start) };
      }
    }
    if (best) return best.at;
  }
  if (new Set(all.map((h) => h.term)).size < 2) return all[0].start;
  let at = all[0].start;
  let most = 0;
  for (const h of all) {
    const from = h.start - 120;
    const terms = new Set(all.filter((o) => o.start >= from && o.end <= from + EXCERPT).map((o) => o.term)).size;
    if (terms > most) { most = terms; at = h.start; }
  }
  return at;
}

/** The [from, to) characters shown for a remark: all of it, or a window around the anchor when it is long. */
function windowOf(text: string, anchor: number): [number, number] {
  let from = 0;
  let to = text.length;
  if (text.length > EXCERPT) {
    from = Math.max(0, anchor - 120);
    if (from > 0) from = text.indexOf(" ", from) + 1 || from;
    to = Math.min(text.length, from + EXCERPT);
    if (to < text.length) to = text.lastIndexOf(" ", to) > from ? text.lastIndexOf(" ", to) : to;
  }
  return [from, to];
}

/** A remark's hits (merged, for marking) and the window its excerpt shows. */
function placed(text: string, b: Branch): { merged: [number, number][]; anchor: number; from: number; to: number } {
  const all = termHits(text, b);
  const anchor = anchorOf(b, all);
  const [from, to] = windowOf(text, anchor);
  return { merged: merge(all), anchor, from, to };
}

/** The remark as safe HTML with hits in <mark>, trimmed around where the query matches when it is long. */
export function excerpt(r: Remark, b: Branch): string {
  const text = r.text;
  const { merged, from, to } = placed(text, b);
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
  const { from, to } = placed(r.text, b);
  return r.text.slice(from, to);
}

/** The page where the query matches, and the pages the excerpt spans, for "p. N" and the citation. */
export function excerptPages(r: Remark, b: Branch): { hit: number | null; start: number | null; end: number | null } {
  const { merged, anchor, from, to } = placed(r.text, b);
  const wordAt = (offset: number) => (r.text.slice(0, offset).match(/ /g) ?? []).length;
  const pageAt = (word: number) => r.breaks.reduce<number | null>((page, [at, p]) => (at <= word ? p : page), r.page);
  return { hit: pageAt(wordAt(merged.length ? anchor : from)), start: pageAt(wordAt(from)), end: pageAt(wordAt(Math.max(from, to - 1))) };
}

// A query's tokens as typed: a shortcut with a quoted value ("committee:\"Ways and Means\""), a phrase, or a word.
const TOKENS = /-?[A-Za-z]+:"[^"]*"?|"[^"]*"?|\S+/g;
const sameToken = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A shortcut written outside brackets: where it stands in the query and what it says. Those are the ones the
 * filters beside the results show and change (inside brackets, a shortcut belongs to its group). */
export interface TopShortcut { start: number; end: number; field: string; value: string; negated: boolean; }

export function topShortcuts(q: string): TopShortcut[] {
  const out: TopShortcut[] = [];
  let depth = 0;
  let last = "";
  for (const m of q.matchAll(/(-?)([A-Za-z]+):("[^"]*"?|\([^)]*\)?|[^\s)]*)|"[^"]*"?|[()]|[^\s()"]+/g)) {
    const text = m[0];
    if (text === "(") depth++;
    else if (text === ")") depth = Math.max(0, depth - 1);
    else if (m[2] && depth === 0 && FIELDS.has(m[2].toLowerCase())) {
      const value = m[3].replace(/^"|"$/g, "").trim();
      out.push({ start: m.index!, end: m.index! + text.length, field: m[2].toLowerCase(), value, negated: (m[1] === "-") !== (last === "NOT") });
    }
    last = text;
  }
  return out;
}

/** The years as shortcuts, runs of years as ranges: [2019, 2020, 2022, 2023, 2024] is "year:2019-2020 year:2022-2024". */
export function yearShortcuts(years: number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const y of sorted) {
    const run = runs[runs.length - 1];
    if (run && y === run[1] + 1) run[1] = y;
    else runs.push([y, y]);
  }
  return runs.map(([a, b]) => `year:${a === b ? a : `${a}-${b}`}`).join(" ");
}

/** Whether a shortcut such as type:hearing is already in the query. */
export const hasShortcut = (q: string, shortcut: string) => (q.match(TOKENS) ?? []).some((t) => sameToken(t, shortcut));

/** The query with a shortcut added, or taken out when it is there. */
export function toggleShortcut(q: string, shortcut: string): string {
  return hasShortcut(q, shortcut)
    ? (q.match(TOKENS) ?? []).filter((t) => !sameToken(t, shortcut)).join(" ")
    : `${q.trim()} ${shortcut}`.trim();
}

/** Whether to fetch another batch for the first screen: until five remarks show, and at most three batches, unless
 * what is left fits in one more (20 transcripts), so the counts come out final rather than "so far". */
export const fillMore = (kept: number, batches: number, left: number) => kept < 5 && (batches < 3 || left <= 20);
