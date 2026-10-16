// The search page (spec 9.1), as in "Search results" and the phone results: Pagefind finds transcripts, the query
// layer keeps the remarks that really match, one row per remark.
import { useCallback, useEffect, useRef, useState } from "react";
import { download, markdownEscape } from "../lib/download";
import { jsonCache } from "../lib/fetch";
import { legalCite, shortDate, speakerForms, titleCase, type SpeakerKind } from "../lib/format";
import { fold, resolveSpeaker, type Person } from "../lib/names";
import {
  excerpt, excerptPages, fillMore, hasShortcut, keepRemark, pagefindFilters, parseQuery, remarksOf, spokenText, toggleShortcut,
  type Branch, type ParsedQuery, type Remark,
} from "../lib/query";
import { closestWord } from "../lib/spelling";
import { url } from "../lib/url";
import { indexFailed, loadPagefind, readFragment, searchBranch, type PageData, type Pagefind, type PagefindResult, type PagefindSearch } from "./pagefind";
import SearchBox from "./SearchBox";
import { clientOnly, Icon } from "./ui";

const PAGE = 20;      // transcripts read per batch
const READERS = 6;    // fragments read at once
const SHOW = 25;      // remarks shown at a time
const LOAD_FAILED = "Search couldn't load. Check your connection and try again.";
const getJson = jsonCache(url);

type Pages = ReturnType<typeof excerptPages>;
interface Row { key: string; remark: Remark; branch: Branch; pages: Pages; meta: Record<string, string>; transcript: string; }
type Status = "loading" | "failed" | "which" | "nomatch" | "ready";
type Phase = "searching" | "reading" | null;

/** The rows a page contributes: its remarks that match a branch, in reading order. */
function rowsOf(page: PageData, plan: { parsed: ParsedQuery; speaker: string | null }): Row[] {
  const transcript = page.url.replace(/\/$/, "").split("/").pop() ?? page.url;
  const rows: Row[] = [];
  for (const remark of remarksOf(page).map(spokenText)) {
    const branch = plan.parsed.branches.find((b) => keepRemark(remark, b, plan.parsed.not, plan.speaker));
    if (branch) rows.push({ key: remark.url, remark, branch, pages: excerptPages(remark, branch), meta: page.meta, transcript });
  }
  return rows;
}

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
  return { q: p.get("q") ?? "", sort: sort === "newest" || sort === "oldest" ? sort : "relevance" } as const;
};

