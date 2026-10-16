import { describe, expect, it } from "vitest";
import { excerpt, keepRemark, pagefindFilters, pagefindTerm, parseQuery, remarksOf } from "../../src/lib/query";

describe("parseQuery", () => {
  it("reads words, phrases and shortcuts", () => {
    expect(parseQuery('"congestion pricing" tolls speaker:krueger year:2015-2019 type:hearing committee:"Ways and Means" bill:s4597a')).toEqual({
      branches: [{ words: ["tolls"], phrases: ["congestion pricing"], near: [] }],
      not: [],
      filters: { speaker: "krueger", years: [2015, 2016, 2017, 2018, 2019], type: "hearing", committee: "Ways and Means", bill: "S4597" },
    });
  });

  it("splits OR into branches, AND binding tighter", () => {
    expect(parseQuery("rent stabilization OR tolls").branches).toEqual([
      { words: ["rent", "stabilization"], phrases: [], near: [] },
      { words: ["tolls"], phrases: [], near: [] },
    ]);
    expect(parseQuery('"toll revenue" OR "congestion pricing"').branches.map((b) => b.phrases)).toEqual([["toll revenue"], ["congestion pricing"]]);
  });

  it("reads NOT, -word, AND and NEAR", () => {
    const q = parseQuery("tolls AND fares NOT bridge -tunnel");
    expect(q.branches).toEqual([{ words: ["tolls", "fares"], phrases: [], near: [] }]);
    expect(q.not).toEqual(["bridge", "tunnel"]);
    expect(parseQuery("tolls NEAR fares").branches).toEqual([{ words: [], phrases: [], near: [["tolls", "fares"]] }]);
  });

  it("accepts a query with only filters", () => {
    expect(parseQuery("speaker:liz-krueger").branches).toEqual([{ words: [], phrases: [], near: [] }]);
  });
});

describe("Pagefind plan", () => {
  it("builds the search term and filters", () => {
    const q = parseQuery('"toll revenue" fares tolls NEAR bridge year:2019 type:floor bill:S4597');
    expect(pagefindTerm(q.branches[0])).toBe('fares "toll revenue" tolls bridge');
    expect(pagefindFilters(q.filters, "liz-krueger")).toEqual({ year: ["2019"], type: "floor", bill: "S4597", senator: "liz-krueger" });
  });

  it("asks Pagefind for any year of a range, not every year at once", () => {
    expect(pagefindFilters(parseQuery("rent year:2017-2019").filters, null)).toEqual({ year: { any: ["2017", "2018", "2019"] } });
  });
});

const DATA = {
  url: "/transcripts/2025-03-04-regular-session/",
  content: "March 4 2025. Senator Krueger. The toll revenue goes to the bridge fund this year. Senator Lanza. Fares and tolls rose again in my district.",
  anchors: [
    { element: "h3", id: "r-5", text: "Senator Krueger", location: 3 },
    { element: "span", id: "w-5-1201-liz-krueger", text: "Senator Krueger", location: 3 },
    { element: "h3", id: "r-6", text: "Senator Lanza", location: 15 },
    { element: "span", id: "w-6-1202-andrew-j-lanza", text: "Senator Lanza", location: 15 },
  ],
};

describe("remark-level filtering", () => {
  it("splits a page into remarks with page and speaker", () => {
    const remarks = remarksOf(DATA);
    expect(remarks.map((r) => [r.turn, r.page, r.speaker, r.url])).toEqual([
      [5, 1201, "liz-krueger", "/transcripts/2025-03-04-regular-session/#r-5"],
      [6, 1202, "andrew-j-lanza", "/transcripts/2025-03-04-regular-session/#r-6"],
    ]);
    expect(remarks[0].text).toBe("Senator Krueger. The toll revenue goes to the bridge fund this year.");
  });

  it("applies phrases, words, NOT, NEAR and speaker to each remark", () => {
    const [krueger, lanza] = remarksOf(DATA);
    const branch = (s: string) => parseQuery(s).branches[0];
    expect(keepRemark(krueger, branch('"toll revenue"'), [], null)).toBe(true);
    expect(keepRemark(lanza, branch('"toll revenue"'), [], null)).toBe(false);
    expect(keepRemark(lanza, branch("toll fares"), [], null)).toBe(true);
    expect(keepRemark(krueger, branch("toll"), ["bridge"], null)).toBe(false);
    expect(keepRemark(krueger, branch("toll NEAR fund"), [], null)).toBe(true);
    expect(keepRemark(lanza, branch("fares NEAR district"), [], null)).toBe(true);
    expect(keepRemark(lanza, branch("tolls"), [], "liz-krueger")).toBe(false);
    expect(keepRemark(krueger, parseQuery('"toll revenue" "bridge fund"').branches[0], [], null)).toBe(true);
  });

  it("writes a safe excerpt with the hits marked", () => {
    const [krueger] = remarksOf(DATA);
    expect(excerpt(krueger, parseQuery('"toll revenue"').branches[0])).toContain("<mark>toll revenue</mark>");
    expect(excerpt({ ...krueger, text: "a <b> toll" }, parseQuery("toll").branches[0])).toBe("a &lt;b&gt; <mark>toll</mark>");
  });
});
