import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { siteSizes } from "../../scripts/check-size.mjs";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the size check", () => {
  it("weighs the bill pages as their own site and everything else as the main site", () => {
    dir = mkdtempSync(join(tmpdir(), "otr-size-"));
    mkdirSync(join(dir, "transcripts"));
    mkdirSync(join(dir, "bills", "2025"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "x".repeat(10));
    writeFileSync(join(dir, "transcripts", "a.html"), "x".repeat(30));
    writeFileSync(join(dir, "bills", "2025", "b.html"), "x".repeat(20));
    const { main, bills } = siteSizes(dir);
    expect(main.bytes).toBe(40);
    expect(bills.bytes).toBe(20);
    expect(main.parts.map((p) => p.name)).toEqual(["transcripts", "index.html"]);
  });
});
