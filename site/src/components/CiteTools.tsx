// Copy with cite (spec 8.3): select text in the transcript for a small panel (desktop) or a bottom sheet (phones)
// with the legal citation, a Plain choice, and copy buttons. Legal is the default.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { legalCite, plainCite, speakerForms, type CiteInput, type SpeakerKind } from "../lib/format";
import { readerData } from "./readerData";
import { clientOnly, Icon } from "./ui";

const PHONE = "(max-width: 640px)";

interface Picked { text: string; cite: CiteInput; remark: number | null; top: number; left: number; }

/** The page a point in the text is on: the last page break before it inside its turn, else the turn's start page. */
function pageAt(node: Node, offset: number, turn: HTMLElement): number | null {
  const point = document.createRange();
  point.setStart(node, offset);
  let page = turn.dataset.page ? Number(turn.dataset.page) : null;
  for (const pb of turn.querySelectorAll<HTMLElement>(".pb")) {
    if (point.comparePoint(pb, 0) < 0) page = Number(pb.id.slice(1)) || Number(pb.textContent?.replace(/\D/g, "")) || page;
  }
  return page;
}

const turnOf = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("#transcript section.turn") ?? null;

function speakerOf(turn: HTMLElement): CiteInput["speaker"] {
  const label = turn.querySelector("h3.sp")?.textContent?.trim() ?? "";
  const info = turn.dataset.key ? readerData().speakers[turn.dataset.key] : undefined;
  if (!label) return { short: "", full: "" };
  if (!info) return speakerForms("other", label);
  const kind: SpeakerKind = info.kind;
  const fullName = info.kind === "senator" ? info.name.replace(/^Sen\. /, "")
    : info.kind === "assembly" ? info.name.replace(/^Asm\. /, "")
    : info.kind === "president" ? info.name.replace(/^Lt\. Gov\. /, "") : null;
  return speakerForms(kind, label, fullName);
}

/** The remark a selection belongs to: its turn's heading, or the nearest heading before it. */
function remarkOf(turn: HTMLElement): number | null {
  let section: Element | null = turn;
  while (section) {
    const h = section.querySelector("h3[id^='r-']");
    if (h) return Number(h.id.slice(2));
    section = section.previousElementSibling ?? section.parentElement?.previousElementSibling?.lastElementChild ?? null;
  }
  return null;
}

const finish = (cite: string) => cite.replace(/ \((remarks of )?\)$/, "");

function CiteTools() {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [style, setStyle] = useState<"legal" | "plain">("legal");
  const [copied, setCopied] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const read = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setPicked(null); return; }
    const range = sel.getRangeAt(0);
    const startTurn = turnOf(range.startContainer);
    const endTurn = turnOf(range.endContainer);
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!startTurn || !endTurn || !text) { setPicked(null); return; }
    const data = readerData();
    const start = pageAt(range.startContainer, range.startOffset, startTurn);
    const end = pageAt(range.endContainer, range.endOffset, endTurn);
    const rect = range.getBoundingClientRect();
    setPicked({
      text,
      cite: { kind: data.kind, date: data.date, title: data.title, start, end: end !== start ? end : null, speaker: speakerOf(startTurn) },
      remark: remarkOf(startTurn),
      top: rect.bottom + window.scrollY + 10,
      left: Math.max(16, Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - 456)),
    });
    setCopied(null);
  }, []);

  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    let timer = 0;
    const onUp = (e: Event) => { if (!panel.current?.contains(e.target as Node)) window.setTimeout(read, 0); };
    // Phones select with handles, not a mouse: settle on the selection a moment after it stops changing.
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) setPicked(null);
        else if (query.matches) read();
      }, query.matches ? 450 : 150);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicked(null);
      else if (e.shiftKey && e.key.startsWith("Arrow")) window.setTimeout(read, 0);
    };
    read(); // text selected before this island started
    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("keyup", onKey);
    return () => {
      query.removeEventListener("change", update);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("keyup", onKey);
    };
  }, [read]);

  if (!picked) return null;
  const citation = finish(style === "legal" ? legalCite(picked.cite) : plainCite(picked.cite));
  const link = `${location.origin}${location.pathname}${picked.remark != null ? `#r-${picked.remark}` : ""}`;
  const copy = async (what: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(what); } catch { setCopied("failed"); }
  };

  const buttons = (
    <>
      <button type="button" className={phone ? "btn-primary sheet-primary" : "btn-primary"} onClick={() => copy("cite", `“${picked.text}”\n${citation}`)}>
        <Icon name="copy" size={14} />{copied === "cite" ? "Copied" : "Copy with cite"}
      </button>
      <button type="button" className="btn" onClick={() => copy("text", picked.text)}>{copied === "text" ? "Copied" : "Copy text only"}</button>
      <button type="button" className="btn btn-quiet" onClick={() => copy("link", link)}>{copied === "link" ? "Copied" : "Link to this remark"}</button>
    </>
  );
  const choice = (
    <div className="seg cite-style" role="group" aria-label="Citation style">
      <button type="button" aria-pressed={style === "legal"} onClick={() => setStyle("legal")}>Legal</button>
      <button type="button" aria-pressed={style === "plain"} onClick={() => setStyle("plain")}>Plain</button>
    </div>
  );
  // Keep the reader's selection when they press a button in the panel.
  const keep = (e: MouseEvent) => e.preventDefault();

  return createPortal(
    phone ? (
      <div ref={panel} className="sheet cite-sheet" role="dialog" aria-label="Cite this passage" onMouseDown={keep}>
        <div className="sheet-grab" />
        <div className="cite-head"><h3>Cite this passage</h3>{choice}</div>
        <p className="cite-text">{citation}</p>
        <div className="sc-stack">{buttons}</div>
        {copied === "failed" && <p className="cite-fail">Couldn't copy. Select the citation above and copy it yourself.</p>}
      </div>
    ) : (
      <div ref={panel} className="cite-pop" role="dialog" aria-label="Cite this passage" style={{ top: picked.top, left: picked.left }} onMouseDown={keep}>
        <div className="cite-head"><p className="cite-text">{citation}</p>{choice}</div>
        <div className="cite-row">{buttons}</div>
        {copied === "failed" && <p className="cite-fail">Couldn't copy. Select the citation above and copy it yourself.</p>}
      </div>
    ),
    document.body,
  );
}

export default clientOnly(CiteTools);
