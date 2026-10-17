// The search page (spec 9.1), as in "Search results" and the phone results: Pagefind finds transcripts, the query
// layer keeps the remarks that really match, one row per remark.
import { useCallback, useEffect, useRef, useState } from "react";
import { download } from "../lib/download";
import { DOCX_TYPE, docx } from "../lib/docx";
import { resultsBlocks, resultsCsv, type ResultItem } from "../lib/exports";
import { jsonCache } from "../lib/fetch";
import { legalCite, resultCounts, shortDate, speakerForms, titleCase, type SpeakerKind } from "../lib/format";
import { committeeNamed, fold, resolveSpeaker, type Person } from "../lib/names";
import {
  billPlaces, excerpt, excerptPages, excerptText, fillMore, keepRemark, MAX_BRANCHES, mentionsAny, pagefindFilters, pagefindTerms, parseQuery, remarksOf, spokenText,
  topShortcuts, whereMatters, yearShortcuts, type Branch, type TopShortcut, type Filters, type PagefindFilters, type ParsedQuery, type Remark, type SameAs, type SpeakerFilter, type Speakers, type Terms,
} from "../lib/query";
import { inOrder } from "../lib/order";
import { passageParam } from "../lib/passage";
import { closestWord } from "../lib/spelling";
import { url } from "../lib/url";
import { indexFailed, loadPagefind, readFragment, searchBranch, type PageData, type Pagefind, type PagefindResult, type PagefindSearch } from "./pagefind";
import { ExportButton } from "./ExportButton";
import { InfoTip } from "./InfoTip";
import SearchBox from "./SearchBox";
import { clientOnly, Icon } from "./ui";

// Transcripts read per batch (tests lower it, through window.__otrBatch, to reach a partly read result on a small sample).
const PAGE = (globalThis as { __otrBatch?: number }).__otrBatch ?? 20;
const READERS = 6;    // fragments read at once
const POSSIBLE = <><b>Possible transcripts</b> here means the transcripts that have all your words somewhere in them. Each one is searched for remarks where the words come together.</>;
const SHOW = 25;      // remarks shown at a time
const LOAD_FAILED = "Search couldn't load. Check your connection and try again.";
const getJson = jsonCache(url);

type Pages = ReturnType<typeof excerptPages>;
interface Row { key: string; remark: Remark; branch: Branch; pages: Pages; meta: Record<string, string>; transcript: string; href: string; }
type Status = "loading" | "failed" | "which" | "nomatch" | "toomany" | "ready";
type Phase = "searching" | "reading" | null;
type Facets = PagefindSearch["filters"];
/** Each bill a query names with its same-as bills, once they are looked up (for the note and the Bill filter). */
interface Twins { q: string; of: Record<string, SameAs[]>; }
const prefixOf = (base: string) => base.slice(0, base.length > 2 ? 3 : 2);
const sessionName = (session: number) => `${session}–${String(session + 1).slice(2)}`;
/** A branch's speakers, looked up: the ones it asks for, and the ones each of its NOTs leaves out. */
interface Who { speakers: Speakers | null; not: (Speakers | null)[]; }
/** A search as run: the query worked out, its speakers looked up (by how each was typed), and the committee names. */
interface Plan { parsed: ParsedQuery; who: Who[]; wide: boolean; found: Map<string, { slug?: string; label?: string }>; committees: string[]; }
/** One Pagefind search a query needs: a branch's terms and filters (a printed speaker name searched as words). */
interface Unit { terms: Terms; filters: PagefindFilters; }

