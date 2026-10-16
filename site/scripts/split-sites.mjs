// Split the build into the two GitHub Pages sites: the main site (everything but /bills/) and the bills site, which
// is published at /bills/ from its own repository. The bills site carries its own copy of the shared assets
// (scripts, styles, fonts, icons), so its pages never depend on the main site's current file names.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// "/_astro/…" and "/icons.svg" after a quote, "=", "(" or space: attribute values (quoted or not) and CSS url().
const SHARED = /(["'(=\s])\/(_astro\/|icons\.svg)/g;

export const rewriteAssets = (text) => text.replace(SHARED, "$1/bills/$2");

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

export function splitSites(dist, out) {
  const main = join(out, "main");
  const bills = join(out, "bills");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(main, { recursive: true });
  for (const name of readdirSync(dist)) if (name !== "bills") cpSync(join(dist, name), join(main, name), { recursive: true });
  cpSync(join(dist, "bills"), bills, { recursive: true });
  cpSync(join(dist, "_astro"), join(bills, "_astro"), { recursive: true });
  for (const name of ["icons.svg", "404.html"]) if (existsSync(join(dist, name))) cpSync(join(dist, name), join(bills, name));
  writeFileSync(join(bills, ".nojekyll"), ""); // a plain static site: no Jekyll processing on the gh-pages branch
  for (const file of files(bills)) {
    if (!/\.(html|css|js)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const next = rewriteAssets(text);
    if (next !== text) writeFileSync(file, next);
  }
  return { main, bills };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [dist = "dist", out = "../out"] = process.argv.slice(2);
  const { main, bills } = splitSites(dist, out);
  console.log(`Main site: ${main}\nBills site: ${bills}`);
}
