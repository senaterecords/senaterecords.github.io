// Committees that held public hearings, with hearing counts, named exactly as the reader's committee: filters.
import type { APIRoute } from "astro";
import { transcriptIndex } from "../../lib/data";
import { hearingTitle } from "../../lib/format";

export const GET: APIRoute = () => {
  const counts = new Map<string, number>();
  for (const t of transcriptIndex()) {
    if (t.kind !== "hearing") continue;
    for (const c of t.committees) counts.set(hearingTitle(c), (counts.get(hearingTitle(c)) ?? 0) + 1);
  }
  const rows = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
};
