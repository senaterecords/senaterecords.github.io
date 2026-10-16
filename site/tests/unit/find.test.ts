import { describe, expect, it } from "vitest";
import { findAll, foldForFind, locate } from "../../src/lib/find";

describe("finding words in a transcript", () => {
  it("ignores capitals and accents, keeping every character in place", () => {
    expect(foldForFind("Sepúlveda SAID Ñ")).toBe("sepulveda said n");
    expect(foldForFind("Sepúlveda").length).toBe("Sepúlveda".length);
  });

  it("finds every place a phrase occurs, up to a limit", () => {
    const text = foldForFind("The budget, the BUDGET and the budgets.");
    expect(findAll(text, foldForFind("budget"), 10)).toEqual([4, 16, 31]);
    expect(findAll(text, foldForFind("budget"), 2)).toEqual([4, 16]);
    expect(findAll(text, "", 10)).toEqual([]);
  });

  it("maps a match back to the pieces of text it spans", () => {
    // "Senate Bill 4611" where "4611" is a link: three pieces of text, joined.
    const starts = [0, 12, 16];
    expect(locate(starts, 7)).toEqual({ piece: 0, offset: 7 });
    expect(locate(starts, 12)).toEqual({ piece: 1, offset: 0 });
    expect(locate(starts, 17)).toEqual({ piece: 2, offset: 1 });
  });
});
