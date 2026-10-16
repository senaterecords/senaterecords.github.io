// Export (spec 8.3): Markdown, plain text or print, made in the browser from the page itself. Nothing is stored.
import { useEffect, useRef, useState } from "react";
import { longDate, weekdayDate } from "../lib/format";
import { readerData } from "./readerData";
import { clientOnly, Icon } from "./ui";

type Format = "md" | "txt";

/** The transcript as text: one block per turn with its label, and a line at each page break. */
export function transcriptText(format: Format): string {
  const data = readerData();
  const title = data.kind === "floor" ? `${data.title ?? "Floor session"}, ${longDate(data.date)}` : data.title ?? "Public hearing";
  const meta = document.querySelector(".rd-meta")?.textContent?.replace(/\s+/g, " ").trim() ?? weekdayDate(data.date);
  const lines: string[] = format === "md"
    ? [`# ${title}`, "", `*${meta}*`, "", `Source: New York State Senate, ${location.href.split("#")[0]}`, ""]
    : [title, "", meta, "", `Source: New York State Senate, ${location.href.split("#")[0]}`, ""];
  for (const section of document.querySelectorAll<HTMLElement>("#transcript section.turn")) {
    const label = section.querySelector("h3.sp")?.textContent?.trim();
    let first = true;
    for (const node of section.children) {
      if (node.matches("p")) {
        const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (!text) continue;
        const lead = first && label ? (format === "md" ? `**${label}:** ` : `${label}: `) : "";
        lines.push(lead + text, "");
        first = false;
      } else if (node.matches(".pb")) {
        const page = node.querySelector("b")?.textContent?.trim() ?? "";
        lines.push(format === "md" ? `*${page}*` : `[${page}]`, "");
      }
    }
    if (first && label) lines.push(format === "md" ? `**${label}:**` : `${label}:`, "");
  }
  return lines.join("\n");
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
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
