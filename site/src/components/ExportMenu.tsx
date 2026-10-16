// Export (spec 8.3): a Word document, plain text or print, made in the browser from the page itself. Nothing is stored.
import { download } from "../lib/download";
import { DOCX_TYPE, docx, type Block } from "../lib/docx";
import { longDate, weekdayDate } from "../lib/format";
import { ExportButton } from "./ExportButton";
import { readerData } from "./readerData";
import { clientOnly, Icon } from "./ui";

/** The transcript as paragraphs: the title and source, then each turn with its speaker in bold, and each page break. */
export function transcriptBlocks(): Block[] {
  const data = readerData();
  const title = data.kind === "floor" ? `${data.title ?? "Floor session"}, ${longDate(data.date)}` : data.title ?? "Public hearing";
  const meta = document.querySelector(".rd-meta")?.textContent?.replace(/\s+/g, " ").trim() ?? weekdayDate(data.date);
  const source = location.href.split("#")[0];
  const blocks: Block[] = [
    { kind: "title", text: title },
    { kind: "meta", text: meta },
    { kind: "meta", runs: [{ text: "Source: New York State Senate, " }, { text: source, link: source }] },
  ];
  for (const section of document.querySelectorAll<HTMLElement>("#transcript section.turn")) {
    const label = section.querySelector("h3.sp")?.textContent?.trim();
    let first = true;
    const pageLine = (pb: Element) => blocks.push({ kind: "page", text: pb.querySelector("b")?.textContent?.trim() ?? "" });
    const textLine = (raw: string) => {
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) return;
      blocks.push({ kind: "para", runs: first && label ? [{ text: `${label}: `, bold: true }, { text }] : [{ text }] });
      first = false;
    };
    for (const node of section.children) {
      if (node.matches(".pb")) pageLine(node);
      else if (node.matches("p")) {
        // A page break inside a paragraph splits it into two paragraphs around the page mark.
        let text = "";
        for (const child of node.childNodes) {
          if (child instanceof Element && child.matches(".pb")) { textLine(text); text = ""; pageLine(child); }
          else text += child.textContent ?? "";
        }
        textLine(text);
      }
    }
    if (first && label) blocks.push({ kind: "para", runs: [{ text: `${label}:`, bold: true }] });
  }
  return blocks;
}

/** The same paragraphs as plain text: a blank line between paragraphs, page marks in brackets. */
export const blocksText = (blocks: Block[]) => blocks
  .map((b) => (b.kind === "page" ? `[${b.text}]` : (b.runs ?? [{ text: b.text ?? "" }]).map((r) => r.text).join("")))
  .join("\n\n") + "\n";

function ExportMenu() {
  const slug = readerData().slug;
  return (
    <ExportButton label="Export" choices={[
      { label: "Word document", hint: ".docx", pick: () => download(`${slug}.docx`, docx(transcriptBlocks()), DOCX_TYPE) },
      { label: "Plain text", hint: ".txt", pick: () => download(`${slug}.txt`, blocksText(transcriptBlocks()), "text/plain") },
      { label: "Print or save as PDF", pick: () => window.print() },
    ]}>
      <Icon name="dl" size={15} className="xm-dl" /><span className="xm-text">Export</span><Icon name="down" size={13} className="xm-down" />
      <Icon name="more" size={20} className="xm-more" />
    </ExportButton>
  );
}

export default clientOnly(ExportMenu);
