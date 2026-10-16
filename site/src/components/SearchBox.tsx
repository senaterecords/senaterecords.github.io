// The search box: record filter, field, example searches and the Search tips panel (spec 9.1, "Homepage" mocks).
// No motion anywhere: nothing animates, flips or slides.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { replaceToken } from "../lib/suggest";
import { url } from "../lib/url";
import { useSuggestions, type Suggestion } from "./suggestions";
import { Icon, replayEarlyClicks } from "./ui";

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
  ['"school aid" "tax cap"', "both exact phrases"],
  ["tolls OR fares", "either word"],
  ["tolls NOT bridge", <>leave out bridge (or <b>-bridge</b>)</>],
  ["tolls NEAR fares", "within 10 words"],
  ["tolls NEAR/3 fares", "within 3 words"],
];

const NARROW: [string, ReactNode][] = [
  ["speaker:Krueger", "one speaker's remarks"],
  ["senator:Krueger", "senators only"],
  ["bill:A10000", "transcripts that mention it"],
  ["year:2015-2019", "a year or a range"],
  ["type:hearing", <>hearings only (or <b>floor</b>)</>],
  ["committee:Health", "one committee's hearings"],
];

const MIX = "rent speaker:Krueger year:2015-2019";
const EITHER = "speaker:Krueger speaker:Lanza";
const LONG_PLACEHOLDER = "Search for a senator, a bill, or what was said";
const SHORT_PLACEHOLDER = "Search a senator, bill or words";

