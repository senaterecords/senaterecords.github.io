import { describe, expect, it } from "vitest";
import { estimateHeight, lastPage, turnBlocks, turnParagraphs } from "../../src/lib/reader";
import { billRefs } from "../../src/lib/reader";

describe("turn text with page breaks", () => {
  it("splits paragraphs on blank lines and joins wrapped lines", () => {
    expect(turnBlocks("Thank you,\nMr. President.\n\nOn the bill.", [])).toEqual([
      { kind: "p", text: "Thank you, Mr. President." },
      { kind: "p", text: "On the bill." },
    ]);
  });

  it("puts each page break where its offset says, even inside a paragraph", () => {
    const text = "One two.\n\nThree four\nfive six.";
    expect(turnBlocks(text, [[text.indexOf("five"), 828]])).toEqual([
      { kind: "p", text: "One two." },
      { kind: "p", text: "Three four" },
      { kind: "pb", page: 828 },
      { kind: "p", text: "five six." },
    ]);
  });

  it("keeps breaks at the very start or end and in offset order", () => {
    expect(turnBlocks("Words.", [[6, 12], [0, 11]])).toEqual([
      { kind: "pb", page: 11 },
      { kind: "p", text: "Words." },
      { kind: "pb", page: 12 },
    ]);
  });

  it("keeps a page break inside the paragraph it interrupts, so the sentence stays one block", () => {
    const text = "One two.\n\nThree four\nfive six.\n\nSeven.";
    expect(turnParagraphs(text, [[text.indexOf("five"), 828], [text.indexOf("Seven"), 829]])).toEqual([
      { kind: "p", parts: ["One two."] },
      { kind: "p", parts: ["Three four", { page: 828 }, "five six."] },
      { kind: "pb", page: 829 },
      { kind: "p", parts: ["Seven."] },
    ]);
    expect(turnParagraphs("Words.", [[6, 12], [0, 11]])).toEqual([
      { kind: "pb", page: 11 },
      { kind: "p", parts: ["Words."] },
      { kind: "pb", page: 12 },
    ]);
  });

  it("estimates a chunk's height from its text, so skipped chunks hold roughly their real space", () => {
    const short = { label: "SENATOR KRUEGER", text: "Thank you.", breaks: [] as [number, number][] };
    const long = { label: null, text: Array.from({ length: 10 }, () => "word ".repeat(150)).join("\n\n"), breaks: [[10, 828]] as [number, number][] };
    expect(estimateHeight([short])).toBe(40);
    expect(estimateHeight([long])).toBeGreaterThan(10 * 10 * 27);
    expect(estimateHeight([short, long])).toBe(estimateHeight([short]) + estimateHeight([long]));
  });

  it("knows the page a turn ends on", () => {
    expect(lastPage({ page: 826, breaks: [[10, 827], [90, 828]] })).toBe(828);
    expect(lastPage({ page: 826, breaks: [] })).toBe(826);
    expect(lastPage({ page: null, breaks: [] })).toBeNull();
  });
});

describe("bill numbers in the text", () => {
  it("finds the ways the record names a bill, with its base print number", () => {
    const text = "moves to discharge Assembly Bill Number 7594C and substitute it for the identical Senate Bill 3852-C. Senate Print 4597-A, by Senator Krueger; Senate Bill No. 12.";
    expect(billRefs(text).map((r) => [text.slice(r.start, r.end), r.base])).toEqual([
      ["Assembly Bill Number 7594C", "A7594"],
      ["Senate Bill 3852-C", "S3852"],
      ["Senate Print 4597-A", "S4597"],
      ["Senate Bill No. 12", "S12"],
    ]);
    expect(billRefs("Calendar Number 12, the bill is passed.")).toEqual([]);
  });

  it("finds print numbers written compactly, and leaves short or glued codes alone", () => {
    const text = "explain my vote on my bill, S9051B. Last year's S1507-C; S5040/A7046; No. A08587.";
    expect(billRefs(text).map((r) => [text.slice(r.start, r.end), r.base])).toEqual([
      ["S9051B", "S9051"],
      ["S1507-C", "S1507"],
      ["S5040", "S5040"],
      ["A7046", "A7046"],
      ["A08587", "A8587"],
    ]);
    expect(billRefs("a Class A1 felony, the S2 form, route NY-A100, an Airbus A320 and BS1234")).toEqual([]);
  });

  it("finds bill and print written small", () => {
    const text = "By Senator Levy, Senate bill Number 4887B, an act; Senate print 3928-A; Assembly bill Number 8836 A.";
    expect(billRefs(text).map((r) => r.base)).toEqual(["S4887", "S3928", "A8836"]);
  });
});
