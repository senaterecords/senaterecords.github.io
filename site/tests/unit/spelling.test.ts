import { describe, expect, it } from "vitest";
import { closestWord, editDistance } from "../../src/lib/spelling";

describe("did you mean", () => {
  it("counts edits between words", () => {
    expect(editDistance("budgett", "budget")).toBe(1);
    expect(editDistance("bugdet", "budget")).toBe(2);
    expect(editDistance("tax", "tax")).toBe(0);
  });

  it("suggests the most used word within two edits", () => {
    const counts = { budget: 9000, budgets: 400, budgeted: 80, bridget: 3 };
    expect(closestWord("budgett", counts)).toBe("budget");
    expect(closestWord("budget", counts)).toBeNull();
    expect(closestWord("zzzz", counts)).toBeNull();
    // The word lists hold words of four letters or more; shorter words are never "corrected" (and is not andy).
    expect(closestWord("and", { andy: 201 })).toBeNull();
    expect(closestWord("the", { thee: 3 })).toBeNull();
  });
});
