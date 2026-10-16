// Landing on the passage a search result showed: find it in the turn, keep it in view, and wash it yellow briefly.
import { locatePassage } from "../../lib/passage";

/** The turn's words as the reader sees them (label, page numbers and gutter left out), with each one's text node. */
function textOf(section: HTMLElement) {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  let block: Element | null = null;
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("h3, .pb b, .g") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const here = n.parentElement!.closest("p, div");
    if (block && here !== block) text += " "; // a paragraph break reads as a space
    block = here;
    nodes.push(n);
    starts.push(text.length);
    text += n.data;
  }
  return { nodes, starts, text };
}

/** The named passage in a turn as one rectangle per text run, or null when it can't be found. */
export function passageIn(section: HTMLElement, param: string): { box: () => DOMRect; rects: () => DOMRect[] } | null {
  const { nodes, starts, text } = textOf(section);
  const at = locatePassage(text, param);
  if (!at) return null;
  const [from, to] = at;
  const pieces: Range[] = [];
  nodes.forEach((node, k) => {
    const a = Math.max(from - starts[k], 0);
    const b = Math.min(to - starts[k], node.length);
    if (b <= a) return;
    const r = document.createRange();
    r.setStart(node, a);
    r.setEnd(node, b);
    pieces.push(r);
  });
  if (!pieces.length) return null;
  const rects = () => pieces.flatMap((r) => [...r.getClientRects()]).filter((r) => r.width > 1 && r.height > 1);
  return { box: () => pieces[0].getBoundingClientRect(), rects };
}

/** Washes the passage yellow, fading out over about three seconds; any scroll, tap or key clears it at once. */
export function flash(rects: DOMRect[]) {
  if (!rects.length) return;
  const layer = document.createElement("div");
  layer.className = "flash-layer";
  layer.setAttribute("aria-hidden", "true");
  for (const r of rects) {
    const mark = document.createElement("div");
    mark.className = "flash";
    Object.assign(mark.style, { left: `${r.left - 2}px`, top: `${r.top - 1}px`, width: `${r.width + 4}px`, height: `${r.height + 2}px` });
    layer.append(mark);
  }
  document.body.append(layer);
  const clear = () => layer.remove();
  layer.firstElementChild!.addEventListener("animationend", clear);
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) addEventListener(type, clear, { once: true, passive: true });
  setTimeout(clear, 4000);
}
