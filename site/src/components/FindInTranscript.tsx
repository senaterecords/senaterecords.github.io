// Find in transcript (in the reader's toolbar; a button that opens a bar on phones): every match of a word or phrase
// highlighted and counted, stepped through with Enter, Shift+Enter or the arrows; Esc clears, and "/" jumps here.
// Capitals and accents don't matter, page numbers are skipped, and turns hidden by "Show only" are left out. The
// browser's own highlighting draws the matches, so the transcript's text is never rewritten.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { findAll, foldForFind, locate } from "../lib/find";
import { Icon } from "./ui";

const LIMIT = 2000;

interface Index { nodes: Text[]; starts: number[]; text: string; }

/** The transcript's words as one folded text, with where each piece of the page starts in it. */
function buildIndex(): Index {
  const root = document.getElementById("transcript");
  const nodes: Text[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  let length = 0;
  let lastBlock: Element | null = null;
  if (root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest(".pb b, .g") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      // The page has no space between paragraphs or after a speaker's name, so one is counted here.
      const block = n.parentElement?.closest("p, h3") ?? null;
      if (lastBlock && block !== lastBlock) { parts.push(" "); length += 1; }
      lastBlock = block;
      nodes.push(n);
      starts.push(length);
      parts.push(n.data);
      length += n.data.length;
    }
  }
  return { nodes, starts, text: foldForFind(parts.join("")) };
}

function rangeAt(ix: Index, start: number, end: number): Range {
  const a = locate(ix.starts, start);
  const b = locate(ix.starts, end);
  const range = new Range();
  range.setStart(ix.nodes[a.piece], Math.min(a.offset, ix.nodes[a.piece].length));
  range.setEnd(ix.nodes[b.piece], Math.min(b.offset, ix.nodes[b.piece].length));
  return range;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export default function FindInTranscript() {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [capped, setCapped] = useState(false);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false); // phones: the find bar is showing
  const index = useRef<Index | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const drawn = typeof CSS !== "undefined" && "highlights" in CSS;

  // Search a moment after the reader stops typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      const phrase = foldForFind(query.trim().replace(/\s+/g, " "));
      if (!phrase) { setRanges([]); setCapped(false); return; }
      index.current ??= buildIndex();
      const ix = index.current;
      const hits = findAll(ix.text, phrase, LIMIT);
      const visible = hits.map((m) => rangeAt(ix, m, m + phrase.length))
        .filter((r) => r.startContainer.parentElement?.checkVisibility?.({ contentVisibilityAuto: false }) ?? true);
      setRanges(visible);
      setCapped(hits.length >= LIMIT);
      setAt(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  // All matches lightly marked, the current one strongly, and brought to the middle of the window.
  useEffect(() => {
    if (!drawn) return;
    if (!ranges.length) { CSS.highlights.delete("find"); CSS.highlights.delete("find-active"); return; }
    CSS.highlights.set("find", new Highlight(...ranges));
  }, [ranges, drawn]);
  useEffect(() => {
    const current = ranges[at];
    if (!current) return;
    if (drawn) CSS.highlights.set("find-active", new Highlight(current));
    current.startContainer.parentElement?.scrollIntoView({ block: "center" });
    requestAnimationFrame(() => {
      const box = current.getBoundingClientRect();
      if (box.height && (box.top < 80 || box.bottom > innerHeight - 80)) scrollBy(0, box.top - innerHeight / 2);
    });
  }, [ranges, at, drawn]);

  const step = useCallback((by: number) => setAt((i) => (ranges.length ? (i + by + ranges.length) % ranges.length : 0)), [ranges.length]);
  const close = () => { setQuery(""); setRanges([]); setOpen(false); field.current?.blur(); };

  // "/" jumps to the find box, as it does to search elsewhere on the site.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => field.current?.focus());
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };
  const count = ranges.length
    ? `${at + 1} of ${capped ? `${LIMIT.toLocaleString("en-US")}+` : ranges.length.toLocaleString("en-US")}`
    : query.trim() ? "No matches" : "";

  return (
    <div className={`fd${open ? " open" : ""}`}>
      <button type="button" className="fd-open" aria-label="Find in transcript" aria-expanded={open}
        onClick={() => { setOpen(true); requestAnimationFrame(() => field.current?.focus()); }}>
        <Icon name="search" size={19} />
      </button>
      <div className="fd-bar" role="search">
        <Icon name="search" size={15} className="fd-icon" />
        <input ref={field} type="search" aria-label="Find in transcript" placeholder="Find in transcript" autoComplete="off" spellCheck={false}
          value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
        <span className="fd-count num" aria-live="polite">{count}</span>
        <button type="button" className="fd-step" aria-label="Previous match" disabled={!ranges.length} onClick={() => step(-1)}><Icon name="chevl" size={15} /></button>
        <button type="button" className="fd-step" aria-label="Next match" disabled={!ranges.length} onClick={() => step(1)}><Icon name="chev" size={15} /></button>
        <button type="button" className="fd-close" aria-label="Close find" onClick={close}><Icon name="close" size={17} /></button>
      </div>
    </div>
  );
}
