// Every internal link, image and script in dist/ must resolve to a built file. Links into a transcript with a
// #r-N (remark) or #pN (page) fragment must also find that anchor, or the reader lands at the top with a notice.
// Under a base path, a link to "/…" that leaves the base out is broken too: it would point outside the site.
// The pages are shared out among worker threads, one per spare processor core.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const ATTR = /\b(?:href|src)=(?:"([^"]+)"|([^\s>"']+))|http-equiv=(?:"refresh"|refresh) content="\d+;\s*url=([^"]+)"/g;

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (name.endsWith(".html")) yield path;
  }
}

/** Check the links on some pages of the built site at root. */
export function checkPages(root, siteBase, pages) {
  const base = siteBase.replace(/\/?$/, "/");
  const fileFor = (urlPath) => {
    const rel = decodeURIComponent(urlPath.slice(base.length));
    const direct = join(root, rel);
    if (rel && existsSync(direct) && statSync(direct).isFile()) return direct;
    const index = join(root, rel, "index.html");
    return existsSync(index) ? index : null;
  };
  const ids = new Map();
  const idsOf = (file) => {
    if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, "utf8").matchAll(/\bid=(?:"([^"]+)"|([^\s>"']+))/g)].map((m) => m[1] ?? m[2])));
    return ids.get(file);
  };

  const broken = [];
  let checked = 0;
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    for (const m of html.matchAll(ATTR)) {
      const raw = (m[1] ?? m[2] ?? m[3]).replace(/&amp;/g, "&");
      if (!raw.startsWith("/") || raw.startsWith("//")) continue;
      checked += 1;
      if (!raw.startsWith(base)) { broken.push(`${raw}  (missing the base path ${base}; from ${page})`); continue; }
      const [pathAndQuery, fragment] = raw.split("#");
      const urlPath = pathAndQuery.split("?")[0];
      const file = fileFor(urlPath);
      if (!file) { broken.push(`${raw}  (from ${page})`); continue; }
      if (fragment && /^(r-\d+|p\d+)$/.test(fragment) && urlPath.includes("/transcripts/") && !idsOf(file).has(fragment)) {
        broken.push(`${raw}  (anchor missing; from ${page})`);
      }
    }
  }
  return { checked, pages: pages.length, broken };
}

export const checkLinks = (root, siteBase) => checkPages(root, siteBase, [...htmlFiles(root)]);

/** The same check as checkLinks, with the pages shared out among worker threads. */
export async function checkLinksParallel(root, siteBase, workers = Math.max(1, availableParallelism() - 1)) {
  const pages = [...htmlFiles(root)];
  const size = Math.ceil(pages.length / workers) || 1;
  const parts = Array.from({ length: Math.ceil(pages.length / size) }, (_, i) => pages.slice(i * size, (i + 1) * size));
  const results = await Promise.all(parts.map((part) => new Promise((done, fail) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { root, siteBase, part } });
    worker.once("message", done);
    worker.once("error", fail);
    // A worker killed without an error (out of memory) would otherwise leave the check waiting forever.
    worker.once("exit", (code) => { if (code !== 0) fail(new Error(`a link check worker stopped (exit code ${code})`)); });
  })));
  return results.reduce((all, r) => ({ checked: all.checked + r.checked, pages: all.pages + r.pages, broken: [...all.broken, ...r.broken] }),
    { checked: 0, pages: 0, broken: [] });
}

if (!isMainThread && workerData?.part) parentPort.postMessage(checkPages(workerData.root, workerData.siteBase, workerData.part));

// A worker sees the same command line as the main thread, so only the main thread runs the command.
if (isMainThread && import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { checked, pages, broken } = await checkLinksParallel("dist", process.env.SITE_BASE ?? "/");
  console.log(`Checked ${checked.toLocaleString("en-US")} internal links in ${pages.toLocaleString("en-US")} pages`);
  for (const line of broken.slice(0, 50)) console.log(`  BROKEN ${line}`);
  console.log(`${broken.length} broken links`);
  if (broken.length) process.exit(1);
}
