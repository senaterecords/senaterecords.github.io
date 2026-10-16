import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rewriteAssets, splitSites } from "../../scripts/split-sites.mjs";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (path: string, text: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };

describe("splitting the build into two sites", () => {
  it("points shared assets at the bills site's own copy and leaves links to the main site alone", () => {
    expect(rewriteAssets('<link href=/_astro/a.css><use href="/icons.svg#doc"></use><a href=/transcripts/x/>')).toBe(
      '<link href=/bills/_astro/a.css><use href="/bills/icons.svg#doc"></use><a href=/transcripts/x/>');
    expect(rewriteAssets("@font-face{src:url(/_astro/f.woff2)}")).toBe("@font-face{src:url(/bills/_astro/f.woff2)}");
    expect(rewriteAssets('<script src="/freshness.js"></script>')).toBe('<script src="/bills/freshness.js"></script>');
  });

  it("puts the bill pages, their own assets and a 404 page in the bills site, and everything else in the main site", () => {
    dir = mkdtempSync(join(tmpdir(), "otr-split-"));
    const dist = join(dir, "dist");
    put(join(dist, "index.html"), "<link href=/_astro/a.css>");
    put(join(dist, "_astro", "a.css"), "body{background:url(/_astro/f.woff2)}");
    put(join(dist, "_astro", "f.woff2"), "font");
    put(join(dist, "icons.svg"), "<svg></svg>");
    put(join(dist, "freshness.js"), "window.otrFreshness = () => {};");
    put(join(dist, "404.html"), "<link href=/_astro/a.css>");
    put(join(dist, "bills", "2025", "S1", "index.html"), '<link href=/_astro/a.css><use href="/icons.svg#doc"></use><a href=/transcripts/x/>');
    const { main, bills } = splitSites(dist, join(dir, "out"));
    expect(existsSync(join(main, "bills"))).toBe(false);
    expect(readFileSync(join(main, "_astro", "a.css"), "utf8")).toBe("body{background:url(/_astro/f.woff2)}");
    expect(readFileSync(join(bills, "2025", "S1", "index.html"), "utf8")).toBe(
      '<link href=/bills/_astro/a.css><use href="/bills/icons.svg#doc"></use><a href=/transcripts/x/>');
    expect(readFileSync(join(bills, "_astro", "a.css"), "utf8")).toBe("body{background:url(/bills/_astro/f.woff2)}");
    expect(existsSync(join(bills, "icons.svg"))).toBe(true);
    expect(existsSync(join(bills, "freshness.js"))).toBe(true);
    expect(readFileSync(join(bills, "404.html"), "utf8")).toBe("<link href=/bills/_astro/a.css>");
    expect(existsSync(join(bills, ".nojekyll"))).toBe(true);
  });
});
