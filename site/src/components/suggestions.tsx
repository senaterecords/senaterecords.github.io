// Suggestions for the shortcut being typed (spec 9.1, "Homepage: typing speaker:"). Data loads on first use and
// stays cached in memory.
import { useEffect, useState, type ReactNode } from "react";
import { jsonCache } from "../lib/fetch";
import { findPeople, fold, type Person } from "../lib/names";
import { SHORTCUTS, tokenAt, type Token } from "../lib/suggest";
import { url } from "../lib/url";

export interface Suggestion { id: string; label: ReactNode; detail?: string; count?: string; photo?: string | null; person?: boolean; value: string; trailingSpace: boolean; }
export interface SuggestionGroup { heading?: string; items: Suggestion[]; }

const load = jsonCache(url);

const HINT: Record<string, string> = {
  speaker: "a senator's or Assembly member's remarks", senator: "a senator's remarks", year: "one year or a range", bill: "transcripts that mention a bill",
  type: "hearings or floor sessions", committee: "one committee's hearings",
};
const count = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

function highlight(name: string, ranges: [number, number][]): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => { out.push(name.slice(at, s), <b key={i}>{name.slice(s, e)}</b>); at = e; });
  out.push(name.slice(at));
  return out;
}

async function suggest(token: Token): Promise<SuggestionGroup[]> {
  if (!token.field) {
    const typed = token.text.toLowerCase();
    return [{ items: SHORTCUTS.filter((f) => f.startsWith(typed)).map((f) => ({
      id: `field-${f}`, label: <code>{f}:</code>, detail: HINT[f], value: `${f}:`, trailingSpace: false,
    })) }];
  }
  const text = token.text.trim();
  if (token.field === "speaker" || token.field === "senator") {
    if (!text) return [];
    const field = token.field;
    const people = (await load<Person[]>("/data/people.json")).filter((p) => field === "speaker" || p.chamber === "senate");
    const matches = findPeople(text, people, 8);
    const row = ({ person, ranges }: (typeof matches)[number]): Suggestion => ({
      id: `p-${person.slug}`, label: highlight(person.name, ranges), detail: person.detail, photo: person.photo, person: true,
      count: person.remarks ? count(person.remarks, "remark") : undefined, value: `${field}:${person.slug}`, trailingSpace: true,
    });
    return [
      { heading: "Senators", items: matches.filter((m) => m.person.chamber === "senate").map(row) },
      { heading: "Assembly · speaks in joint hearings", items: matches.filter((m) => m.person.chamber === "assembly").map(row) },
    ];
  }
  if (token.field === "year") {
    const years = await load<{ year: number; count: number }[]>("/data/years.json");
    return [{ items: years.filter((y) => String(y.year).startsWith(text)).slice(0, 8).map((y) => ({
      id: `y-${y.year}`, label: String(y.year), count: count(y.count, "transcript"), value: `year:${y.year}`, trailingSpace: true,
    })) }];
  }
  if (token.field === "bill") {
    const typed = text.split("/")[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
    const m = typed.match(/^([SA])(\d+)/);
    if (!m) return [];
    const prefix = m[1] + m[2].slice(0, 2);
    let rows: { printNo: string; session: number; title: string | null }[] = [];
    try { rows = await load(`/data/bill-index/${prefix}.json`); } catch { return []; }
    const seen = new Set<string>();
    return [{ items: rows.filter((r) => r.printNo.toUpperCase().startsWith(typed)).filter((r) => {
      const key = `${r.session}-${r.printNo}`;
      return seen.has(key) ? false : (seen.add(key), true);
    }).slice(0, 8).map((r) => ({
      id: `b-${r.session}-${r.printNo}`, label: r.printNo, detail: [`${r.session}–${String(r.session + 1).slice(2)}`, r.title].filter(Boolean).join(" · "),
      // The row names a session, so picking it searches that session's bill, not every bill with the number.
      value: `bill:${r.printNo.match(/^[SA]\d+/)?.[0] ?? r.printNo}/${r.session}`, trailingSpace: true,
    })) }];
  }
  if (token.field === "type") {
    return [{ items: [["floor", "Floor sessions"], ["hearing", "Public hearings"]].filter(([v, l]) => !text || v.startsWith(text.toLowerCase()) || l.toLowerCase().startsWith(text.toLowerCase())).map(([v, l]) => ({
      id: `t-${v}`, label: l, value: `type:${v}`, trailingSpace: true,
    })) }];
  }
  const committees = await load<{ name: string; count: number }[]>("/data/committees.json");
  const typed = fold(text);
  return [{ items: committees.filter((c) => !typed || fold(c.name).split(" ").some((w) => w.startsWith(typed)) || fold(c.name).startsWith(typed)).slice(0, 8).map((c) => ({
    id: `c-${c.name}`, label: c.name, count: count(c.count, "hearing"), value: `committee:${quote(c.name)}`, trailingSpace: true,
  })) }];
}

/** The suggestion groups for the caret's token; empty when nothing applies. */
export function useSuggestions(value: string, caret: number | null, enabled: boolean): { token: Token | null; groups: SuggestionGroup[] } {
  const [state, setState] = useState<{ token: Token | null; groups: SuggestionGroup[] }>({ token: null, groups: [] });
  useEffect(() => {
    const token = enabled && caret != null ? tokenAt(value, caret) : null;
    if (!token) { setState({ token: null, groups: [] }); return; }
    let live = true;
    suggest(token).then(
      (groups) => { if (live) setState({ token, groups: groups.filter((g) => g.items.length) }); },
      () => { if (live) setState({ token: null, groups: [] }); },
    );
    return () => { live = false; };
  }, [value, caret, enabled]);
  return state;
}
