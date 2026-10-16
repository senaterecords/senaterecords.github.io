import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonCache } from "../../src/lib/fetch";

afterEach(() => vi.unstubAllGlobals());

describe("cached JSON", () => {
  it("asks once for a file that loaded, and again for one that failed", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 503 }) : new Response('{"ok":true}');
    });
    const load = jsonCache((path) => path);
    await expect(load("/data/people.json")).rejects.toThrow("503");
    await expect(load("/data/people.json")).resolves.toEqual({ ok: true });
    await expect(load("/data/people.json")).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
