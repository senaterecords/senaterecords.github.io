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

export type Part = string | { page: number };
export type Paragraph = { kind: "p"; parts: Part[] } | { kind: "pb"; page: number };

/**
 * Paragraphs with their page breaks. A break that falls mid-paragraph stays inside that paragraph, so the
 * sentence remains one block for search and copying; a break between paragraphs stands on its own.
 */
export function turnParagraphs(text: string, breaks: [number, number][]): Paragraph[] {
  const sorted = [...breaks].sort((a, b) => a[0] - b[0]);
  const pieces: { raws: string[]; page: number | null }[] = [];
  let from = 0;
  for (const [offset, page] of sorted) {
    pieces.push({ raws: text.slice(from, offset).split(/\n\s*\n/), page });
    from = offset;
  }
  pieces.push({ raws: text.slice(from).split(/\n\s*\n/), page: null });
  const clean = (raw: string) => raw.replace(/\s*\n\s*/g, " ").trim();

  const out: Paragraph[] = [];
  let current: { kind: "p"; parts: Part[] } | null = null;
  const close = () => { if (current?.parts.length) out.push(current); current = null; };
  pieces.forEach(({ raws, page }, k) => {
    raws.forEach((raw, i) => {
      if (i > 0) close();
      const t = clean(raw);
      if (t) (current ??= { kind: "p", parts: [] }).parts.push(t);
    });
    if (page == null) return;
    const continues = clean(pieces[k + 1]?.raws[0] ?? "") !== "";
    if (current && continues) current.parts.push({ page });
    else { close(); out.push({ kind: "pb", page }); }
  });
  close();
  return out;
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

// How the record names a bill: "Senate Print 4597-A", "Assembly Bill Number 7594C", "Senate Bill No. 12".
// "Senate Print 4597-A" and the like ("bill", "print" and "number" sometimes written small), or a print number written compactly ("S9051B", "S1507-C"), as the pipeline
// reads them (nyleg.bills): three digits or more standing alone, so "Class A1" or an Airbus A320 stay plain text.
const BILL_REF = /\b(Senate|Assembly)\s+(?:[Pp]rint|[Bb]ill)(?:\s+(?:[Nn]umber|[Nn]o\.?))?\s+(\d{1,5})(?!\d)(?:-?[A-Z]\b)?|(?<![\w-])(?<!Airbus )([SA])(\d{3,5})(?:-?[A-Z])?(?![\w-])/g;

/** The bill names in a text, each with its base print number (S4597), for linking to the bill's page. */
export function billRefs(text: string): { start: number; end: number; base: string }[] {
  return [...text.matchAll(BILL_REF)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    base: m[1] ? `${m[1] === "Senate" ? "S" : "A"}${m[2]}` : `${m[3]}${Number(m[4])}`,
  }));
}

