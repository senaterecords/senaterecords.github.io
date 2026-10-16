import { describe, expect, it } from "vitest";
import { locatePassage, passageParam } from "../../src/lib/passage";

describe("the passage a result showed", () => {
  it("is named by its first and last words", () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    expect(passageParam(words)).toBe("w0 w1 w2 w3 w4 w5 w6 w7|w22 w23 w24 w25 w26 w27 w28 w29");
    expect(passageParam("a short quote")).toBe("a short quote");
    expect(passageParam("ends cut off…")).toBe("ends cut off");
  });

  it("is found again in the transcript's text, whatever the spacing and case", () => {
    const text = "Thank you. When I was involved with the Campaign for Fiscal  Equity, CFE versus the State, she was there.";
    const [from, to] = locatePassage(text, "when i was involved|cfe versus the state")!;
    expect(text.slice(from, to)).toBe("When I was involved with the Campaign for Fiscal  Equity, CFE versus the State");
    expect(text.slice(...locatePassage(text, "Campaign for Fiscal Equity")!)).toBe("Campaign for Fiscal  Equity");
    expect(locatePassage(text, "not in this text")).toBeNull();
  });
});
