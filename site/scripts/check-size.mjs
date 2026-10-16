// The built site must fit GitHub Pages: warn above 800 MB, refuse above 950 MB (Pages refuses more than 1 GB).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

const root = "dist";
const parts = readdirSync(root).map((name) => ({ name, bytes: size(join(root, name)) })).sort((a, b) => b.bytes - a.bytes);
const total = parts.reduce((n, p) => n + p.bytes, 0);
const mb = (bytes) => (bytes / MB).toFixed(1);

console.log(`Site size: ${mb(total)} MB`);
for (const p of parts.slice(0, 8)) console.log(`  ${p.name.padEnd(16)} ${mb(p.bytes).padStart(8)} MB`);
if (total > STOP_MB * MB) {
  console.log(`ERROR: the site is ${mb(total)} MB; GitHub Pages refuses more than 1 GB, and this build stops at ${STOP_MB} MB`);
  process.exit(1);
}
if (total > WARN_MB * MB) console.log(`WARNING: the site is ${mb(total)} MB (warn at ${WARN_MB} MB)`);
