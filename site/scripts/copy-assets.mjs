// Copy what the browser fetches straight from the data folder into public/ (git-ignored) so Astro publishes it:
// member photos, and the word lists behind "Did you mean".
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export function copyAssets(dataDir = resolve(process.env.OTR_DATA ?? "../data/site")) {
  for (const [from, to] of [["photos", "public/photos"], ["words", "public/data/words"]]) {
    const target = resolve(to);
    rmSync(target, { recursive: true, force: true });
    if (existsSync(join(dataDir, from))) cpSync(join(dataDir, from), target, { recursive: true });
  }
}

if (process.argv[1]?.endsWith("copy-assets.mjs")) copyAssets();
