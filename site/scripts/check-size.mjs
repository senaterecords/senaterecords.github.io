// Each GitHub Pages site must stay under 1 GB: warn above 800 MB, refuse above 950 MB. The bill pages (/bills/) are
// published as their own site (a second repository served at /bills/ on the same address), so the main site and the
// bills site are weighed separately.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WARN_MB = 800;
const STOP_MB = 950;
const MB = 1024 * 1024;

function size(path) {
  const info = statSync(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of readdirSync(path)) total += size(join(path, name));
  return total;
}

export function siteSizes(root) {
  const parts = readdirSync(root).filter((name) => name !== "bills")
    .map((name) => ({ name, bytes: size(join(root, name)) })).sort((a, b) => b.bytes - a.bytes);
  const bills = existsSync(join(root, "bills")) ? size(join(root, "bills")) : 0;
  return { main: { bytes: parts.reduce((n, p) => n + p.bytes, 0), parts }, bills: { bytes: bills } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { main, bills } = siteSizes("dist");
  const mb = (bytes) => (bytes / MB).toFixed(1);
  console.log(`Main site: ${mb(main.bytes)} MB`);
  for (const p of main.parts.slice(0, 8)) console.log(`  ${p.name.padEnd(16)} ${mb(p.bytes).padStart(8)} MB`);
  console.log(`Bills site (/bills/): ${mb(bills.bytes)} MB`);
  console.log(`Together: ${mb(main.bytes + bills.bytes)} MB`);
  let failed = false;
  for (const [name, bytes] of [["main site", main.bytes], ["bills site", bills.bytes]]) {
    if (bytes > STOP_MB * MB) {
      console.log(`ERROR: the ${name} is ${mb(bytes)} MB; GitHub Pages refuses more than 1 GB, and this build stops at ${STOP_MB} MB`);
      failed = true;
    } else if (bytes > WARN_MB * MB) console.log(`WARNING: the ${name} is ${mb(bytes)} MB (warn at ${WARN_MB} MB)`);
  }
  if (failed) process.exit(1);
}
