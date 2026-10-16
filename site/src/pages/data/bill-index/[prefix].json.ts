// Bill numbers for the bill: suggestions, one small file per chamber letter and first two digits (S50.json).
import type { APIRoute } from "astro";
import { bill, billPages } from "../../../lib/data";

const prefixOf = (base: string) => base.slice(0, base.length > 2 ? 3 : 2);

export function getStaticPaths() {
  const groups = new Map<string, { printNo: string; session: number; title: string | null }[]>();
  for (const p of billPages()) {
    const key = prefixOf(p.base);
    const rows = groups.get(key) ?? [];
    rows.push({ printNo: p.printNo, session: p.session, title: bill(p.session, p.base)?.card?.title ?? null });
    groups.set(key, rows);
  }
  return [...groups].map(([prefix, rows]) => ({
    params: { prefix },
    props: { rows: rows.sort((a, b) => b.session - a.session || a.printNo.localeCompare(b.printNo, "en", { numeric: true })) },
  }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.rows), { headers: { "Content-Type": "application/json" } });