export default function SearchBox({ variant = "home", initial = "" }: { variant?: "home" | "search" | "bar"; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [scope, setScope] = useState<Scope>("all");
  const [tipsOpen, setTipsOpen] = useState(false);
  const [placeholder, setPlaceholder] = useState(LONG_PLACEHOLDER);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const tipsButton = useRef<HTMLButtonElement>(null);
  const tipsPanel = useRef<HTMLDivElement>(null);
  const tipsId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [acOpen, setAcOpen] = useState(false);
  // Nothing is chosen until an arrow key or the pointer picks a row, so Enter searches what was typed.
  const [active, setActive] = useState(-1);
  const listId = useId();
  const { token, groups } = useSuggestions(value, caret, acOpen);
  const items = groups.flatMap((g) => g.items);
  const showList = acOpen && items.length > 0;

  useEffect(() => setActive(-1), [token?.start, token?.field, token?.text]);

  // The list fits in the window below the box (what doesn't fit scrolls inside it), so it never stretches the page.
  useLayoutEffect(() => {
    const box = list.current;
    if (!showList || !box) return;
    const fit = () => {
      const room = innerHeight - box.getBoundingClientRect().top - 12;
      box.style.maxHeight = `${Math.floor(Math.max(160, Math.min(room, innerHeight * 0.7)))}px`;
    };
    fit();
    addEventListener("resize", fit);
    addEventListener("scroll", fit, { passive: true });
    return () => { removeEventListener("resize", fit); removeEventListener("scroll", fit); };
  }, [showList]);

  const pick = (s: Suggestion) => {
    if (!token) return;
    const next = replaceToken(value, token, s.value, s.trailingSpace);
    setValue(next.value);
    setCaret(next.caret);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[Math.min(active, items.length - 1)]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAcOpen(false); }
  };
  const track = () => setCaret(input.current?.selectionStart ?? null);

  useEffect(() => {
    // Text typed before this island started is kept, with its suggestions if the field still has focus.
    const el = input.current;
    const typed = el?.value || window.__otrEarlyTyped?.get(el!) || "";
    if (el && typed && typed !== initial) {
      setValue(typed);
      setCaret(typed.length);
      if (document.activeElement === el) setAcOpen(true);
    }
    replayEarlyClicks(form.current);
  }, []);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 719.98px)");
    const update = () => setPlaceholder(narrow.matches ? SHORT_PLACEHOLDER : LONG_PLACEHOLDER);
    update();
    narrow.addEventListener("change", update);
    return () => narrow.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!tipsOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
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
    // What's in the field: right after this script starts, state may not yet hold what was typed before it did.
    let q = (value || input.current?.value || "").trim();
    if (scope !== "all" && !/(^|\s)type:/i.test(q)) q = `${q} type:${scope}`.trim();
    if (!q) { input.current?.focus(); return; }
    window.location.href = `${url("/search/")}?q=${encodeURIComponent(q)}`;
  }

  const example = (text: string) => (
    <button type="button" className="chip" onClick={() => fill(text)}>{text}</button>
  );

  const field = {
    ref: input, type: "search", name: "q", value, autoComplete: "off", spellCheck: false,
    "aria-autocomplete": "list" as const, "aria-controls": showList ? listId : undefined,
    "aria-activedescendant": showList && active >= 0 ? `${listId}-${active}` : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement>) => { setValue(e.target.value); setCaret(e.target.selectionStart); setAcOpen(true); },
    onKeyDown, onKeyUp: track, onClick: track, onBlur: () => setAcOpen(false), onFocus: () => setAcOpen(true),
  };

  const suggestionList = showList && (
    <div ref={list} className="acbox" id={listId} role="listbox" aria-label="Suggestions">
      {(() => {
        let n = -1;
        return groups.map((g, gi) => (
          <div key={gi} role="group" aria-label={g.heading}>
            {g.heading && <h4 aria-hidden="true">{g.heading}</h4>}
            {g.items.map((s) => {
              n += 1;
              const index = n;
              return (
                <div key={s.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
                  className={`ac-row${index === active ? " on" : ""}`}
                  onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(s)}>
                  {s.person && (s.photo
                    ? <img className="photo photo-sm" src={s.photo} alt="" width={28} height={36} />
                    : <span className="photo photo-sm empty" aria-hidden="true"><Icon name="person" size={24} /></span>)}
                  <span className="ac-main"><span className="ac-nm">{s.label}</span>{s.detail && <span className="ac-mt">{s.detail}</span>}</span>
                  {s.count && <span className="ac-cnt num">{s.count}</span>}
                </div>
              );
            })}
          </div>
        ));
      })()}
      <div className="ac-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd>choose</span><span><kbd>Enter</kbd>select</span><span><kbd>Esc</kbd>close</span></div>
    </div>
  );

  // The header's box on every other page: the same suggestions, in the bar's compact look; Enter searches.
  if (variant === "bar") return (
    <form ref={form} className="bar-search sbx-bar" role="search" action={url("/search/")} method="get" onSubmit={submit}>
      <Icon name="search" size={17} />
      <input {...field} placeholder="Search transcripts" aria-label="Search transcripts" />
      <kbd aria-hidden="true">/</kbd>
      {suggestionList}
    </form>
  );

  return (
    <form ref={form} className={`sbx sbx-${variant}`} role="search" action={url("/search/")} method="get" onSubmit={submit}>
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
          <input {...field} placeholder={placeholder} />
        </label>
        <button type="submit" className="btn-primary sbx-go" aria-label="Search">
          <span className="sbx-go-text">Search</span><Icon name="arrow" size={18} className="sbx-go-icon" />
        </button>
        {showList && (
          <div ref={list} className="acbox" id={listId} role="listbox" aria-label="Suggestions">
            {(() => {
              let n = -1;
              return groups.map((g, gi) => (
                <div key={gi} role="group" aria-label={g.heading}>
                  {g.heading && <h4 aria-hidden="true">{g.heading}</h4>}
                  {g.items.map((s) => {
                    n += 1;
                    const index = n;
                    return (
                      <div key={s.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
                        className={`ac-row${index === active ? " on" : ""}`}
                        onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(s)}>
                        {s.person && (s.photo
                          ? <img className="photo photo-sm" src={s.photo} alt="" width={28} height={36} />
                          : <span className="photo photo-sm empty" aria-hidden="true"><Icon name="person" size={24} /></span>)}
                        <span className="ac-main"><span className="ac-nm">{s.label}</span>{s.detail && <span className="ac-mt">{s.detail}</span>}</span>
                        {s.count && <span className="ac-cnt num">{s.count}</span>}
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
            <div className="ac-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd>choose</span><span><kbd>Enter</kbd>select</span><span><kbd>Esc</kbd>close</span></div>
          </div>
        )}
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
          <p>Either of two speakers: {example(EITHER)}</p>
        </div>
      </div>
    </form>
  );
}
