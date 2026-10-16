// Copy member photos from the data folder into public/photos (git-ignored) so Astro publishes them.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export function copyPhotos(dataDir = resolve(process.env.OTR_DATA ?? "../data/site")) {
  const to = resolve("public/photos");
  rmSync(to, { recursive: true, force: true });
  if (existsSync(join(dataDir, "photos"))) cpSync(join(dataDir, "photos"), to, { recursive: true });
}

if (process.argv[1]?.endsWith("copy-photos.mjs")) copyPhotos();
