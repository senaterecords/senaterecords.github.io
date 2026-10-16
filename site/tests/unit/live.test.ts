import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLive } from "../../scripts/check-live.mjs";

// A fake of the two live sites, written the way the build writes pages (unquoted attributes, links from the root).
const pages: Record<string, string> = {
  "/": "<title>On the Record</title><a href=/transcripts/2026-06-04-regular-session/>June 4</a>",
  "/search/": "<h1>Search</h1>",
  "/pagefind/pagefind.js": "export {}",
  "/transcripts/2026-06-04-regular-session/": "<h1>June 4</h1>",
  "/bills/": "<a href=/bills/1993/>1993</a> <a href=/bills/2025/>2025</a>",
  "/bills/2025/": "<a href=/bills/>Bills</a> <a href=/bills/2025/S1/>S1</a>",
  "/bills/2025/S1/": "<link rel=stylesheet href=/bills/_astro/a.css><h1>S1</h1>",
  "/bills/_astro/a.css": "body{}",
};
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = pages[req.url ?? ""];
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "text/html" });
    res.end(body ?? "Not found");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe("the live site check", () => {
  it("passes when both sites answer, down to a bill page's own stylesheet", async () => {
    expect(await checkLive(base, { tries: 1, wait: 0 })).toEqual([]);
  });

  it("names what is missing, like a bill page whose stylesheet is gone", async () => {
    const css = pages["/bills/_astro/a.css"];
    delete pages["/bills/_astro/a.css"];
    try {
      const problems = await checkLive(base, { tries: 1, wait: 0 });
      expect(problems).toEqual([expect.stringContaining("/bills/_astro/a.css")]);
    } finally {
      pages["/bills/_astro/a.css"] = css;
    }
  });

  it("flags a bill page that still borrows the main site's stylesheet", async () => {
    const page = pages["/bills/2025/S1/"];
    pages["/bills/2025/S1/"] = "<link rel=stylesheet href=/_astro/a.css><h1>S1</h1>";
    try {
      const problems = await checkLive(base, { tries: 1, wait: 0 });
      expect(problems).toEqual([expect.stringContaining("/bills/2025/S1/")]);
    } finally {
      pages["/bills/2025/S1/"] = page;
    }
  });
});
