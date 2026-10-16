// After a deploy, check that the live sites answer: the main site (homepage, search, the search index, a transcript)
// and the bills site (its index, the newest session, a bill page and that page's own stylesheet, which must come from
// the bills site itself). A fresh Pages deploy can take up to 10 minutes to appear, so the whole check is retried.
// usage: node scripts/check-live.mjs https://senaterecords.github.io/
import { pathToFileURL } from "node:url";

const HREF = /\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
const links = (html) => [...html.matchAll(HREF)].map((m) => m[1] ?? m[2] ?? m[3]);
const stylesheet = (html) => {
  const tag = html.match(/<link\b[^>]*\brel=["']?stylesheet\b[^>]*>/)?.[0];
  return tag ? links(tag)[0] ?? null : null;
};

async function checkOnce(base) {
  const problems = [];
  const get = async (path) => {
    const url = new URL(path, base).href;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.text();
      problems.push(`${url} answered ${res.status}`);
    } catch (error) {
      problems.push(`${url} could not be fetched (${error.message})`);
    }
    return null;
  };

  const home = await get("./");
  if (home !== null) {
    // The title, not the site's name, which may still change.
    if (!/<title>[^<]+<\/title>/.test(home)) problems.push(`${base} has no title`);
    const transcript = links(home).find((href) => /\/transcripts\/[^/#?]+\/$/.test(href));
    if (transcript) await get(transcript);
    else problems.push(`${base} links no transcript`);
  }
  await get("search/");
  await get("pagefind/pagefind.js");

  const bills = await get("bills/");
  if (bills === null) return problems;
  const session = links(bills).filter((href) => /\/bills\/\d{4}\/$/.test(href))
    .sort((a, b) => Number(b.match(/(\d{4})\/$/)[1]) - Number(a.match(/(\d{4})\/$/)[1]))[0];
  if (!session) { problems.push(`${new URL("bills/", base).href} links no session`); return problems; }
  const sessionPage = await get(session);
  if (sessionPage === null) return problems;
  const bill = links(sessionPage).find((href) => /\/bills\/\d{4}\/[^/#?]+\/$/.test(href));
  if (!bill) { problems.push(`${new URL(session, base).href} links no bill`); return problems; }
  const billPage = await get(bill);
  if (billPage === null) return problems;
  const css = stylesheet(billPage);
  if (!css || !css.includes("/bills/_astro/")) problems.push(`${new URL(bill, base).href} does not use the bills site's own stylesheet (${css ?? "none"})`);
  else await get(css);
  return problems;
}

/** Problems found on the live sites at base (empty when healthy), after up to `tries` attempts `wait` ms apart. */
export async function checkLive(base, { tries = 20, wait = 30_000 } = {}) {
  const root = base.replace(/\/?$/, "/");
  let problems = [];
  for (let attempt = 1; attempt <= tries; attempt++) {
    problems = await checkOnce(root);
    if (!problems.length) return [];
    if (attempt < tries) await new Promise((done) => setTimeout(done, wait));
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const base = process.argv[2] ?? "https://senaterecords.github.io/";
  const problems = await checkLive(base);
  for (const line of problems) console.log(`  PROBLEM ${line}`);
  console.log(problems.length ? `${problems.length} problems on ${base}` : `${base} and its bills site answer`);
  if (problems.length) process.exit(1);
}
