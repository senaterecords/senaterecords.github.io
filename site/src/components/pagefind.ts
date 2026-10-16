// Pagefind on the search page: loading it, running a branch's searches, and reading a page's text.
import { pagefindTerms, type PageFilters, type Terms } from "../lib/query";
import { url } from "../lib/url";

export interface PageData {
  url: string; content: string; meta: Record<string, string>; filters?: PageFilters;
  anchors: { element: string; id: string; text: string; location: number }[];
}
export interface PagefindResult { id: string; data: () => Promise<PageData>; }
export interface PagefindSearch { results: PagefindResult[]; filters: Record<string, Record<string, number>>; }
export interface Pagefind {
  options: (o: Record<string, unknown>) => Promise<void>;
  filters: () => Promise<Record<string, Record<string, number>>>;
  search: (term: string | null, o: Record<string, unknown>) => Promise<PagefindSearch>;
}

// Pagefind logs a failed index download and carries on with fewer results. It runs on the page rather than in its
// worker so its downloads can be watched: a failure then says search couldn't load, not a false "No remarks match".
let failed = false;
let watching = false;
export const indexFailed = () => failed;
function watchIndexDownloads() {
  if (watching) return;
  watching = true;
  const plain = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const watched = /\/pagefind\/(index|filter)\//.test(href);
    try {
      const response = await plain(input, init);
      if (watched && !response.ok) failed = true;
      return response;
    } catch (error) {
      if (watched) failed = true;
      throw error;
    }
  };
}

let pagefindPromise: Promise<Pagefind> | null = null;
export function loadPagefind(): Promise<Pagefind> {
  pagefindPromise ??= import(/* @vite-ignore */ url("/pagefind/pagefind.js")).then(async (pf: Pagefind) => {
    watchIndexDownloads();
    await pf.options({ baseUrl: url("/"), noWorker: true });
    await pf.filters(); // loads the filter index, without which searches return no facet counts
    return pf;
  });
  pagefindPromise.catch(() => (pagefindPromise = null));
  return pagefindPromise;
}

/** One branch's transcripts: each phrase searched exactly and the other words together, keeping the transcripts
 * every search found, in the first search's order. Facet counts come from the first search. */
export async function searchBranch(pf: Pagefind, b: Terms, options: Record<string, unknown>): Promise<PagefindSearch> {
  const searches = await Promise.all(pagefindTerms(b).map((term) => pf.search(term || null, options)));
  if (searches.length === 1) return searches[0];
  const inAll = searches.slice(1).map((s) => new Set(s.results.map((r) => r.id)));
  return { results: searches[0].results.filter((r) => inAll.every((ids) => ids.has(r.id))), filters: searches[0].filters };
}

const SIGNATURE = "pagefind_dcd";

/** A page's text, meta and anchors, read straight from its Pagefind fragment with the browser's own gzip. Pagefind's
 * data() also builds excerpts and sub-results the site never shows: about 340 ms per long transcript, measured on the
 * real build, against about 10 ms this way. An unexpected fragment falls back to Pagefind's own reader. */
export async function readFragment(r: PagefindResult): Promise<PageData> {
  if (typeof DecompressionStream === "undefined") return r.data();
  const response = await fetch(url(`/pagefind/fragment/${r.id}.pf_fragment`));
  if (!response.ok) throw new Error(`fragment ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const decoder = new TextDecoder();
  let text = decoder.decode(bytes.subarray(0, SIGNATURE.length)) === SIGNATURE ? decoder.decode(bytes) : null;
  if (text == null) {
    try {
      text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    } catch {
      return r.data();
    }
  }
  if (!text.startsWith(SIGNATURE)) return r.data();
  const page = JSON.parse(text.slice(SIGNATURE.length)) as PageData;
  // As Pagefind's data() does: zero-width spaces out of the text, and the page address under the site's base.
  return { ...page, content: page.content.replace(/​/g, ""), url: url(page.url) };
}