/** The rows a page contributes: its remarks that match a branch (in one remark, or across the transcript), in order. */
function rowsOf(page: PageData, plan: Plan): Row[] {
  const transcript = page.url.replace(/\/$/, "").split("/").pop() ?? page.url;
  const rows: Row[] = [];
  const match = plan.wide ? mentionsAny : keepRemark;
  // A bill: search keeps to the bill's readings, its debate and the remarks that mention it.
  const places = billPlaces(page.meta.bills);
  for (const remark of remarksOf(page).map(spokenText)) {
    const branch = plan.parsed.branches.find((b, k) => match(remark, b, plan.who[k].speakers, plan.who[k].not, page.filters, places));
    if (!branch) continue;
    // The link also names the passage the row shows, so the transcript lands on it and highlights it for a moment.
    const href = remark.url.replace("#", `?hl=${encodeURIComponent(passageParam(excerptText(remark, branch)))}#`);
    rows.push({ key: remark.url, remark, branch, pages: excerptPages(remark, branch), meta: page.meta, transcript, href });
  }
  return rows;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The query with one speaker:/senator: replaced by the person picked under "Which …?". */
function replaceSpeaker(q: string, asking: SpeakerFilter, slug: string): string {
  const field = asking.senate ? "senator" : "speaker";
  const typed = new RegExp(`${field}:("${escapeRegex(asking.text)}"?|${escapeRegex(asking.text)})(?=[\\s)]|$)`, "i");
  return q.replace(typed, `${field}:${slug}`);
}

/** The searches a branch needs. A speaker the Senate's data doesn't know can't be a filter in the index: their printed
 * name is searched as words the transcript must hold, beside a search filtered to any people the branch also names. */
function unitsOf(b: Branch, who: Who): Unit[] {
  const slugs = who.speakers?.slugs ?? [];
  const labels = who.speakers?.labels ?? [];
  const filters = (people: string[] | null) => pagefindFilters(b.filters, people, b.not);
  if (!labels.length) return [{ terms: b, filters: filters(slugs.length ? slugs : null) }];
  return [
    ...(slugs.length ? [{ terms: b, filters: filters(slugs) }] : []),
    ...labels.map((name) => ({ terms: { ...b, words: [...b.words, ...name.split(" ")] }, filters: filters(null) })),
  ];
}

/** The transcripts that every one of several searches finds: all their terms, and all their filters. */
function overlap(units: Unit[]): Unit {
  const filters = units.map((u) => u.filters).filter((f) => Object.keys(f).length);
  return {
    terms: { words: units.flatMap((u) => u.terms.words), phrases: units.flatMap((u) => u.terms.phrases), near: units.flatMap((u) => u.terms.near) },
    filters: filters.length > 1 ? { all: filters } : filters[0] ?? {},
  };
}

/** Facet counts over the transcripts any of the searches found. Two or three searches are added up less what they
 * share, so a transcript found twice counts once. That needs each count to be exact, which it is only for a search
 * Pagefind runs in one go: a phrase is searched on its own, and such a search's counts are its first part's. Otherwise
 * the counts are added up, no value above the transcripts found. */
async function facetCounts(pf: Pagefind, units: Unit[], sort: unknown, cap: number, known?: PagefindSearch[]): Promise<Facets> {
  const search = (u: Unit) => searchBranch(pf, u.terms, { filters: u.filters, sort });
  const singles = known ?? await Promise.all(units.map(search));
  const exact = (u: Unit) => pagefindTerms(u.terms).length === 1;
  if (singles.length === 1 && exact(units[0])) return singles[0].filters;
  const total: Facets = {};
  const add = (counts: Facets, sign: number) => {
    for (const [key, values] of Object.entries(counts)) {
      const into = (total[key] ??= {});
      for (const [value, n] of Object.entries(values)) into[value] = (into[value] ?? 0) + sign * n;
    }
  };
  for (const s of singles) add(s.filters, 1);
  const groups = units.length === 2 ? [[0, 1]] : units.length === 3 ? [[0, 1], [0, 2], [1, 2], [0, 1, 2]] : [];
  const overlaps = groups.map((g) => overlap(g.map((k) => units[k])));
  if (groups.length && units.every(exact) && overlaps.every(exact)) {
    const shared = await Promise.all(overlaps.map(search));
    shared.forEach((s, k) => add(s.filters, groups[k].length === 2 ? -1 : 1));
  } else {
    for (const values of Object.values(total)) for (const value of Object.keys(values)) values[value] = Math.min(values[value], cap);
  }
  return total;
}

/** Every set of shortcuts in a query: outside brackets, in each branch, and in each of its NOTs. */
const filterSets = (parsed: ParsedQuery): Filters[] => [parsed.filters, ...parsed.branches.flatMap((b) => [b.filters, ...b.not.map((e) => e.filters)])];

/** Placeholder rows while the first remarks load: the shape of a result, shimmering. */
const SKELETON = (
  <>
    {[0, 1, 2, 3].map((n) => (
      <article key={n} className="rrow skel" aria-hidden="true">
        <div className="c-date"><span className="bar" style={{ width: "72%" }} /><span className="bar sm" style={{ width: "54%" }} /></div>
        <div>
          <span className="bar" style={{ width: "28%" }} />
          <span className="bar tx" style={{ width: "100%" }} /><span className="bar tx" style={{ width: "94%" }} /><span className="bar tx" style={{ width: n % 2 ? "58%" : "76%" }} />
        </div>
        <div className="c-cite"><span className="bar" style={{ width: "36%" }} /><span className="bar sm" style={{ width: "62%" }} /></div>
      </article>
    ))}
  </>
);

const readUrl = () => {
  const p = new URLSearchParams(location.search);
  const sort = p.get("sort");
  return { q: p.get("q") ?? "", sort: sort === "newest" || sort === "oldest" ? sort : "relevance", wide: p.get("in") === "transcript" } as const;
};

function SearchApp() {
  const [{ q, sort, wide: wideAsked }, setState] = useState(readUrl);
  // "Anywhere in a transcript" is offered, and in effect, only when it can change what the search finds.
  const choosable = whereMatters(parseQuery(q));
  const wide = wideAsked && choosable;
  const [status, setStatus] = useState<Status>("loading");
  const [which, setWhich] = useState<Person[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [facets, setFacets] = useState<PagefindSearch["filters"]>({});
  const [elapsed, setElapsed] = useState(0);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>(null);
  const [batchSize, setBatchSize] = useState(0);
  const [target, setTarget] = useState(0);
  const [shown, setShown] = useState(SHOW);
  const [more, setMore] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const queue = useRef<PagefindResult[]>([]);
  const plan = useRef<Plan | null>(null);
  const [printed, setPrinted] = useState<string[]>([]);
  const [asked, setAsked] = useState<SpeakerFilter | null>(null);
  const [twins, setTwins] = useState<Twins | null>(null);
  const runId = useRef(0);
  const sheet = useRef<HTMLDivElement>(null);

  const go = useCallback((next: { q?: string; sort?: string; wide?: boolean }) => {
    const params = new URLSearchParams();
    const nq = next.q ?? q;
    const ns = next.sort ?? sort;
    // A new search goes back to matching within one remark unless it asks to reach across the transcript.
    const nw = next.wide ?? (next.q === undefined ? wide : false);
    if (nq) params.set("q", nq);
    if (ns !== "relevance") params.set("sort", ns);
    if (nw) params.set("in", "transcript");
    history.pushState(null, "", `${location.pathname}?${params}`);
    setState(readUrl());
  }, [q, sort, wide]);

  // The phone filters sheet takes the focus when it opens, and Esc closes it.
  useEffect(() => {
    if (!filtersOpen) return;
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFiltersOpen(false); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  useEffect(() => {
    const onPop = () => setState(readUrl());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  /** Reads the next batch of pages, a few at a time, showing each page's remarks as soon as every page ranked above it
   * is in. Returns the number of remarks kept, or null when part of the index failed to load. */
  const loadMore = useCallback(async (id: number): Promise<number | null> => {
    const batch = queue.current.splice(0, PAGE);
    const p = plan.current!;
    setBatchSize(batch.length);
    setTarget((n) => n + batch.length);
    const done: (Row[] | undefined)[] = [];
    let next = 0;
    let cursor = 0;
    let kept = 0;
    let broken = false;
    const flush = () => {
      const ready: Row[] = [];
      while (next < batch.length && done[next]) ready.push(...done[next++]!);
      if (ready.length) setRows((prev) => {
        const seen = new Set(prev.map((r) => r.key));
        return [...prev, ...ready.filter((r) => !seen.has(r.key))];
      });
    };
    const reader = async () => {
      while (cursor < batch.length && !broken && id === runId.current) {
        const i = cursor++;
        let page: PageData;
        try { page = await readFragment(batch[i]); } catch { broken = true; return; }
        if (id !== runId.current) return;
        done[i] = rowsOf(page, p);
        kept += done[i]!.length;
        setLoaded((n) => n + 1);
        flush();
      }
    };
    await Promise.all(Array.from({ length: Math.min(READERS, batch.length) }, reader));
    if (broken) {
      if (id === runId.current) setStatus("failed");
      return null;
    }
    return kept;
  }, []);

  useEffect(() => {
    const id = ++runId.current;
    (async () => {
      setStatus("loading"); setRows([]); setLoaded(0); setTotal(0); setSuggestion(null); setWhich([]); setFiltersOpen(false); setPrinted([]);
      setPhase("searching"); setShown(SHOW); setTarget(0);
      if (!q.trim()) { setStatus("ready"); return; }
      const started = performance.now();
      const parsed = parseQuery(q);
      if (parsed.tooMany) { setStatus("toomany"); return; }
      let everyone: Person[] = [];
      try { everyone = await getJson<Person[]>("/data/people.json"); } catch { /* names fall back to transcript labels */ }
      if (id !== runId.current) return;
      setPeople(everyone);
      // Each speaker: (anyone with a card) or senator: (senators only) names one person; several mean any of them. A
      // speaker: the Senate's data doesn't know (a hearing witness, a guest) matches the name printed on their remarks.
      // Speakers a NOT leaves out are looked up the same way.
      const found = new Map<string, { slug?: string; label?: string }>();
      const keyOf = (s: SpeakerFilter) => `${s.senate}:${s.text.toLowerCase()}`;
      for (const asking of filterSets(parsed).flatMap((f) => f.speakers ?? [])) {
        if (found.has(keyOf(asking))) continue;
        const matches = resolveSpeaker(asking.text, asking.senate ? everyone.filter((p) => p.chamber === "senate") : everyone);
        const name = fold(asking.text.replace(/-/g, " ")).trim();
        if (!matches.length && !asking.senate && name) { found.set(keyOf(asking), { label: name }); continue; }
        if (!matches.length) { setAsked(asking); setStatus("nomatch"); return; }
        if (matches.length > 1) { setAsked(asking); setWhich(matches); setStatus("which"); return; }
        found.set(keyOf(asking), { slug: matches[0].slug });
      }
      const speakersOf = (list: SpeakerFilter[] | undefined): Speakers | null => {
        if (!list?.length) return null;
        const people = list.map((s) => found.get(keyOf(s))!);
        return { slugs: [...new Set(people.flatMap((p) => (p.slug ? [p.slug] : [])))], labels: [...new Set(people.flatMap((p) => (p.label ? [p.label] : [])))] };
      };
      const who: Who[] = parsed.branches.map((b) => ({ speakers: speakersOf(b.filters.speakers), not: b.not.map((e) => speakersOf(e.filters.speakers)) }));
      setPrinted([...new Set(who.flatMap((w) => w.speakers?.labels ?? []))]);
      let committeeNames: string[] = [];
      if (filterSets(parsed).some((f) => f.committees?.length)) {
        try {
          committeeNames = (await getJson<{ name: string }[]>("/data/committees.json")).map((c) => c.name);
          for (const f of filterSets(parsed)) {
            if (f.committees) f.committees = f.committees.map((typed) => committeeNamed(typed, committeeNames));
          }
        } catch { /* keep what was typed */ }
      }
      // A bill: also its same-as bills, each in the session they share (A10379 is S9051 in the Senate in 2025-26):
      // the Senate's record of an Assembly bill is often its own copy, and the same goes the other way.
      const billsAsked = [...new Set(filterSets(parsed).flatMap((f) => f.bills ?? []))];
      const of: Record<string, SameAs[]> = {};
      if (billsAsked.length) {
        const files = await Promise.all([...new Set(billsAsked.map(prefixOf))].map((prefix) =>
          getJson<Record<string, [number, string][]>>(`/data/same-as/${prefix}.json`).catch(() => ({}))));
        const pairs: Record<string, [number, string][]> = Object.assign({}, ...files);
        for (const bill of billsAsked) of[bill] = (pairs[bill] ?? []).map(([session, twin]) => ({ bill: twin, session }));
        for (const f of filterSets(parsed)) {
          const oneSession = f.session && f.bills?.length === 1 ? f.session : null;
          const sameAs = (f.bills ?? []).flatMap((b) => of[b]).filter((t) => !f.bills!.includes(t.bill) && (!oneSession || t.session === oneSession));
          if (sameAs.length) f.sameAs = sameAs;
        }
        if (id !== runId.current) return;
      }
      setTwins({ q, of });
      let pf: Pagefind;
      try { pf = await loadPagefind(); } catch { if (id === runId.current) setStatus("failed"); return; }
      // A search with only filters (say, one senator's remarks) has nothing to rank by, so it reads newest first.
      const termless = parsed.branches.every((b) => !b.words.length && !b.phrases.length && !b.near.length);
      const sortBy = sort === "relevance" ? (termless ? { date: "desc" } : undefined) : { date: sort === "newest" ? "desc" : "asc" };
      const units = parsed.branches.flatMap((b, k) => unitsOf(b, who[k]));
      let searches: PagefindSearch[];
      try {
        searches = await Promise.all(units.map((u) => searchBranch(pf, u.terms, { filters: u.filters, sort: sortBy })));
      } catch {
        if (id === runId.current) setStatus("failed");
        return;
      }
      if (id !== runId.current) return;
      if (indexFailed()) { setStatus("failed"); return; }
      setPhase("reading");
      // Several searches (an OR) are read in one order: by score, or by each transcript's date (a small file).
      let dates: Record<string, string> | null = null;
      if (units.length > 1 && sort !== "relevance") {
        try { dates = await getJson<Record<string, string>>("/data/search-dates.json"); } catch { /* each search's own order */ }
        if (id !== runId.current) return;
      }
      queue.current = inOrder(searches.map((s) => s.results), sort, dates);
      plan.current = { parsed, who, wide, found, committees: committeeNames };
      const matched = queue.current.length;
      setTotal(matched);
      // The counts beside the filters cover every branch's transcripts. A filter group in use is counted as if its own
      // choice weren't made, so ticking 2019 still lists 2020 and 2021 (with their counts) to add; the other groups'
      // choices still apply. Until those counts arrive, a group in use keeps the list it had, so nothing drops out or
      // moves under the pointer. All of this runs beside the reading below.
      const chosen = [...new Set(units.flatMap((u) => Object.keys(u.filters)))].filter((key) => key !== "none" && key !== "any");
      void facetCounts(pf, units, sortBy, matched, searches).then((counts) => {
        if (id !== runId.current) return;
        setFacets((previous) => {
          const next = { ...counts };
          for (const key of chosen) if (previous[key]) next[key] = previous[key];
          return next;
        });
      }).catch(() => { /* the counts stay as they were */ });
      if (chosen.length) {
        void Promise.all(chosen.map(async (key) => {
          const others = units.map((u) => {
            const { [key]: _mine, ...rest } = u.filters;
            return { ...u, filters: rest };
          });
          return [key, (await facetCounts(pf, others, sortBy, Infinity))[key]] as const;
        })).then((groups) => {
          if (id !== runId.current) return;
          setFacets((current) => ({ ...current, ...Object.fromEntries(groups.filter(([, counts]) => counts)) }));
        }).catch(() => { /* the narrowed counts stay */ });
      }
      let kept = 0;
      let batches = 0;
      // Fill the first screen even when the first pages hold no matching remark, but only for a few batches.
      while (queue.current.length && fillMore(kept, batches, queue.current.length) && id === runId.current) {
        const n = await loadMore(id);
        if (n == null) return;
        kept += n;
        batches += 1;
      }
      if (id !== runId.current) return;
      setElapsed(performance.now() - started);
      setPhase(null);
      setStatus("ready");
      // No single remark has every term, but whole transcripts do: offer those instead of a spelling guess.
      const terms = parsed.branches.some((b) => b.phrases.length + b.words.length + b.near.length > 1);
      if (!kept && !queue.current.length && !wide && terms && matched > 0) return;
      if (!kept && !queue.current.length) {
        const words = parsed.branches.flatMap((b) => b.words).filter((w) => /^[a-z]{4,}$/i.test(w));
        let changed = false;
        const fixed = await Promise.all(words.map(async (w) => {
          try {
            const counts = await getJson<Record<string, number>>(`/data/words/${w.slice(0, 2).toLowerCase()}.json`);
            const best = closestWord(w.toLowerCase(), counts);
            if (best) { changed = true; return [w, best] as const; }
          } catch { /* no list for this prefix */ }
          return [w, w] as const;
        }));
        if (changed && id === runId.current) {
          let next = q;
          for (const [from, to] of fixed) next = next.replace(new RegExp(`\\b${from}\\b`), to);
          setSuggestion(next);
        }
      }
    })();
  }, [q, sort, wide, loadMore]);

  const personBySlug = new Map(people.map((p) => [p.slug, p]));
  // Who speaker: or senator: asked for, by name, for the message when none of their own remarks has the words.
  const askedNames = [
    ...[...new Set((plan.current?.who ?? []).flatMap((w) => w.speakers?.slugs ?? []))].map((slug) => personBySlug.get(slug)).filter((p): p is Person => !!p)
      .map((p) => `${p.chamber === "assembly" ? "Asm." : "Sen."} ${p.name}`),
    ...printed.map((name) => titleCase(name)),
  ];
  // The query without the speakers it asks for (those it leaves out stay out), and without brackets left empty.
  const withoutSpeakers = (query: string) => query.replace(/(^|[\s(])(speaker|senator):("[^"]*"?|\([^)]*\)?|[^\s)]+)/gi, "$1")
    .replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")").trim();
  const remarkCount = rows.length;
  const transcriptCount = new Set(rows.map((r) => r.transcript)).size;
  // The phone's Filters button counts the filters in use, and the "anywhere in a transcript" choice it also holds.
  const activeFilters = Object.keys(parseQuery(q).filters).length + (wide ? 1 : 0);

  // What each shortcut outside brackets picks in a filter group: every year of a range, the person a name was looked
  // up as, a committee's full name. The boxes tick, and clicks change the query, by what the search means, not by how
  // it was typed (year:2019-2024 ticks 2019 to 2024; speaker:Krueger ticks Liz Krueger).
  const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
  const FIELDS_OF: Record<string, string[]> = { type: ["type"], year: ["year"], senator: ["speaker", "senator"], bill: ["bill"], committee: ["committee"] };
  const picks = (t: TopShortcut): string[] => {
    const p = plan.current;
    const value = /[\s"]/.test(t.value) && !t.value.startsWith("(") ? `"${t.value}"` : t.value;
    const f = parseQuery(`${t.field}:${value}`).filters;
    if (t.field === "year") return (f.years ?? []).map(String);
    if (t.field === "type") return f.types ?? [];
    if (t.field === "bill") return f.bills ?? [];
    if (t.field === "committee") return (f.committees ?? []).map((c) => committeeNamed(c, p?.committees ?? []));
    return (f.speakers ?? []).flatMap((s) => {
      const slug = p?.found.get(`${s.senate}:${s.text.toLowerCase()}`)?.slug;
      return slug ? [slug] : [];
    });
  };
  const shortcutsFor = (key: string) => topShortcuts(q).filter((t) => !t.negated && FIELDS_OF[key].includes(t.field));
  const chosenIn = (key: string) => new Set(shortcutsFor(key).flatMap(picks));
  // A click on a box that is ticked takes its value out of whatever shortcut holds it (2021 out of year:2019-2024 leaves
  // year:2019-2020 year:2022-2024); on one that isn't, it adds the shortcut.
  const toggleFacet = (key: string, value: string, shortcut: string) => {
    const holding = shortcutsFor(key).filter((t) => picks(t).includes(value)).sort((a, b) => b.start - a.start);
    if (!holding.length) { go({ q: `${q.trim()} ${shortcut}`.trim() }); return; }
    let next = q;
    for (const t of holding) {
      const rest = picks(t).filter((v) => v !== value);
      const written = t.field === "year" ? yearShortcuts(rest.map(Number)) : rest.map((v) => `${t.field}:${quote(v)}`).join(" ");
      next = next.slice(0, t.start) + written + next.slice(t.end);
    }
    go({ q: next.replace(/\s+/g, " ").trim() });
  };

  const nameOf = (r: Remark) => {
    const person = r.speaker ? personBySlug.get(r.speaker) : undefined;
    return person ? `${person.chamber === "assembly" ? "Asm." : "Sen."} ${person.name}` : r.label ? titleCase(r.label) : "Speaker not identified";
  };
  const citeOf = (row: Row) => {
    const person = row.remark.speaker ? personBySlug.get(row.remark.speaker) : undefined;
    const kind: SpeakerKind = person ? (person.chamber === "assembly" ? "assembly" : "senator")
      : row.remark.speaker === "president" ? "president" : row.remark.speaker === "secretary" ? "secretary" : "other";
    const title = row.meta.kind === "hearing" ? row.meta.title ?? null : null;
    // The pages cited are the ones the excerpt shows, not where the remark began.
    return legalCite({ kind: row.meta.kind === "hearing" ? "hearing" : "floor", date: row.meta.date, title, start: row.pages.start, end: row.pages.end,
      speaker: speakerForms(kind, row.remark.label, person?.name ?? (kind === "president" ? row.meta.president : null)) }).replace(/ \((remarks of )?\)$/, "");
  };
  const kindLabel = (meta: Record<string, string>) => meta.kind === "hearing"
    ? "Hearing"
    : `Floor · ${(meta.title ?? "Session").replace(/, [A-Z][a-z]+ \d+, \d{4}$/, "").replace(/ Session$/, "")}`;

  // One button reveals more of the remarks found, then reads more transcripts once every found remark is showing.
  const showMore = async () => {
    if (rows.length > shown) { setShown((n) => n + SHOW); return; }
    setMore(true);
    await loadMore(runId.current);
    setMore(false);
    setShown((n) => n + SHOW);
  };
  const reading = phase === "reading" && batchSize > 0
    ? `Searching ${total > batchSize ? `${batchSize.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}` : batchSize.toLocaleString("en-US")} possible ${total === 1 ? "transcript" : "transcripts"}…`
    : "Searching the record…";

  // Export: what the page has found so far, as a Word document or a spreadsheet.
  const exportItems = (): ResultItem[] => rows.map((r) => ({
    date: r.meta.date, record: kindLabel(r.meta), transcript: r.meta.title ?? kindLabel(r.meta), speaker: nameOf(r.remark),
    page: r.pages.hit, excerpt: excerptText(r.remark, r.branch), text: r.remark.text, cite: citeOf(r), link: new URL(r.href, location.href).href,
  }));
  const exportSummary = () => {
    const { main, sub } = resultCounts({ remarks: remarkCount, transcripts: transcriptCount, read: loaded, total });
    return `${main} ${sub}`.replace(/ so far /, " so far · ");
  };
  const exportChoices = [
    { label: "Word document", hint: ".docx", pick: () => download("search-results.docx", docx(resultsBlocks(q, exportSummary(), exportItems())), DOCX_TYPE) },
    { label: "Spreadsheet", hint: ".csv for Excel", pick: () => download("search-results.csv", resultsCsv(exportItems()), "text/csv") },
  ];

  // Most facets list the values with the most results first (top 10); years read in time order, newest first, with the
  // rest of them a click away.
  // Each group shows its top entries (10; 8 years), plus any already chosen, with "All N …" for the rest.
  const facetList = (title: string, key: string, render: (value: string) => string, shortcut: (value: string) => string,
    { keep = (_value: string): boolean => true, byYear = false, noun = "", only }: { keep?: (value: string) => boolean; byYear?: boolean; noun?: string; only?: [string, number][] } = {}) => {
    // Most results first, ties by name, so the order never shuffles between searches; years newest first.
    const all = (only ?? Object.entries(facets[key] ?? {})).filter(([value, n]) => n > 0 && keep(value))
      .sort(byYear ? (a, b) => Number(b[0]) - Number(a[0]) : (a, b) => b[1] - a[1] || render(a[0]).localeCompare(render(b[0])));
    if (!all.length) return null;
    const top = byYear ? 8 : 10;
    const open = !!opened[key];
    const chosen = chosenIn(key);
    const entries = open ? all : all.filter(([value], i) => i < top || chosen.has(value));
    return (
      <div className="fg">
        <h3>{title}</h3>
        {entries.map(([value, n]) => {
          const on = chosen.has(value);
          return (
            <button key={value} type="button" className="fg-row" aria-pressed={on} onClick={() => toggleFacet(key, value, shortcut(value))}>
              <span className={on ? "box on" : "box"} aria-hidden="true">{on && <Icon name="check" size={10} />}</span>
              <span className="fg-name">{render(value)}</span><b className="num">{n}</b>
            </button>
          );
        })}
        {all.length > top && noun && (
          <button type="button" className="fg-all" aria-expanded={open} onClick={() => setOpened((o) => ({ ...o, [key]: !o[key] }))}>
            {open ? "Fewer" : `All ${all.length.toLocaleString("en-US")} ${noun}`}
          </button>
        )}
      </div>
    );
  };
  // A speaker the whole search leaves out (-speaker:x) isn't offered as a filter: their transcripts are still counted,
  // but none of their remarks can show.
  const leftOut = (() => {
    const p = plan.current;
    if (!p) return new Set<string>();
    const per = p.parsed.branches.map((b, k) => new Set(b.not.flatMap((e, j) =>
      e.words.length + e.phrases.length + e.near.length === 0 && Object.keys(e.filters).length === 1 ? p.who[k].not[j]?.slugs ?? [] : [])));
    return new Set([...(per[0] ?? [])].filter((slug) => per.every((s) => s.has(slug))));
  })();
  // When the search names bills, the Bill filter lists just those, ticked: a list of every other bill, counted as if
  // none were chosen, read as a fault. Each counts the transcripts found for it or its same-as bills.
  const billsChosen = (() => {
    const picked = [...chosenIn("bill")];
    if (!picked.length) return undefined;
    const counts = facets.bill ?? {};
    return picked.map((v) => [v, Math.min(total, (counts[v] ?? 0) + (twins?.of[v] ?? []).reduce((n, t) => n + (counts[t.bill] ?? 0), 0))] as [string, number]);
  })();
  const facetPanel = (
    <>
      {facetList("Record", "type", (v) => (v === "floor" ? "Floor sessions" : "Public hearings"), (v) => `type:${v}`)}
      {facetList("Year", "year", (v) => v, (v) => `year:${v}`, { byYear: true, noun: "years" })}
      {facetList("Speaker", "senator", (v) => personBySlug.get(v)?.name ?? v, (v) => `speaker:${v}`, { keep: (v) => !leftOut.has(v), noun: "speakers" })}
      {facetList("Bill", "bill", (v) => v, (v) => `bill:${v}`, { keep: (v) => /^[SA]\d+$/.test(v), noun: "bills", only: billsChosen })}
      {facetList("Committee", "committee", (v) => v, (v) => `committee:${quote(v)}`, { noun: "committees" })}
    </>
  );

  return (
    <div className="sr">
      <div className="pg-head"><div className="pg-in pb"><SearchBox key={q} variant="search" initial={q} /></div></div>

      {status === "failed" && <p className="sr-msg" role="alert">{LOAD_FAILED}</p>}
      {status === "nomatch" && asked && <p className="sr-msg">No {asked.senate ? "senator" : "senator or Assembly member"} matches “{asked.text}”.</p>}
      {status === "toomany" && (
        <p className="sr-msg" role="alert">This search has too many combinations to run at once (more than {MAX_BRANCHES}). Take out an OR or two, or split it into separate searches.</p>
      )}
      {status === "which" && (
        <div className="sr-which">
          <h2>Which {asked?.text}?</h2>
          <div className="sr-which-list">
            {which.map((p) => (
              <button key={p.slug} type="button" onClick={() => go({ q: replaceSpeaker(q, asked!, p.slug) })}>
                {p.photo ? <img className="photo photo-sm" src={p.photo} alt="" width={28} height={36} /> : <span className="photo photo-sm empty" aria-hidden="true"><Icon name="person" size={24} /></span>}
                <span><b>{p.name}</b><small>{p.detail}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(status === "ready" || status === "loading") && q.trim() !== "" && (!parseQuery(q).filters.bills?.length || twins?.q === q) && (
        <>
          {printed.length > 0 && (
            <p className="sr-wide">Showing remarks by speakers named {printed.map((n) => `“${titleCase(n)}”`).join(" or ")} in the transcripts, such as hearing witnesses: no senator or Assembly member has that name.</p>
          )}
          {(() => {
            // A bill: search keeps to the bill's own remarks, and its same-as bills'; the note says which, that amended
            // prints count, and how to keep to one session (numbers start over each session).
            const { bills = [], session, years } = parseQuery(q).filters;
            if (!bills.length) return null;
            const sameAs = bills.flatMap((b) => twins?.of[b] ?? []).filter((t) => !bills.includes(t.bill) && (!session || bills.length > 1 || t.session === session));
            const typed = topShortcuts(q).find((t) => t.field === "bill" && !t.negated)?.value.split("/")[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
            const amended = typed && /^[SA]\d+[A-Z]$/.test(typed) && typed.startsWith(bills[0]) ? typed : `${bills[0]}A`;
            // The example session: the same-as bill's, else the year asked for, else this one (sessions start in odd years).
            const sessionOf = (year: number) => year - (year % 2 ? 0 : 1);
            const newest = sameAs.length ? Math.max(...sameAs.map((t) => t.session)) : sessionOf(years?.length ? Math.max(...years) : new Date().getFullYear());
            const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0];
            return (
              <p className="sr-wide">
                Remarks from the reading and debate of {bills.join(" or ")}
                {sameAs.length > 0 && <>{" "}and {sameAs.length > 1 ? "its same-as bills" : "its same-as"} {list(sameAs.map((t) => `${t.bill} (${sessionName(t.session)})`))}</>}
                , and remarks that mention {bills.length + sameAs.length > 1 ? "them" : "it"}. Amended versions like {amended} count too.
                {!session && bills.length === 1 && <> Bill numbers repeat each session: <b>bill:{bills[0]}/{newest}</b> keeps to {sessionName(newest)}.</>}
              </p>
            );
          })()}
          {wide && (
            <p className="sr-wide">Your words don't have to be in the same remark here. Each remark below has at least one of them, and its transcript has all of them. <button type="button" className="link" onClick={() => go({ wide: false })}>Only remarks with all of them</button></p>
          )}
          <div className="sr-head">
            {status === "loading" && !rows.length
              ? <p className="sr-status" role="status"><span className="sr-spin" aria-hidden="true" />{reading}</p>
              : (() => {
                const heading = resultCounts({ remarks: remarkCount, transcripts: transcriptCount, read: loaded, total });
                // The last word and the "i" stay together, so the "i" never wraps onto a line of its own.
                const cut = heading.sub.lastIndexOf(" ") + 1;
                return (
                  <h1 className="num">{heading.main} <span className="sr-sub">{heading.sub.slice(0, cut)}<span className="sr-last">{heading.sub.slice(cut)}
                    {loaded < total && <InfoTip label="What “possible transcripts” means">{POSSIBLE}</InfoTip>}
                  </span></span></h1>
                );
              })()}
            {status === "loading" && rows.length > 0 && (
              <span className="sr-time num" role="status"><span className="sr-spin" aria-hidden="true" />reading {loaded.toLocaleString("en-US")} of {target.toLocaleString("en-US")} transcripts…</span>
            )}
            {status === "ready" && <span className="sr-time num">{(elapsed / 1000).toFixed(2)} s</span>}
            <button type="button" className="btn btn-quiet sr-filters" onClick={() => setFiltersOpen(true)}><Icon name="filter" size={15} />Filters{activeFilters ? ` · ${activeFilters}` : ""}</button>
            {choosable && (
              <label className="sr-where">
                <span className="visually-hidden">Where your words must be</span>
                <select value={wide ? "transcript" : "remark"} onChange={(e) => go({ wide: e.target.value === "transcript" })}>
                  <option value="remark">In one remark</option>
                  <option value="transcript">Anywhere in a transcript</option>
                </select>
              </label>
            )}
            <label className="sr-sort">
              <span className="visually-hidden">Sort</span>
              <select value={sort} onChange={(e) => go({ sort: e.target.value })}>
                <option value="relevance">Most relevant</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
            <ExportButton label="Export results" className="sr-export" disabled={!rows.length} choices={exportChoices} />
          </div>
          <div className="sr-body">
            <aside className="sr-facets" aria-label="Narrow the results">{facetPanel}</aside>
            <section className="sr-list" aria-live="polite">
              {status === "loading" && !rows.length && SKELETON}
              {rows.slice(0, shown).map((row) => (
                <article key={row.key} className="rrow" data-result>
                  <div className="c-date"><b>{shortDate(row.meta.date)}</b><span>{kindLabel(row.meta)}</span></div>
                  <div>
                    <div className="who">
                      <b data-speaker={row.remark.speaker ?? ""}>{nameOf(row.remark)}</b>
                      {row.meta.kind === "hearing" && row.meta.title && <span className="ob hearing-t">{row.meta.title}</span>}
                    </div>
                    <p className="q" dangerouslySetInnerHTML={{ __html: excerpt(row.remark, row.branch) }} />
                  </div>
                  <div className="c-cite">
                    {row.pages.hit != null && <span className="pg">p. {row.pages.hit}</span>}
                    <button type="button" className="copy" data-copy={citeOf(row)}><Icon name="copy" size={14} /><span>Copy cite</span></button>
                    <a className="ctx" href={row.href}>Read in context</a>
                  </div>
                </article>
              ))}
              {status === "ready" && !rows.length && queue.current.length > 0 && (
                <div className="sr-none"><p>No matching remarks in the first {loaded.toLocaleString("en-US")} transcripts.</p></div>
              )}
              {status === "ready" && !rows.length && !queue.current.length && total > 0 && askedNames.length > 0
                && parseQuery(q).branches.some((b) => b.phrases.length + b.words.length + b.near.length > 0) ? (
                <div className="sr-none">
                  <p>These words come up in {total.toLocaleString("en-US")} {total === 1 ? "transcript" : "transcripts"} where {askedNames.join(" or ")} spoke, but not in {askedNames.length === 1 ? `${askedNames[0]}'s` : "their"} own remarks.</p>
                  <p><button type="button" className="btn" onClick={() => go({ q: withoutSpeakers(q) })}>Show these words from anyone</button></p>
                </div>
              ) : status === "ready" && !rows.length && !queue.current.length && !wide && total > 0
                // A NEAR pair counts once: its words may share a remark and only be too far apart.
                && parseQuery(q).branches.some((b) => b.phrases.length + b.words.length + b.near.length > 1) ? (
                <div className="sr-none">
                  <p>No single remark has all of these. {total.toLocaleString("en-US")} {total === 1 ? "transcript has" : "transcripts have"} them in different remarks.</p>
                  <p><button type="button" className="btn" onClick={() => go({ wide: true })}>Search anywhere in these transcripts</button></p>
                </div>
              ) : status === "ready" && !rows.length && !queue.current.length && (
                <div className="sr-none">
                  <p>No remarks match.</p>
                  {suggestion && <p><a className="link" href={`${location.pathname}?q=${encodeURIComponent(suggestion)}`}>Did you mean: {suggestion}?</a></p>}
                </div>
              )}
              {status === "ready" && (rows.length > shown || queue.current.length > 0) && (rows.length > 0 || queue.current.length > 0) && (
                <button type="button" className="btn sr-more" onClick={showMore} disabled={more}>
                  {more ? <><span className="sr-spin" aria-hidden="true" />Reading more transcripts…</> : rows.length > shown || rows.length > 0 ? "Show more remarks" : "Read more transcripts"}
                </button>
              )}
            </section>
          </div>
        </>
      )}

      {filtersOpen && (
        <>
          <div className="sheet-dim" onClick={() => setFiltersOpen(false)} />
          <div ref={sheet} className="sheet" role="dialog" aria-label="Filters" tabIndex={-1}>
            <div className="sheet-grab" />
            {/* On a phone the choice beside Sort lives here, so the bar above the results keeps to one line. */}
            {choosable && (
              <div className="fg sr-where-g">
                <h3 id="where-h">Where your words are</h3>
                <div className="seg sbx-scope" role="group" aria-labelledby="where-h">
                  <button type="button" aria-pressed={!wide} onClick={() => go({ wide: false })}>In one remark</button>
                  <button type="button" aria-pressed={wide} onClick={() => go({ wide: true })}>Anywhere in a transcript</button>
                </div>
              </div>
            )}
            {facetPanel}
          </div>
        </>
      )}
    </div>
  );
}

export default clientOnly(SearchApp);