function SearchApp() {
  const [{ q, sort }, setState] = useState(readUrl);
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
  const queue = useRef<PagefindResult[]>([]);
  const plan = useRef<{ parsed: ParsedQuery; speaker: string | null } | null>(null);
  const runId = useRef(0);
  const sheet = useRef<HTMLDivElement>(null);

  const go = useCallback((next: { q?: string; sort?: string }) => {
    const params = new URLSearchParams();
    const nq = next.q ?? q;
    const ns = next.sort ?? sort;
    if (nq) params.set("q", nq);
    if (ns !== "relevance") params.set("sort", ns);
    history.pushState(null, "", `${location.pathname}?${params}`);
    setState(readUrl());
  }, [q, sort]);

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
      setStatus("loading"); setRows([]); setLoaded(0); setTotal(0); setSuggestion(null); setWhich([]); setFiltersOpen(false);
      setPhase("searching"); setShown(SHOW); setTarget(0);
      if (!q.trim()) { setStatus("ready"); return; }
      const started = performance.now();
      const parsed = parseQuery(q);
      let everyone: Person[] = [];
      try { everyone = await getJson<Person[]>("/data/people.json"); } catch { /* names fall back to transcript labels */ }
      if (id !== runId.current) return;
      setPeople(everyone);
      let speaker: string | null = null;
      if (parsed.filters.speaker) {
        const matches = resolveSpeaker(parsed.filters.speaker, everyone);
        if (!matches.length) { setStatus("nomatch"); return; }
        if (matches.length > 1) { setWhich(matches); setStatus("which"); return; }
        speaker = matches[0].slug;
      }
      if (parsed.filters.committee) {
        try {
          const committees = await getJson<{ name: string }[]>("/data/committees.json");
          const typed = fold(parsed.filters.committee);
          parsed.filters.committee = committees.find((c) => fold(c.name) === typed)?.name ?? parsed.filters.committee;
        } catch { /* keep what was typed */ }
      }
      let pf: Pagefind;
      try { pf = await loadPagefind(); } catch { if (id === runId.current) setStatus("failed"); return; }
      const filters = pagefindFilters(parsed.filters, speaker);
      const sortBy = sort === "relevance" ? undefined : { date: sort === "newest" ? "desc" : "asc" };
      let searches: PagefindSearch[];
      try {
        searches = await Promise.all(parsed.branches.map((b) => searchBranch(pf, b, { filters, sort: sortBy })));
      } catch {
        if (id === runId.current) setStatus("failed");
        return;
      }
      if (id !== runId.current) return;
      if (indexFailed()) { setStatus("failed"); return; }
      setPhase("reading");
      const seen = new Set<string>();
      queue.current = searches.flatMap((s) => s.results).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      plan.current = { parsed, speaker };
      setTotal(queue.current.length);
      setFacets(searches[0]?.filters ?? {});
      let kept = 0;
      let batches = 0;
      // Fill the first screen even when the first pages hold no matching remark, but only for a few batches.
      while (queue.current.length && fillMore(kept, batches) && id === runId.current) {
        const n = await loadMore(id);
        if (n == null) return;
        kept += n;
        batches += 1;
      }
      if (id !== runId.current) return;
      setElapsed(performance.now() - started);
      setPhase(null);
      setStatus("ready");
      if (!kept && !queue.current.length) {
        const words = parsed.branches.flatMap((b) => b.words).filter((w) => /^[a-z]{3,}$/i.test(w));
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
  }, [q, sort, loadMore]);

  const personBySlug = new Map(people.map((p) => [p.slug, p]));
  const remarkCount = rows.length;
  const transcriptCount = new Set(rows.map((r) => r.transcript)).size;
  const activeFilters = Object.keys(parseQuery(q).filters).length;
  const toggle = (shortcut: string) => go({ q: toggleShortcut(q, shortcut) });

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
      speaker: speakerForms(kind, row.remark.label, person?.name) }).replace(/ \((remarks of )?\)$/, "");
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
    ? `${total > batchSize ? `Reading the first ${batchSize.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}` : `Reading ${batchSize.toLocaleString("en-US")}`} matching ${total === 1 ? "transcript" : "transcripts"} for remarks…`
    : "Searching the record…";

  const exportResults = () => {
    const lines = [`# Search: ${markdownEscape(q)}`, "", `${remarkCount} remarks in ${transcriptCount} transcripts`, ""];
    for (const r of rows) {
      lines.push(`## ${r.meta.date} · ${nameOf(r.remark)}${r.pages.hit != null ? ` · p. ${r.pages.hit}` : ""}`, "", markdownEscape(r.remark.text), "", new URL(r.remark.url, location.href).href, "");
    }
    download("search-results.md", lines.join("\n"), "text/markdown");
  };

  const facetList = (title: string, key: string, render: (value: string) => string, shortcut: (value: string) => string, keep = (_value: string) => true) => {
    const entries = Object.entries(facets[key] ?? {}).filter(([value, n]) => n > 0 && keep(value)).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!entries.length) return null;
    return (
      <div className="fg">
        <h3>{title}</h3>
        {entries.map(([value, n]) => {
          const on = hasShortcut(q, shortcut(value));
          return (
            <button key={value} type="button" className="fg-row" aria-pressed={on} onClick={() => toggle(shortcut(value))}>
              <span className={on ? "box on" : "box"} aria-hidden="true">{on && <Icon name="check" size={10} />}</span>
              <span className="fg-name">{render(value)}</span><b className="num">{n}</b>
            </button>
          );
        })}
      </div>
    );
  };
  const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
  const facetPanel = (
    <>
      {facetList("Record", "type", (v) => (v === "floor" ? "Floor sessions" : "Public hearings"), (v) => `type:${v}`)}
      {facetList("Year", "year", (v) => v, (v) => `year:${v}`)}
      {facetList("Speaker", "senator", (v) => personBySlug.get(v)?.name ?? v, (v) => `speaker:${v}`)}
      {facetList("Bill", "bill", (v) => v, (v) => `bill:${v}`, (v) => /^[SA]\d+$/.test(v))}
      {facetList("Committee", "committee", (v) => v, (v) => `committee:${quote(v)}`)}
    </>
  );

  return (
    <div className="sr">
      <div className="pg-head"><div className="pg-in pb"><SearchBox key={q} variant="search" initial={q} /></div></div>

      {status === "failed" && <p className="sr-msg" role="alert">{LOAD_FAILED}</p>}
      {status === "nomatch" && <p className="sr-msg">No senator or Assembly member matches “{parseQuery(q).filters.speaker}”.</p>}
      {status === "which" && (
        <div className="sr-which">
          <h2>Which {parseQuery(q).filters.speaker}?</h2>
          <div className="sr-which-list">
            {which.map((p) => (
              <button key={p.slug} type="button" onClick={() => go({ q: q.replace(/speaker:("[^"]*"|\S+)/i, `speaker:${p.slug}`) })}>
                {p.photo ? <img className="photo photo-sm" src={p.photo} alt="" width={28} height={36} /> : <span className="photo photo-sm empty" aria-hidden="true"><Icon name="person" size={24} /></span>}
                <span><b>{p.name}</b><small>{p.detail}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(status === "ready" || status === "loading") && q.trim() !== "" && (
        <>
          <div className="sr-head">
            {status === "loading" && !rows.length
              ? <p className="sr-status" role="status"><span className="sr-spin" aria-hidden="true" />{reading}</p>
              : <h1 className="num">{remarkCount.toLocaleString("en-US")} {remarkCount === 1 ? "remark" : "remarks"} <span>in {transcriptCount.toLocaleString("en-US")} {transcriptCount === 1 ? "transcript" : "transcripts"}</span></h1>}
            {status === "loading" && rows.length > 0 && (
              <span className="sr-time num" role="status"><span className="sr-spin" aria-hidden="true" />reading {loaded.toLocaleString("en-US")} of {target.toLocaleString("en-US")} transcripts…</span>
            )}
            {status === "ready" && <span className="sr-time num">{total > loaded ? `first ${loaded} of ${total} matching transcripts · ` : ""}{(elapsed / 1000).toFixed(2)} s</span>}
            <button type="button" className="btn btn-quiet sr-filters" onClick={() => setFiltersOpen(true)}><Icon name="filter" size={15} />Filters{activeFilters ? ` · ${activeFilters}` : ""}</button>
            <label className="sr-sort">
              <span className="visually-hidden">Sort</span>
              <select value={sort} onChange={(e) => go({ sort: e.target.value })}>
                <option value="relevance">Most relevant</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
            <button type="button" className="btn sr-export" onClick={exportResults} disabled={!rows.length}><Icon name="dl" size={15} />Export results</button>
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
                    <a className="ctx" href={row.remark.url}>Read in context</a>
                  </div>
                </article>
              ))}
              {status === "ready" && !rows.length && queue.current.length > 0 && (
                <div className="sr-none"><p>No matching remarks in the first {loaded.toLocaleString("en-US")} transcripts.</p></div>
              )}
              {status === "ready" && !rows.length && !queue.current.length && (
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
            {facetPanel}
          </div>
        </>
      )}
    </div>
  );
}

export default clientOnly(SearchApp);
