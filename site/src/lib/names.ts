// Matching people by any part of their name, ignoring case, accents and apostrophes (spec 9.1).

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface Person {
  slug: string;
  name: string;
  chamber: "senate" | "assembly";
  photo: string | null;
  detail: string;
  remarks: number;
}

interface Token { start: number; end: number; folded: string; }

function tokens(name: string): Token[] {
  const out: Token[] = [];
  for (const m of name.matchAll(/[^\s-]+/g)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, folded: fold(m[0]).replace(/ /g, "") });
  }
  return out;
}

/** How many original characters cover the first `n` folded characters of a token (é is one, ' is none). */
function span(name: string, token: Token, n: number): number {
  let seen = 0;
  let i = token.start;
  while (i < token.end && seen < n) {
    seen += fold(name[i]).replace(/ /g, "").length;
    i++;
  }
  return i - token.start;
}

/** Each query word must start a later part of the name, in order. Returns highlight ranges or null. */
export function matchName(query: string, name: string): [number, number][] | null {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return null;
  const parts = tokens(name);
  const ranges: [number, number][] = [];
  let from = 0;
  for (const word of words) {
    const found = parts.findIndex((t, i) => i >= from && t.folded.startsWith(word));
    if (found < 0) return null;
    ranges.push([parts[found].start, parts[found].start + span(name, parts[found], word.length)]);
    from = found + 1;
  }
  return ranges;
}

function byRank(a: Person, b: Person): number {
  if (a.chamber !== b.chamber) return a.chamber === "senate" ? -1 : 1;
  return b.remarks - a.remarks;
}

export function findPeople(query: string, people: Person[], limit = 8): { person: Person; ranges: [number, number][] }[] {
  const hits: { person: Person; ranges: [number, number][] }[] = [];
  for (const person of people) {
    const ranges = matchName(query, person.name);
    if (ranges) hits.push({ person, ranges });
  }
  return hits.sort((a, b) => byRank(a.person, b.person)).slice(0, limit);
}

/** An exact slug wins; otherwise everyone who matches, so the caller can ask "Which Smith?". */
export function resolveSpeaker(value: string, people: Person[]): Person[] {
  const exact = people.find((p) => p.slug === value);
  if (exact) return [exact];
  return findPeople(value, people, people.length).map((m) => m.person);
}
