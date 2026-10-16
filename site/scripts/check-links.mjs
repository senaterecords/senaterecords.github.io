// Every internal link, image and script in dist/ must resolve to a built file. Links into a transcript with a
// #r-N (remark) or #pN (page) fragment must also find that anchor, or the reader lands at the top with a notice.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const base = (process.env.SITE_BASE ?? "/").replace(/\/?$/, "/");
const root = "dist";
const ATTR = /\b(?:href|src)=(?:"([^"]+)"|([^\s>"']+))|http-equiv=(?:"refresh"|refresh) content="\d+;\s*url=([^"]+)"/g;

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (name.endsWith(".html")) yield path;
  }
}

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
let pages = 0;
for (const page of htmlFiles(root)) {
  pages += 1;
  const html = readFileSync(page, "utf8");
  for (const m of html.matchAll(ATTR)) {
    const raw = (m[1] ?? m[2] ?? m[3]).replace(/&amp;/g, "&");
    if (!raw.startsWith(base) || raw.startsWith("//")) continue;
    checked += 1;
    const [pathAndQuery, fragment] = raw.split("#");
    const urlPath = pathAndQuery.split("?")[0];
    const file = fileFor(urlPath);
    if (!file) { broken.push(`${raw}  (from ${page})`); continue; }
    if (fragment && /^(r-\d+|p\d+)$/.test(fragment) && urlPath.includes("/transcripts/") && !idsOf(file).has(fragment)) {
      broken.push(`${raw}  (anchor missing; from ${page})`);
    }
  }
}

console.log(`Checked ${checked.toLocaleString("en-US")} internal links in ${pages.toLocaleString("en-US")} pages`);
for (const line of broken.slice(0, 50)) console.log(`  BROKEN ${line}`);
console.log(`${broken.length} broken links`);
if (broken.length) process.exit(1);
