import { describe, expect, it } from "vitest";
import { csv } from "../../src/lib/csv";

describe("a spreadsheet file (.csv) for Excel", () => {
  it("starts with the mark Excel needs to read accents, and quotes what needs quoting", () => {
    expect(csv([["Date", "Speaker"], ["2025-03-04", "Luis R. Sepúlveda"]])).toBe("\uFEFFDate,Speaker\r\n2025-03-04,Luis R. Sepúlveda\r\n");
    expect(csv([["a, b", 'say "hi"', "two\nlines", 3, null]])).toBe('\uFEFF"a, b","say ""hi""","two\nlines",3,\r\n');
  });

  it("never lets a cell run as a formula", () => {
    expect(csv([["=SUM(A1)", "+1", "@me", "-2 percent"]])).toBe("\uFEFF'=SUM(A1),'+1,'@me,-2 percent\r\n");
  });

  it("shortens a cell past Excel's limit rather than break the row", () => {
    const cell = csv([["x".repeat(40_000)]]).slice(1, -2);
    expect(cell.length).toBe(32_000);
    expect(cell.endsWith("…")).toBe(true);
  });
});
