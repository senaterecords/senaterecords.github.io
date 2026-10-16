// Which shortcut is being typed at the caret, and replacing it with the picked suggestion (spec 9.1).

export const SHORTCUTS = ["speaker", "year", "bill", "type", "committee"] as const;
export type Field = (typeof SHORTCUTS)[number];
export interface Token { field: Field | null; text: string; start: number; end: number; }

/** The shortcut at the caret ("speaker:krue"), or the start of a shortcut's name ("ye"); null otherwise. */
export function tokenAt(value: string, caret: number): Token | null {
  const before = value.slice(0, caret);
  const restWord = () => value.slice(caret).match(/^\S*/)![0].length;
  const m = before.match(/(^|\s)(speaker|year|bill|type|committee):("[^"]*|\S*)$/i);
  if (m) {
    const quoted = m[3].startsWith('"');
    return { field: m[2].toLowerCase() as Field, text: m[3].replace(/^"/, ""), start: m.index! + m[1].length, end: quoted ? caret : caret + restWord() };
  }
  const w = before.match(/(^|\s)([a-z]{2,})$/i);
  if (w && SHORTCUTS.some((f) => f.startsWith(w[2].toLowerCase()))) {
    return { field: null, text: w[2], start: w.index! + w[1].length, end: caret + restWord() };
  }
  return null;
}

export function replaceToken(value: string, token: { start: number; end: number }, replacement: string, trailingSpace: boolean) {
  const rest = value.slice(token.end);
  const space = trailingSpace && !rest.startsWith(" ") ? " " : "";
  return { value: value.slice(0, token.start) + replacement + space + rest, caret: token.start + replacement.length + (trailingSpace ? 1 : 0) };
}
