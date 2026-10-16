// Everyone a speaker: filter or suggestion can name: every senator (with or without a page here, so a shared
// surname always lists all its holders), then the Assembly members who speak in joint hearings.
// Assembly slugs are "assembly:{slug}", the same key the reader's Pagefind filters and remark anchors use.
import type { APIRoute } from "astro";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assembly, DATA_DIR, senators } from "../../lib/data";
import { serviceText } from "../../lib/format";
import type { Person } from "../../lib/names";
import { url } from "../../lib/url";

const latest = (sessions: Record<string, number | null>) =>
  Object.entries(sessions).sort((a, b) => Number(b[0]) - Number(a[0])).find(([, d]) => d != null)?.[1] ?? null;
const photo = (p: string | null) => (p && existsSync(join(DATA_DIR, p)) ? url(p) : null);

export const GET: APIRoute = () => {
  const people: Person[] = [
    ...senators().map((s) => {
      const district = latest(s.sessions);
      return { slug: s.slug, name: s.name, chamber: "senate" as const, photo: photo(s.photo),
        detail: [district ? `District ${district}` : "", serviceText(s.service)].filter(Boolean).join(" · "), remarks: s.remarks };
    }),
    ...Object.entries(assembly()).map(([slug, a]) => {
      const district = latest(a.sessions);
      return { slug: `assembly:${slug}`, name: a.name, chamber: "assembly" as const, photo: photo(a.photo),
        detail: district ? `Member of the Assembly · District ${district}` : "Member of the Assembly", remarks: 0 };
    }),
  ];
  return new Response(JSON.stringify(people), { headers: { "Content-Type": "application/json" } });
};
