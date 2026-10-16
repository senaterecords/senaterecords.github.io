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

/** The named passage in a turn as one rectangle per text run, and the top and bottom of all of it; null when it can't
 * be found. */
export function passageIn(section: HTMLElement, param: string): { span: () => { top: number; bottom: number }; rects: () => DOMRect[] } | null {
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
  const span = () => {
    const first = pieces[0].getBoundingClientRect();
    const last = pieces[pieces.length - 1].getBoundingClientRect();
    return { top: first.top, bottom: Math.max(first.bottom, last.bottom) };
  };
  return { span, rects };
}

/** Washes the passage yellow: it fades in, holds a moment and fades out over about three seconds, staying on the words
 * while the page scrolls. A click or key fades it out sooner. In a tab opened in the background it waits to be seen. */
export function flash(rects: () => DOMRect[]) {
  if (document.hidden) {
    document.addEventListener("visibilitychange", () => flash(rects), { once: true });
    return;
  }
  const layer = document.createElement("div");
  layer.className = "flash-layer";
  layer.setAttribute("aria-hidden", "true");
  // The boxes sit on the screen, not the page, so they are redrawn over the words whenever the page moves.
  const draw = () => {
    const boxes = rects();
    while (layer.children.length < boxes.length) layer.append(Object.assign(document.createElement("div"), { className: "flash" }));
    while (layer.children.length > boxes.length) layer.lastElementChild!.remove();
    boxes.forEach((r, k) => Object.assign((layer.children[k] as HTMLElement).style, {
      left: `${r.left - 2}px`, top: `${r.top - 1}px`, width: `${r.width + 4}px`, height: `${r.height + 2}px`,
    }));
  };
  draw();
  if (!layer.children.length) return;
  document.body.append(layer);
  let frame = 0;
  const follow = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
  const soon = () => {
    const from = Number(getComputedStyle(layer).opacity);
    wash.cancel();
    layer.animate([{ opacity: from }, { opacity: 0 }], { duration: 350, easing: "ease-out", fill: "forwards" }).finished.then(clear, clear);
  };
  const clear = () => {
    layer.remove();
    cancelAnimationFrame(frame);
    removeEventListener("scroll", follow);
    removeEventListener("resize", follow);
    removeEventListener("click", soon, true);
    removeEventListener("keydown", soon, true);
  };
  addEventListener("scroll", follow, { passive: true });
  addEventListener("resize", follow, { passive: true });
  addEventListener("click", soon, { capture: true, once: true });
  addEventListener("keydown", soon, { capture: true, once: true });
  const wash = layer.animate(
    [{ opacity: 0 }, { opacity: 0.9, offset: 0.08 }, { opacity: 0.9, offset: 0.5 }, { opacity: 0 }],
    { duration: 3200, easing: "ease-in-out" },
  );
  wash.finished.then(clear, () => { /* cancelled: the quick fade clears it */ });
}
