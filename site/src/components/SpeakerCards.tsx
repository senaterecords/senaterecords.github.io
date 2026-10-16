// Speaker cards (spec 8.3), as in "Clicking a senator's name", "Every kind of speaker card" and the phone sheet.
// Desktop: hover a name for 300 ms (or click, or focus and Enter); phones: tap for a bottom sheet.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SpeakerInfo } from "../lib/speakers";
import { readerData, surname, turnSection } from "./readerData";
import { clientOnly, Icon } from "./ui";

const OPEN_DELAY = 300;
const CLOSE_DELAY = 200;
const PHONE = "(max-width: 640px)";

interface Open { key: string; turn: number; label: HTMLElement; pinned: boolean; }

const labelFor = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>("section.turn > h3.sp[data-key]") : null;

function Cards() {
  const [open, setOpen] = useState<Open | null>(null);
  const [phone, setPhone] = useState(false);
  const [only, setOnly] = useState<SpeakerInfo | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const card = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number>(0);
  const closeTimer = useRef<number>(0);
  const openRef = useRef<Open | null>(null);
  openRef.current = open;

  const speakers = readerData().speakers;

  const place = useCallback((label: HTMLElement) => {
    const r = label.getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 32);
    setPos({ top: r.bottom + window.scrollY + 8, left: Math.max(16, Math.min(r.left + window.scrollX - 8, window.scrollX + window.innerWidth - width - 16)) });
  }, []);

  const show = useCallback((label: HTMLElement, pinned: boolean) => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    const key = label.dataset.key!;
    if (!speakers[key]) return;
    const turn = Number(label.closest<HTMLElement>("section.turn")!.dataset.i);
    place(label);
    setOpen({ key, turn, label, pinned });
  }, [place, speakers]);

  const close = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    setOpen(null);
  }, []);

  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    // Names are focusable so the keyboard can open a card with Enter.
    for (const h of document.querySelectorAll<HTMLElement>("section.turn > h3.sp[data-key]")) h.tabIndex = 0;
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || window.matchMedia(PHONE).matches) return;
      const label = labelFor(e.target);
      if (!label) return;
      window.clearTimeout(closeTimer.current);
      const current = openRef.current;
      if (current?.pinned || current?.label === label) return;
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => show(label, false), OPEN_DELAY);
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const label = labelFor(e.target);
      if (!label || label.contains(e.relatedTarget as Node)) return;
      window.clearTimeout(openTimer.current);
      if (openRef.current && !openRef.current.pinned && !card.current?.contains(e.relatedTarget as Node)) {
        closeTimer.current = window.setTimeout(close, CLOSE_DELAY);
      }
    };
    const click = (e: MouseEvent) => {
      const label = labelFor(e.target);
      if (label) { show(label, true); return; }
      if (openRef.current && !card.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openRef.current) { const { label } = openRef.current; close(); label.focus({ preventScroll: true }); }
      if (e.key === "Enter" && labelFor(e.target) === e.target) { e.preventDefault(); show(e.target as HTMLElement, true); }
    };
    // A name clicked before this island started opens now.
    window.__otrCards = true;
    const early = window.__otrEarly?.clicks.pop();
    if (early) show(early, true);
    // A name already under the pointer opens as if it had just been hovered.
    const hovered = document.querySelector<HTMLElement>("section.turn > h3.sp[data-key]:hover");
    if (!early && hovered && !window.matchMedia(PHONE).matches) openTimer.current = window.setTimeout(() => show(hovered, false), OPEN_DELAY);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("click", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", key);
    };
  }, [show, close]);

  // A card that would run off the bottom of the window opens above the name instead.
  useLayoutEffect(() => {
    if (!open || phone || !card.current) return;
    const height = card.current.offsetHeight;
    const r = open.label.getBoundingClientRect();
    if (r.bottom + 8 + height > window.innerHeight && r.top - 8 - height > 0) {
      setPos((p) => ({ ...p, top: r.top + window.scrollY - height - 8 }));
    }
  }, [open, phone]);

  // The open name gets the heavier underline.
  useEffect(() => {
    if (!open) return;
    open.label.classList.add("on");
    return () => open.label.classList.remove("on");
  }, [open]);

  // "Show only": hide every other speaker's turns, with a bar at the top of the text to undo it.
  useEffect(() => {
    const article = document.getElementById("transcript");
    if (!article) return;
    article.classList.toggle("only", !!only);
    for (const section of article.querySelectorAll<HTMLElement>("section.turn")) {
      section.hidden = !!only && section.dataset.key !== only.key;
    }
  }, [only]);

  const sp = open ? speakers[open.key] : null;
  const role = open ? turnSection(open.turn)?.dataset.role : undefined;
  const presidingView = !!sp && (sp.kind === "president" || sp.kind === "secretary" || role === "presiding" || sp.remarks.length === 0);
  const list = sp ? (presidingView ? sp.presiding : sp.remarks) : [];
  const index = open ? list.findIndex((i) => i >= open.turn) : -1;
  const at = index < 0 ? list.length - 1 : index;
  const hearing = readerData().kind === "hearing";
  const secretaryName = sp?.kind === "secretary" ? sp.line2.replace(/^Secretary of the Senate at the time: /, "") : "";

  const step = (delta: number) => {
    const target = list[at + delta];
    const section = target != null ? turnSection(target) : null;
    const label = section?.querySelector<HTMLElement>("h3.sp[data-key]");
    if (!section || !label) return;
    section.scrollIntoView({ block: "center" });
    place(label);
    setOpen({ key: open!.key, turn: target, label, pinned: true });
  };

  const countText = !sp ? "" : sp.kind === "secretary"
    ? `${list.length} reading${list.length === 1 ? "" : "s"}`
    : presidingView ? `${list.length} time${list.length === 1 ? "" : "s"}` : `${list.length} remark${list.length === 1 ? "" : "s"}`;
  const countWhere = !sp ? "" : sp.kind === "secretary" || !presidingView ? `in this ${hearing ? "hearing" : "transcript"}` : "presiding here";

  const actions = !sp ? null : (
    <>
      {sp.kind === "senator" && sp.url && <a className="btn-primary" href={sp.url}>Open senator page</a>}
      {sp.kind === "assembly" && sp.officialUrl && (
        <a className="btn btn-quiet" href={sp.officialUrl} target="_blank" rel="noopener"><Icon name="ext" size={14} />Official page</a>
      )}
      {sp.kind !== "secretary" && (
        <button type="button" className="btn" onClick={() => { setOnly(sp); close(); }}>
          {sp.kind === "president" ? "Show only the President" : `Show only ${surname(sp.name)}`}
        </button>
      )}
    </>
  );

  const body = sp && (
    <>
      <div className="sc-hd">
        {sp.photo && <img className="photo" src={sp.photo} alt="" width={phone ? 48 : 40} height={phone ? 62 : 52} />}
        <div>
          <div className="sc-nm">{sp.name}</div>
          {sp.kind === "senator" || sp.kind === "assembly" ? (
            <>{sp.line1 && <div className="sc-mt">{sp.line1}</div>}{sp.line2 && <div className="sc-mt">{sp.line2}</div>}</>
          ) : sp.kind === "president" ? (
            <><div className="sc-mt">{sp.line1}</div><p className="sc-note">{sp.line2}</p></>
          ) : (
            <p className="sc-note">{sp.line1}{secretaryName && <> Secretary of the Senate at the time: <b>{secretaryName}</b>.</>}</p>
          )}
        </div>
      </div>
      <div className={`sc-here${sp.kind === "secretary" ? " last" : ""}`}>
        <span><b className="num">{countText}</b> {countWhere}</span>
        <span className="sc-nav">
          <button type="button" disabled={at <= 0 || !list.length} onClick={() => step(-1)} aria-label="Previous remark by this speaker">‹ {phone ? "Prev" : "Previous"}</button>
          <button type="button" disabled={at >= list.length - 1 || !list.length} onClick={() => step(1)} aria-label="Next remark by this speaker">Next ›</button>
        </span>
      </div>
      {sp.kind !== "secretary" && <div className={phone ? "sc-stack" : "sc-row"}>{actions}</div>}
    </>
  );

  const onlyBarSlot = document.getElementById("reader-notices");

  return (
    <>
      {sp && !phone && createPortal(
        <div ref={card} className="scard" role="dialog" aria-label={sp.name} style={{ top: pos.top, left: pos.left }}
          onPointerEnter={() => window.clearTimeout(closeTimer.current)}
          onPointerLeave={(e) => { if (e.pointerType === "mouse" && !openRef.current?.pinned) closeTimer.current = window.setTimeout(close, CLOSE_DELAY); }}>
          {body}
        </div>, document.body)}
      {sp && phone && createPortal(
        <>
          <div className="sheet-dim" onClick={close} />
          <div ref={card} className="sheet" role="dialog" aria-label={sp.name}><div className="sheet-grab" />{body}</div>
        </>, document.body)}
      {only && onlyBarSlot && createPortal(
        <p className="only-bar">Showing only <b>{only.name}</b> · <button type="button" onClick={() => setOnly(null)}>Show all</button></p>,
        onlyBarSlot)}
    </>
  );
}

/** Renders only in the browser (it reads the page's embedded data). */
export default clientOnly(Cards);
