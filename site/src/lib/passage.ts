// The passage a search result showed travels in its link (?hl=first words|last words), so the transcript can land on
// that passage and wash it yellow for a moment, as a search engine does.

const EDGE = 8;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The link's name for a passage: all of a short one, or its first and last words. */
export function passageParam(excerpt: string): string {
  const words = excerpt.replace(/^…\s*|\s*…$/g, "").trim().split(/\s+/).filter(Boolean);
  return words.length > EDGE * 2 ? `${words.slice(0, EDGE).join(" ")}|${words.slice(-EDGE).join(" ")}` : words.join(" ");
}

/** Where the named passage is in a text, ignoring case and spacing; null when it is not there. */
export function locatePassage(text: string, param: string): [number, number] | null {
  const [start, end] = param.split("|");
  const find = (words: string, from: number): [number, number] | null => {
    const parts = words.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    const m = new RegExp(parts.map(escapeRegex).join("\\s+"), "i").exec(text.slice(from));
    return m ? [from + m.index, from + m.index + m[0].length] : null;
  };
  const first = find(start ?? "", 0);
  if (!first) return null;
  const last = end ? find(end, first[1]) : null;
  return last ? [first[0], last[1]] : first;
}
