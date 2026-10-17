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

// The Search tips panel teaches by one search taken apart, each part with what it does and the whole read back as a
// sentence; then the rules, three short columns; then research tasks put as a staffer would, each with its search.
// Every example fills the field.
const ANATOMY: [string, string][] = [
  ['("congestion pricing" OR tolls)', "this phrase or this word"],
  ["speaker:Krueger", "said by Krueger"],
  ["year:2019-2024", "in these years"],
  ["-bridge", "but not bridge"],
];
const ANATOMY_READS = "Finds Senator Krueger's remarks from 2019 to 2024 that mention “congestion pricing” or tolls, leaving out any that mention a bridge.";

const RULES: [string, [string, string][]][] = [
  ["Words", [
    ["tax", "the word and its forms: taxes, taxed, taxing"],
    ["tax*", "any word that starts with tax"],
    ['"tax"', "only this exact word"],
    ['"school aid"', "this exact phrase"],
  ]],
  ["Combine", [
    ["tolls fares", "both, in one remark; AND does the same"],
    ["tolls OR fares", "either one"],
    ["tolls -bridge", "leave one out; NOT does the same"],
    ["school NEAR/5 aid", "within 5 words (NEAR alone: 10)"],
    ['("toll revenue" OR fares) bridge', "brackets group words and phrases, at any depth"],
  ]],
  ["Narrow it down", [
    ["speaker:Krueger", "one person's remarks; senator: looks among senators only"],
    ["year:2015-2019", "a year or a range"],
    ["type:hearing", "hearings only, or type:floor"],
    ["committee:Health", "one committee's hearings"],
    ["bill:S4597", "transcripts that mention the bill"],
    ["-speaker:Krueger", "a minus in front leaves any of these out"],
  ]],
];

const TASKS: [string, string][] = [
  ["What Senator Krueger said about the budget", "budget speaker:Krueger"],
  ["Minimum wage on the floor, 2013 to 2016", '"minimum wage" type:floor year:2013-2016'],
  ["Rent, renters and rental in Housing hearings", "rent* committee:Housing"],
  ["School aid or foundation aid, from anyone but Krueger", '("school aid" OR "foundation aid") -speaker:Krueger'],
  ["Toll revenue or congestion pricing, close to a bridge", '("toll revenue" OR "congestion pricing") NEAR/10 bridge'],
];
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

  // Where the caret goes once a picked suggestion is in the field. It is put there as soon as React has written the
  // new text, before anything more can be typed: a frame later, on a slow device, it would jump back in front of
  // letters already typed ("budget" came out "udgetb").
  const placeCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = placeCaret.current;
    if (at == null || !input.current) return;
    placeCaret.current = null;
    input.current.focus();
    input.current.setSelectionRange(at, at);
  }, [value]);
  const pick = (s: Suggestion) => {
    if (!token) return;
    const next = replaceToken(value, token, s.value, s.trailingSpace);
    if (next.value === value) { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); }
    else placeCaret.current = next.caret;
    setValue(next.value);
    setCaret(next.caret);
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
          <section className="tip-apart" aria-labelledby={`${tipsId}-apart`}>
            <div className="tip-apart-head">
              <h3 id={`${tipsId}-apart`}>How a search fits together</h3>
              <button type="button" className="tip-try" onClick={() => fill(ANATOMY.map(([q]) => q).join(" "))}>Try this search</button>
            </div>
            <p className="tip-parts">{ANATOMY.map(([q, what]) => <span key={q} className="tip-part"><span className="tip-q">{q}</span><span className="tip-cap">{what}</span></span>)}</p>
            <p className="tip-reads">{ANATOMY_READS}</p>
          </section>
          <div className="tip-rules">
            {RULES.map(([title, rules]) => (
              <section key={title}>
                <h3>{title}</h3>
                <ul>{rules.map(([q, what]) => <li key={q}>{example(q)}<span>{what}</span></li>)}</ul>
              </section>
            ))}
          </div>
          <section className="tip-tasks">
            <h3>Try one</h3>
            <ul>{TASKS.map(([task, q]) => <li key={q}><span>{task}</span>{example(q)}</li>)}</ul>
          </section>
          <div className="tip-foot">
            <p>All your words must be in one remark.{" "}
              <span className="tip-wide">To look across a whole transcript, choose <b>Anywhere in a transcript</b> beside Sort.</span>
              <span className="tip-narrow">To look across a whole transcript, choose it under Filters.</span>
            </p>
            <p>Write AND, OR, NOT and NEAR in capitals.</p>
          </div>
        </div>
      </div>
    </form>
  );
}
