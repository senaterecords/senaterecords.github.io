import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLinks, checkLinksParallel } from "../../scripts/check-links.mjs";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the link check", () => {
  it("counts a link without the base path as broken when the site has one", () => {
    dir = mkdtempSync(join(tmpdir(), "otr-links-"));
    mkdirSync(join(dir, "about"));
    writeFileSync(join(dir, "about", "index.html"), "<p>About</p>");
    writeFileSync(join(dir, "index.html"), '<a href="/ontherecord/about/">ok</a> <a href="/about/">missing base</a> <a href="https://www.nysenate.gov/">out</a>');
    const { checked, broken } = checkLinks(dir, "/ontherecord/");
    expect(checked).toBe(2);
    expect(broken).toEqual([expect.stringContaining("/about/  (missing the base path")]);
  });

  it("finds nothing wrong with links at the root address", () => {
    dir = mkdtempSync(join(tmpdir(), "otr-links-"));
    mkdirSync(join(dir, "about"));
    writeFileSync(join(dir, "about", "index.html"), "<p>About</p>");
    writeFileSync(join(dir, "index.html"), '<a href="/about/">About</a>');
    expect(checkLinks(dir, "/").broken).toEqual([]);
  });
});

describe("the parallel link check", () => {
  it("finds exactly what the single check finds", async () => {
    dir = mkdtempSync(join(tmpdir(), "otr-links-"));
    for (let i = 0; i < 12; i++) {
      mkdirSync(join(dir, `p${i}`));
      writeFileSync(join(dir, `p${i}`, "index.html"), `<a href="/p${(i + 1) % 12}/">next</a> <a href="/missing-${i}/">gone</a>`);
    }
    const single = checkLinks(dir, "/");
    const parallel = await checkLinksParallel(dir, "/", 3);
    expect(parallel.checked).toBe(single.checked);
    expect(parallel.pages).toBe(single.pages);
    expect([...parallel.broken].sort()).toEqual([...single.broken].sort());
  });
});
