// Moving through a transcript (spec 8.3): J / K between spoken remarks, the phone bill bar and remark bar,
// the desktop headnote for the bill being read, and a notice when a remark link no longer resolves.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { outcomeText } from "../lib/format";
import { indexOfTurn, readerData, type ReaderSegment } from "./readerData";
import { clientOnly, Icon } from "./ui";

const SPOKEN = new Set(["senator", "chair", "assembly"]);
const MISSING = "That remark is no longer in this transcript; it may have been corrected. You're at the top.";

interface Remark { i: number; heading: HTMLElement; }

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** The turn at a height in the window, read from the text column. */
function sectionAt(y: number): HTMLElement | null {
  const article = document.getElementById("transcript");
  if (!article) return null;
  const box = article.getBoundingClientRect();
  const x = Math.min(box.left + 140, box.right - 10);
  // Look through anything floating over the text (the speaker strip, the notices) to the transcript beneath.
  for (const el of document.elementsFromPoint(x, y)) {
    const turn = el.closest<HTMLElement>("section.turn");
    if (turn) return turn;
    if (el === article) return null;
  }
  return null;
}

function turnAt(y: number): number | null {
  const hit = sectionAt(y);
  return hit ? indexOfTurn(hit) : null;
}

function ReaderNav() {
  const data = readerData();
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [segment, setSegment] = useState<ReaderSegment | null>(null);
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  const [missing, setMissing] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [who, setWho] = useState<HTMLElement | null>(null);
  const [, setShown] = useState(0);
  const last = useRef<{ index: number; scrollY: number } | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // The phone calendar sheet takes the focus when it opens, and Esc closes it.
  useEffect(() => {
    if (!calendarOpen) return;
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCalendarOpen(false); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [calendarOpen]);

  // "Show only" hides turns (SpeakerCards marks the transcript .only); J/K and the remark bar then skip hidden ones.
  useEffect(() => {
    const article = document.getElementById("transcript");
    if (!article) return;
    const observer = new MutationObserver(() => { last.current = null; setShown((n) => n + 1); });
    observer.observe(article, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const visible = remarks.filter((r) => !r.heading.hidden);

  useEffect(() => {
    const found: Remark[] = [];
    for (const section of document.querySelectorAll<HTMLElement>("#transcript section.turn[id^='r-']")) {
      if (SPOKEN.has(section.dataset.role ?? "")) found.push({ i: indexOfTurn(section), heading: section });
    }
    setRemarks(found);
    const check = () => {
      const hash = decodeURIComponent(location.hash.slice(1));
      if (!/^r-\d+$/.test(hash) || document.getElementById(hash)) return;
      // A link to a turn without a speaker label (a calendar reading can start on one) goes to that turn.
      const unlabelled = document.getElementById(`t-${hash.slice(2)}`);
      if (unlabelled) { unlabelled.scrollIntoView({ block: "start" }); return; }
      window.scrollTo(0, 0);
      setMissing(true);
    };
    check();
    addEventListener("hashchange", check);
    return () => removeEventListener("hashchange", check);
  }, []);

  // Which reading is on screen: the last segment whose first turn is above the middle of the window.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // A long remark whose label has scrolled under the bar keeps its speaker named at the top.
      const edge = document.getElementById("reader-notices")?.getBoundingClientRect().bottom ?? 58;
      const top = sectionAt(edge + 4);
      const label = top?.querySelector<HTMLElement>(":scope > h3.sp");
      setWho(top && label && label.getBoundingClientRect().bottom < edge && top.getBoundingClientRect().bottom > edge + 60 ? label : null);
      const turn = turnAt(window.innerHeight / 2);
      if (turn == null) return;
      setCurrentTurn(turn);
      const seg = [...data.segments].reverse().find((s) => s.startTurn <= turn) ?? null;
      setSegment(seg && turn <= Math.max(seg.endTurn, seg.startTurn) ? seg : null);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => { removeEventListener("scroll", onScroll); removeEventListener("resize", onScroll); };
  }, [data.segments]);

  // The calendar row of the reading on screen is marked, as in the reader mock.
  useEffect(() => {
    for (const li of document.querySelectorAll(".rd-cal li.cur")) li.classList.remove("cur");
    if (segment) document.querySelector(`.rd-cal li[data-start="${segment.startTurn}"]`)?.classList.add("cur");
    const fallback = document.getElementById("headnote-default");
    if (fallback) fallback.hidden = !!segment;
  }, [segment]);

  const scope = segment
    ? visible.filter((r) => r.i >= segment.startTurn && r.i <= Math.max(segment.endTurn, segment.debateEnd))
    : visible;
  const position = currentTurn == null ? -1 : scope.reduce((at, r, idx) => (r.i <= currentTurn ? idx : at), -1);

  const go = useCallback((list: Remark[], index: number) => {
    const target = list[Math.max(0, Math.min(index, list.length - 1))];
    if (!target) return;
    target.heading.scrollIntoView({ block: "start" });
    history.replaceState(null, "", `#r-${target.i}`);
    last.current = { index: list.indexOf(target), scrollY: window.scrollY };
    setCurrentTurn(target.i);
    setMissing(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const list = remarks.filter((r) => !r.heading.hidden);
      if ((e.key !== "j" && e.key !== "k") || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !list.length) return;
      let base: number;
      if (last.current && Math.abs(window.scrollY - last.current.scrollY) < 4) base = last.current.index;
      else {
        const turn = turnAt(120) ?? -1;
        base = list.reduce((at, r, idx) => (r.i <= turn ? idx : at), -1);
      }
      go(list, e.key === "j" ? base + 1 : Math.max(0, base - 1));
    };
    document.addEventListener("keydown", onKey);
    // J/K pressed before this island started are replayed once the remarks are known.
    if (remarks.length && !window.__otrNav) {
      window.__otrNav = true;
      for (const key of window.__otrEarly?.keys.splice(0) ?? []) onKey(new KeyboardEvent("keydown", { key }));
    }
    return () => document.removeEventListener("keydown", onKey);
  }, [remarks, go]);

  const notices = document.getElementById("reader-notices");
  const headnote = document.getElementById("headnote-live");
  const k = position + 1;

  return (
    <>
      {missing && notices && createPortal(
        <p className="rd-notice" role="status">{MISSING} <button type="button" onClick={() => setMissing(false)}>Dismiss</button></p>, notices)}

      {segment && headnote && createPortal(
        <div className="hn-live">
          <div className="hn-top">
            {segment.url ? <a className="hn-bill num" href={segment.url}>{segment.printNo}</a> : <b className="hn-bill num">{segment.printNo ?? `No. ${segment.calNo}`}</b>}
            {segment.status && (
              <span className={`status${segment.status.tone !== "ink" ? ` ${segment.status.tone}` : ""}`}>
                <Icon name={segment.status.tone === "ink" ? "flag-o" : "flag"} size={14} />{segment.status.text}
              </span>
            )}
          </div>
          {segment.title && <h2 className="hn-billtitle serif">{segment.title}</h2>}
          <dl className="hn-dl">
            <dt>Calendar</dt><dd className="num">No. {segment.calNo}</dd>
            {segment.sponsor && <><dt>Sponsor</dt><dd>{segment.sponsor}</dd></>}
            <dt>On the floor</dt><dd>{outcomeText(segment)}</dd>
            <dt>Debate</dt><dd className="num">{segment.remarks ? `${segment.remarks} remarks` : "No debate"}</dd>
          </dl>
          {scope.length > 0 && <h3 className="hn-pos num">Remark {Math.max(k, 1)} of {scope.length}</h3>}
          <div className="keys"><span><kbd>J</kbd>next remark</span><span><kbd>K</kbd>previous</span></div>
        </div>, headnote)}

      {who && notices && createPortal(
        <p className="rd-who">
          {who.classList.contains("k")
            ? <button type="button" className="rd-who-name" onClick={(e) => dispatchEvent(new CustomEvent("otr:card", { detail: { label: who, anchor: e.currentTarget, keyboard: e.detail === 0 } }))}><b>{who.textContent}</b></button>
            : <b>{who.textContent}</b>}
          <span>continued</span>
        </p>, notices)}

      {segment && notices && createPortal(
        <button type="button" className="billbar" onClick={() => setCalendarOpen(true)} aria-label="Show the calendar">
          <b className="num">No. {segment.calNo}{segment.printNo ? ` · ${segment.printNo}` : ""}</b>
          <span className="t">{segment.title ?? (segment.debated ? "Debated" : "No debate")}</span>
          <Icon name="down" size={16} />
        </button>, notices)}

      {remarks.length > 0 && (
        <div className="remarkbar">
          <button type="button" className="nav" aria-label="Previous remark" disabled={position <= 0} onClick={() => go(scope, position - 1)}>
            <Icon name="chevl" size={18} />
          </button>
          <span className="num">Remark {Math.max(k, 1)} of {scope.length}<small>{segment?.printNo ? `${segment.printNo} debate` : "this transcript"}</small></span>
          <button type="button" className="nav" aria-label="Next remark" disabled={position >= scope.length - 1} onClick={() => go(scope, position + 1)}>
            <Icon name="chev" size={18} />
          </button>
        </div>
      )}

      {calendarOpen && createPortal(
        <>
          <div className="sheet-dim" onClick={() => setCalendarOpen(false)} />
          <div ref={sheet} className="sheet" role="dialog" aria-label="On the calendar" tabIndex={-1}>
            <div className="sheet-grab" />
            <h3 className="sheet-h3">On the calendar</h3>
            <ul className="sheet-cal">
              {data.segments.map((s) => (
                <li key={s.startTurn} className={s === segment ? "cur" : undefined}>
                  <a href={`#r-${s.startTurn}`} onClick={() => setCalendarOpen(false)}>
                    <span className="n num">{s.calNo}</span>
                    <span className="p num">{s.printNo ?? "No bill number"}<small>{s.title ?? (s.debated ? "Debated" : "No debate")}</small></span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </>, document.body)}
    </>
  );
}

export default clientOnly(ReaderNav);
