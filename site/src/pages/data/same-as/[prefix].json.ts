// For bill: searches, each bill's same-as bills by session, both ways ("A10379": [[2025, "S9051"]]): the Senate's
// record of an Assembly bill is often only its same-as, which an Assembly bill the Senate never names has no record of.
// One small file per chamber letter and first two digits (A10.json), like the bill index.
import type { APIRoute } from "astro";
import { bill, billPages } from "../../../lib/data";

const prefixOf = (base: string) => base.slice(0, base.length > 2 ? 3 : 2);
const baseOf = (printNo: string) => printNo.match(/^[SA]\d+/)?.[0] ?? null;

export function getStaticPaths() {
  const pairs = new Map<string, Map<string, [number, string][]>>();
  const add = (base: string, session: number, other: string) => {
    if (base === other) return;
    const group = pairs.get(prefixOf(base)) ?? new Map<string, [number, string][]>();
    const list = group.get(base) ?? [];
    if (!list.some(([s, b]) => s === session && b === other)) list.push([session, other]);
    group.set(base, list);
    pairs.set(prefixOf(base), group);
  };
  for (const p of billPages()) {
    for (const printNo of bill(p.session, p.base)?.card?.sameAs ?? []) {
      const other = baseOf(printNo);
      if (!other) continue;
      add(p.base, p.session, other);
      add(other, p.session, p.base);
    }
  }
  return [...pairs].map(([prefix, group]) => ({
    params: { prefix },
    props: { rows: Object.fromEntries([...group].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) },
  }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.rows), { headers: { "Content-Type": "application/json" } });
