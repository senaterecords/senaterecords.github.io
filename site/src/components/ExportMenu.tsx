// Export (spec 8.3): Markdown, plain text or print, made in the browser from the page itself. Nothing is stored.
import { useEffect, useRef, useState } from "react";
import { download, markdownEscape } from "../lib/download";
import { longDate, weekdayDate } from "../lib/format";
import { readerData } from "./readerData";
import { clientOnly, Icon } from "./ui";

type Format = "md" | "txt";

/** The transcript as text: one block per turn with its label, and a line at each page break. */
export function transcriptText(format: Format): string {
  const data = readerData();
  const title = data.kind === "floor" ? `${data.title ?? "Floor session"}, ${longDate(data.date)}` : data.title ?? "Public hearing";
  const meta = document.querySelector(".rd-meta")?.textContent?.replace(/\s+/g, " ").trim() ?? weekdayDate(data.date);
  const md = (text: string) => (format === "md" ? markdownEscape(text) : text);
  const lines: string[] = format === "md"
    ? [`# ${md(title)}`, "", `*${md(meta)}*`, "", `Source: New York State Senate, ${location.href.split("#")[0]}`, ""]
    : [title, "", meta, "", `Source: New York State Senate, ${location.href.split("#")[0]}`, ""];
  for (const section of document.querySelectorAll<HTMLElement>("#transcript section.turn")) {
    const label = section.querySelector("h3.sp")?.textContent?.trim();
    let first = true;
    const pageLine = (pb: Element) => {
      const page = pb.querySelector("b")?.textContent?.trim() ?? "";
      lines.push(format === "md" ? `*${page}*` : `[${page}]`, "");
    };
    const textLine = (raw: string) => {
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) return;
      const lead = first && label ? (format === "md" ? `**${md(label)}:** ` : `${label}: `) : "";
      lines.push(lead + md(text), "");
      first = false;
    };
    for (const node of section.children) {
      if (node.matches(".pb")) pageLine(node);
      else if (node.matches("p")) {
        // A page break inside a paragraph splits it into two lines around the page marker.
        let text = "";
        for (const child of node.childNodes) {
          if (child instanceof Element && child.matches(".pb")) { textLine(text); text = ""; pageLine(child); }
          else text += child.textContent ?? "";
        }
        textLine(text);
      }
    }
    if (first && label) lines.push(format === "md" ? `**${md(label)}:**` : `${label}:`, "");
  }
  return lines.join("\n");
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const slug = readerData().slug;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (what: "md" | "txt" | "print") => {
    setOpen(false);
    if (what === "print") window.print();
    else download(`${slug}.${what}`, transcriptText(what), what === "md" ? "text/markdown" : "text/plain");
  };

  return (
    <div className="xm" ref={box}>
      <button type="button" className="btn xm-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Export" onClick={() => setOpen((o) => !o)}>
        <Icon name="dl" size={15} className="xm-dl" /><span className="xm-text">Export</span><Icon name="down" size={13} className="xm-down" />
        <Icon name="more" size={20} className="xm-more" />
      </button>
      {open && (
        <div className="xm-menu" role="menu" aria-label="Export">
          <button type="button" role="menuitem" onClick={() => pick("md")}>Markdown<small>.md file</small></button>
          <button type="button" role="menuitem" onClick={() => pick("txt")}>Plain text<small>.txt file</small></button>
          <button type="button" role="menuitem" onClick={() => pick("print")}>Print or save as PDF</button>
        </div>
      )}
    </div>
  );
}

export default clientOnly(ExportMenu);
