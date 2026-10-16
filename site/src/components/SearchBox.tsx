// The search box: record filter, field, example searches and the Search tips panel (spec 9.1, "Homepage" mocks).
// No motion anywhere: nothing animates, flips or slides.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { url } from "../lib/url";
import { Icon } from "./ui";

type Scope = "all" | "floor" | "hearing";

const SCOPES: [Scope, string][] = [["all", "All records"], ["floor", "Floor sessions"], ["hearing", "Public hearings"]];

const TRY: [string, string][] = [
  ['"congestion pricing"', "Finds this exact phrase"],
  ["tolls OR fares", "Finds remarks with either word"],
  ["budget speaker:Krueger", "Finds what Senator Krueger said about the budget"],
];

const WORDS: [string, ReactNode][] = [
  ["tolls fares", "both words"],
  ['"toll revenue"', "this exact phrase"],
  ['"tolls" "fares"', "both phrases, one remark"],
  ["tolls OR fares", "either word"],
  ["tolls NOT bridge", <>leave out bridge (or <b>-bridge</b>)</>],
  ["tolls NEAR fares", "within a few words"],
];

const NARROW: [string, ReactNode][] = [
  ["speaker:Krueger", "one senator's remarks"],
  ["bill:A10000", "transcripts that mention it"],
  ["year:2019", "one year"],
  ["year:2015-2019", "a range of years"],
  ["type:hearing", <>hearings only (or <b>floor</b>)</>],
  ["committee:Health", "one committee's hearings"],
];

const MIX = "rent speaker:Krueger year:2015-2019";
const LONG_PLACEHOLDER = "Search for a senator, a bill, or what was said";
const SHORT_PLACEHOLDER = "Search a senator, bill or words";

export default function SearchBox({ variant = "home", initial = "" }: { variant?: "home" | "search"; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [scope, setScope] = useState<Scope>("all");
  const [tipsOpen, setTipsOpen] = useState(false);
  const [placeholder, setPlaceholder] = useState(LONG_PLACEHOLDER);
  const input = useRef<HTMLInputElement>(null);
  const tipsButton = useRef<HTMLButtonElement>(null);
  const tipsPanel = useRef<HTMLDivElement>(null);
  const tipsId = useId();

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 719.98px)");
    const update = () => setPlaceholder(narrow.matches ? SHORT_PLACEHOLDER : LONG_PLACEHOLDER);
    update();
    narrow.addEventListener("change", update);
    return () => narrow.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!tipsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setTipsOpen(false); tipsButton.current?.focus(); }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!tipsPanel.current?.contains(target) && !tipsButton.current?.contains(target)) setTipsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [tipsOpen]);

  function fill(example: string) {
    setValue(example);
    setTipsOpen(false);
    input.current?.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    let q = value.trim();
    if (scope !== "all" && !/(^|\s)type:/i.test(q)) q = `${q} type:${scope}`.trim();
    if (!q) { input.current?.focus(); return; }
    window.location.href = `${url("/search/")}?q=${encodeURIComponent(q)}`;
  }

  const example = (text: string) => (
    <button type="button" className="chip" onClick={() => fill(text)}>{text}</button>
  );

  return (
    <form className={`sbx sbx-${variant}`} role="search" onSubmit={submit}>
      {variant === "home" && (
        <div className="seg sbx-scope" role="group" aria-label="Records to search">
          {SCOPES.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={scope === key} onClick={() => setScope(key)}>{label}</button>
          ))}
        </div>
      )}
      <div className="sbx-row">
        <label className="sbx-field">
          <Icon name="search" size={20} />
          <span className="visually-hidden">Search the record</span>
          <input ref={input} type="search" name="q" value={value} placeholder={placeholder} autoComplete="off" spellCheck={false}
            onChange={(e) => setValue(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary sbx-go" aria-label="Search">
          <span className="sbx-go-text">Search</span><Icon name="arrow" size={18} className="sbx-go-icon" />
        </button>
      </div>
      <div className="sbx-under">
        {variant === "home" && (
          <div className="sbx-try"><span>Try</span>{TRY.map(([text, title]) => (
            <button key={text} type="button" className="chip" title={title} onClick={() => fill(text)}>{text}</button>
          ))}</div>
        )}
        <button ref={tipsButton} type="button" className="sbx-tips" aria-expanded={tipsOpen} aria-controls={tipsId}
          onClick={() => setTipsOpen((open) => !open)}>Search tips</button>
        <div ref={tipsPanel} id={tipsId} className="sbx-tipbox" role="dialog" aria-label="Search tips" hidden={!tipsOpen}>
          <div className="sbx-cols">
            <div><h3>Words</h3><dl>{WORDS.map(([text, what]) => <div key={text}><dt>{example(text)}</dt><dd>{what}</dd></div>)}</dl></div>
            <div><h3>Narrow it down</h3><dl>{NARROW.map(([text, what]) => <div key={text}><dt>{example(text)}</dt><dd>{what}</dd></div>)}</dl></div>
          </div>
          <p>Mix them freely: {example(MIX)}</p>
        </div>
      </div>
    </form>
  );
}
