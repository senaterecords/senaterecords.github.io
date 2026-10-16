// Turning a turn's text into reader blocks: paragraphs, with the official page breaks at their offsets.
export type Block = { kind: "p"; text: string } | { kind: "pb"; page: number };

export function turnBlocks(text: string, breaks: [number, number][]): Block[] {
  const blocks: Block[] = [];
  const paragraphs = (piece: string) => {
    for (const p of piece.split(/\n\s*\n/)) {
      const joined = p.replace(/\s*\n\s*/g, " ").trim();
      if (joined) blocks.push({ kind: "p", text: joined });
    }
  };
  let from = 0;
  for (const [offset, page] of [...breaks].sort((a, b) => a[0] - b[0])) {
    paragraphs(text.slice(from, offset));
    blocks.push({ kind: "pb", page });
    from = offset;
  }
  paragraphs(text.slice(from));
  return blocks;
}

// Desktop reading column: Charis 17px at line-height 1.62, about 74 characters a line at 68ch.
const LINE = 17 * 1.62;
const CHARS = 74;

/** Roughly how tall turns render on desktop, in px, for content-visibility's placeholder size. */
export function estimateHeight(turns: { label: string | null; text: string; breaks: [number, number][] }[]): number {
  let total = 0;
  for (const t of turns) {
    const blocks = turnBlocks(t.text, t.breaks);
    const paragraphs = blocks.filter((b) => b.kind === "p");
    let lines = 0;
    paragraphs.forEach((b, i) => {
      const extra = i === 0 && t.label ? Math.ceil((t.label.length + 2) * 1.25) : 0;
      lines += Math.max(1, Math.ceil((b.text.length + extra) / CHARS));
    });
    if (!paragraphs.length && t.label) lines = 1;
    total += Math.round(lines * LINE + Math.max(0, paragraphs.length - 1) * 12 + (blocks.length - paragraphs.length) * 34 + 12);
  }
  return total;
}

export const lastPage = (t: { page: number | null; breaks: [number, number][] }) =>
  t.breaks.length ? Math.max(...t.breaks.map(([, page]) => page)) : t.page;
