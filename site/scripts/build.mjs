// Build the site from ../data/site (or the committed fixture with --fixture), then index it with Pagefind.
// One Node process, so it behaves the same on Windows and in CI.
import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "astro";
import * as pagefind from "pagefind";
import { copyAssets } from "./copy-assets.mjs";
import { minifyDir } from "./minify-html.mjs";

const fixture = process.argv.includes("--fixture");
process.env.OTR_DATA = resolve(fixture ? "tests/fixtures/data-site" : process.env.OTR_DATA ?? "../data/site");
// Where the bar learns when the Senate's records were last checked (the hourly run writes it to the status branch);
// test builds read a local address that tests fake.
process.env.OTR_STATUS_URL = fixture ? "/__status/checked.json"
  : process.env.OTR_STATUS_URL ?? "https://raw.githubusercontent.com/senaterecords/senaterecords.github.io/status/checked.json";
const started = Date.now();
copyAssets(process.env.OTR_DATA);
rmSync("dist", { recursive: true, force: true });
await build({ root: process.cwd(), logLevel: "warn" });
const { before, after } = minifyDir("dist");
console.log(`Minified HTML: ${(before / 1048576).toFixed(1)} MB to ${(after / 1048576).toFixed(1)} MB`);

const { index, errors } = await pagefind.createIndex({});
if (errors.length) throw new Error(errors.join("\n"));
const added = await index.addDirectory({ path: "dist" });
if (added.errors.length) throw new Error(added.errors.join("\n"));
await index.writeFiles({ outputPath: "dist/pagefind" });
// Pagefind also writes its ready-made search interfaces, which the site never loads.
for (const file of readdirSync("dist/pagefind")) if (/^pagefind-(ui|modular-ui|component-ui|highlight)\./.test(file)) rmSync(`dist/pagefind/${file}`);
await pagefind.close();
console.log(`Built ${added.page_count} searchable pages from ${process.env.OTR_DATA} in ${Math.round((Date.now() - started) / 1000)} s`);
