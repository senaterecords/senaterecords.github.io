import { describe, expect, it } from "vitest";
import {
  billPlaces, EVERY_PAGE, excerpt, excerptPages, fillMore, hasShortcut, keepRemark, mentionsAny, pagefindFilters, pagefindTerms, parseQuery, remarksOf, spokenText,
  toggleShortcut, topShortcuts, yearShortcuts, type Branch,
} from "../../src/lib/query";

// A branch's terms alone, as most tests compare them.
const terms = (branches: Branch[]) => branches.map(({ words, phrases, near }) => ({ words, phrases, near }));

describe("parseQuery", () => {
  it("reads words, phrases and shortcuts", () => {
    const filters = { speakers: [{ text: "krueger", senate: false }], years: [2015, 2016, 2017, 2018, 2019], types: ["hearing"], committees: ["Ways and Means"], bills: ["S4597"] };
    expect(parseQuery('"congestion pricing" tolls speaker:krueger year:2015-2019 type:hearing committee:"Ways and Means" bill:s4597a')).toEqual({
      branches: [{ words: ["tolls"], phrases: ["congestion pricing"], near: [], filters, not: [] }],
      filters,
      tooMany: false,
    });
  });

  it("splits OR into branches, AND binding tighter", () => {
    expect(terms(parseQuery("rent stabilization OR tolls").branches)).toEqual([
      { words: ["rent", "stabilization"], phrases: [], near: [] },
      { words: ["tolls"], phrases: [], near: [] },
    ]);
    expect(parseQuery('"toll revenue" OR "congestion pricing"').branches.map((b) => b.phrases)).toEqual([["toll revenue"], ["congestion pricing"]]);
  });

  it("reads NOT, -word, AND and NEAR", () => {
    const q = parseQuery("tolls AND fares NOT bridge -tunnel");
    expect(terms(q.branches)).toEqual([{ words: ["tolls", "fares"], phrases: [], near: [] }]);
    expect(q.branches[0].not.map((e) => e.words)).toEqual([["bridge"], ["tunnel"]]);
    expect(terms(parseQuery("tolls NEAR fares").branches)).toEqual([{ words: [], phrases: [], near: [{ a: "tolls", b: "fares", within: 10 }] }]);
  });

  it("accepts a query with only filters", () => {
    expect(terms(parseQuery("speaker:liz-krueger").branches)).toEqual([{ words: [], phrases: [], near: [] }]);
  });
});

describe("Pagefind plan", () => {
  it("builds the search term and filters", () => {
    const q = parseQuery('"toll revenue" fares tolls NEAR bridge year:2019 type:floor bill:S4597');
    expect(pagefindTerms(q.branches[0])).toEqual(['"toll revenue"', "fares tolls bridge"]);
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

  it("takes a remark's label from its speaker heading when the remark anchor is the whole turn", () => {
    const [remark] = remarksOf({
      url: "/t/", content: "Senator Krueger. The toll revenue.",
      anchors: [
        { element: "section", id: "r-5", text: "Senator Krueger. The toll revenue.", location: 0 },
        { element: "h3", id: "w-5-1201-liz-krueger", text: "Senator Krueger", location: 0 },
      ],
    });
    expect(remark.label).toBe("Senator Krueger");
  });

  it("applies phrases, words, NOT, NEAR and speaker to each remark", () => {
    const [krueger, lanza] = remarksOf(DATA);
    const branch = (s: string) => parseQuery(s).branches[0];
    expect(keepRemark(krueger, branch('"toll revenue"'))).toBe(true);
    expect(keepRemark(lanza, branch('"toll revenue"'))).toBe(false);
    expect(keepRemark(lanza, branch("toll fares"))).toBe(true);
    expect(keepRemark(krueger, branch("toll -bridge"))).toBe(false);
    expect(keepRemark(krueger, branch("toll NEAR fund"))).toBe(true);
    expect(keepRemark(lanza, branch("fares NEAR district"))).toBe(true);
    expect(keepRemark(lanza, branch("tolls"), "liz-krueger")).toBe(false);
    expect(keepRemark(krueger, parseQuery('"toll revenue" "bridge fund"').branches[0])).toBe(true);
  });

  it("writes a safe excerpt with the hits marked", () => {
    const [krueger] = remarksOf(DATA);
    expect(excerpt(krueger, parseQuery('"toll revenue"').branches[0])).toContain("<mark>toll revenue</mark>");
    expect(excerpt({ ...krueger, text: "a <b> toll" }, parseQuery("toll").branches[0])).toBe("a &lt;b&gt; <mark>toll</mark>");
  });
});

describe("review fixes: query plan", () => {
  it("asks Pagefind for each phrase exactly, and for the other words together", () => {
    expect(pagefindTerms(parseQuery('"executive budget" "steady job growth"').branches[0])).toEqual(['"executive budget"', '"steady job growth"']);
    expect(pagefindTerms(parseQuery('"toll revenue"').branches[0])).toEqual(['"toll revenue"']);
    expect(pagefindTerms(parseQuery("rent stabilization").branches[0])).toEqual(["rent stabilization"]);
    // With no words at all, Pagefind would load its whole index; every indexed page holds one marker word instead.
    expect(pagefindTerms(parseQuery("speaker:liz-krueger").branches[0])).toEqual([EVERY_PAGE]);
  });

  it("reads a bill's session when one is given, from either year of it", () => {
    expect(parseQuery("bill:S4597/2025").filters).toEqual({ bills: ["S4597"], session: 2025 });
    expect(parseQuery("bill:s4597a/2026").filters).toEqual({ bills: ["S4597"], session: 2025 });
    expect(parseQuery("bill:S4597").filters).toEqual({ bills: ["S4597"] });
    expect(pagefindFilters(parseQuery("bill:S4597/2025").filters, null)).toEqual({ bill: "S4597", session: "2025" });
  });

  it("finds, adds and removes a shortcut, quoted values included", () => {
    expect(hasShortcut('budget committee:"Ways and Means"', 'committee:"Ways and Means"')).toBe(true);
    expect(hasShortcut("budget TYPE:hearing", "type:hearing")).toBe(true);
    expect(hasShortcut("budget type:hearings", "type:hearing")).toBe(false);
    expect(toggleShortcut('budget committee:"Ways and Means"', 'committee:"Ways and Means"')).toBe("budget");
    expect(toggleShortcut("budget", "type:hearing")).toBe("budget type:hearing");
  });

  it("stops filling the first screen after a few batches", () => {
    expect(fillMore(0, 1, 100)).toBe(true);
    expect(fillMore(5, 1, 100)).toBe(false);
    expect(fillMore(0, 3, 100)).toBe(false);
  });

  it("reads a last short batch rather than stop just short of the end", () => {
    // 60 of 69 read with one remark found: the 9 left are read too, so the counts are final.
    expect(fillMore(1, 3, 9)).toBe(true);
    expect(fillMore(1, 3, 20)).toBe(true);
    expect(fillMore(1, 3, 21)).toBe(false);
    expect(fillMore(5, 3, 9)).toBe(false); // a full first screen stops as before
  });
});

// Words: 0 Senator 1 Jackson. 2 The 3 children. 4 When 5 I 6 was 7 involved 8 with 9 the 10 Campaign 11 for 12 Fiscal
// 13 Equity 14 she 15 was 16 there. 17 Roll 18 call. 19 Senator 20 Lanza. 21 No.
const PAGED = {
  url: "/t/",
  content: "Senator Jackson. The children. When I was involved with the Campaign for Fiscal Equity she was there. Roll call. Senator Lanza. No.",
  anchors: [
    { element: "section", id: "r-25", text: "", location: 0 },
    { element: "h3", id: "w-25-850-robert-jackson", text: "Senator Jackson", location: 0 },
    { element: "span", id: "p851", text: "", location: 4 },
    { element: "section", id: "t-26", text: "", location: 17 },
    { element: "section", id: "r-27", text: "", location: 19 },
    { element: "h3", id: "w-27-851-andrew-j-lanza", text: "Senator Lanza", location: 19 },
  ],
};

describe("review fixes: remarks", () => {
  it("ends a remark where a turn without a speaker begins", () => {
    const [jackson, lanza] = remarksOf(PAGED);
    expect(jackson.text).toBe("Senator Jackson. The children. When I was involved with the Campaign for Fiscal Equity she was there.");
    expect(lanza.text).toBe("Senator Lanza. No.");
  });

  it("knows where each page begins inside a remark, also once the label is taken off", () => {
    const [jackson] = remarksOf(PAGED);
    expect(jackson.breaks).toEqual([[4, 851]]);
    expect(spokenText(jackson).breaks).toEqual([[2, 851]]);
  });

  it("gives the page of the first hit and the pages the excerpt spans", () => {
    const jackson = spokenText(remarksOf(PAGED)[0]);
    expect(excerptPages(jackson, parseQuery('"Campaign for Fiscal Equity"').branches[0])).toEqual({ hit: 851, start: 850, end: 851 });
    expect(excerptPages(jackson, parseQuery("children").branches[0])).toEqual({ hit: 850, start: 850, end: 851 });
    const long = { ...jackson, text: `${"word ".repeat(200)}children ${"word ".repeat(200)}Campaign`, breaks: [[150, 851], [300, 852]] as [number, number][] };
    expect(excerptPages(long, parseQuery("children").branches[0])).toEqual({ hit: 851, start: 851, end: 851 });
  });

  it("makes a transcript without speaker labels searchable as one text", () => {
    const remarks = remarksOf({
      url: "/p/", content: "ALBANY. The Senate will come to order. Elmira Correctional Facility.",
      anchors: [{ element: "section", id: "t-0", text: "", location: 0 }, { element: "span", id: "p5472", text: "", location: 7 }],
    });
    expect(remarks.map((r) => [r.url, r.turn, r.speaker, r.label, r.page])).toEqual([["/p/#t-0", 0, null, "", 5471]]);
  });

  it("leaves a speaker's presiding turns out of speaker: results", () => {
    const [krueger] = remarksOf(DATA);
    const presiding = { ...krueger, label: "Acting President Krueger" };
    expect(keepRemark(presiding, parseQuery("toll").branches[0], "liz-krueger")).toBe(false);
    expect(keepRemark(presiding, parseQuery("toll").branches[0])).toBe(true);
  });
});

describe("review fixes: how far a search reaches", () => {
  it("reads a lowercase and as AND, not as a word to find", () => {
    expect(terms(parseQuery('"work from home" and "state workers"').branches)).toEqual([{ words: [], phrases: ["work from home", "state workers"], near: [] }]);
  });

  it("across a whole transcript, keeps a remark that holds any of the terms, still honouring NOT and speaker", () => {
    const [krueger, lanza] = remarksOf(DATA);
    const b = parseQuery('"toll revenue" fares').branches[0];
    expect(mentionsAny(krueger, b)).toBe(true);
    expect(mentionsAny(lanza, b)).toBe(true);
    expect(mentionsAny(lanza, parseQuery('"toll revenue" fares -district').branches[0])).toBe(false);
    expect(mentionsAny(krueger, b, "andrew-j-lanza")).toBe(false);
    expect(mentionsAny(krueger, parseQuery("tunnels").branches[0])).toBe(false);
  });
});

describe("several speakers, and senator:", () => {
  it("reads every speaker: and senator: as one of the people to keep", () => {
    expect(parseQuery("budget speaker:krueger senator:lanza").filters.speakers).toEqual([{ text: "krueger", senate: false }, { text: "lanza", senate: true }]);
  });

  it("asks Pagefind for any of several speakers", () => {
    expect(pagefindFilters({}, ["liz-krueger", "andrew-j-lanza"])).toEqual({ senator: { any: ["liz-krueger", "andrew-j-lanza"] } });
    expect(pagefindFilters({}, ["liz-krueger"])).toEqual({ senator: "liz-krueger" });
  });

  it("keeps a remark by any of the speakers", () => {
    const [krueger, lanza] = remarksOf(DATA);
    expect(keepRemark(lanza, parseQuery("tolls").branches[0], ["liz-krueger", "andrew-j-lanza"])).toBe(true);
    expect(keepRemark(krueger, parseQuery("toll").branches[0], ["andrew-j-lanza"])).toBe(false);
  });
});

describe("several values of one shortcut mean any of them", () => {
  it("collects every year, type, committee and bill", () => {
    expect(parseQuery('rent year:2019 year:2021-2022 type:floor type:hearing committee:Health committee:"Ways and Means" bill:S1 bill:A2').filters).toEqual({
      years: [2019, 2021, 2022], types: ["floor", "hearing"], committees: ["Health", "Ways and Means"], bills: ["S1", "A2"],
    });
  });

  it("asks Pagefind for any of them; both record types is no type filter at all", () => {
    expect(pagefindFilters(parseQuery('year:2019 year:2021 type:floor type:hearing committee:Health committee:"Ways and Means" bill:S1 bill:A2').filters, null)).toEqual({
      year: { any: ["2019", "2021"] }, committee: { any: ["Health", "Ways and Means"] }, bill: { any: ["S1", "A2"] },
    });
  });
});

describe("NEAR with a distance, and with phrases", () => {
  it("reads NEAR/n as within n words, and takes a phrase on either side", () => {
    expect(parseQuery("tolls NEAR/3 fares").branches[0].near).toEqual([{ a: "tolls", b: "fares", within: 3 }]);
    // With a distance it can only mean NEAR, so any case will do; a plain lowercase "near" stays a word.
    expect(terms(parseQuery("tolls near/1 fares").branches)[0]).toEqual({ words: [], phrases: [], near: [{ a: "tolls", b: "fares", within: 1 }] });
    expect(parseQuery("homes near water").branches[0].words).toEqual(["homes", "near", "water"]);
    expect(terms(parseQuery('"toll revenue" NEAR bridge').branches)).toEqual([{ words: [], phrases: [], near: [{ a: "toll revenue", b: "bridge", within: 10 }] }]);
    expect(parseQuery('budget NEAR "school aid"').branches[0].near).toEqual([{ a: "budget", b: "school aid", within: 10 }]);
  });

  it("checks the distance between the closest words of each side", () => {
    // Senator0 Krueger1 The2 toll3 revenue4 goes5 to6 the7 bridge8 fund9 ...
    const [krueger] = remarksOf(DATA);
    expect(keepRemark(krueger, parseQuery('"toll revenue" NEAR/3 bridge').branches[0])).toBe(false);
    expect(keepRemark(krueger, parseQuery('"toll revenue" NEAR/4 bridge').branches[0])).toBe(true);
    expect(keepRemark(krueger, parseQuery("toll NEAR/5 fund").branches[0])).toBe(false);
    expect(keepRemark(krueger, parseQuery("toll NEAR/6 fund").branches[0])).toBe(true);
  });

  it("asks Pagefind for a NEAR phrase exactly and its words together", () => {
    expect(pagefindTerms(parseQuery('"toll revenue" NEAR bridge').branches[0])).toEqual(['"toll revenue"', "bridge"]);
  });
});

describe("a long remark's excerpt shows where the query matches", () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  const remark = (text: string, breaks: [number, number][] = []) => ({ url: "/t/#r-1", turn: 1, page: 10, speaker: null, label: "", text, breaks });
  // A lone "fares" early on, and "fares and tolls" (the NEAR match) much later.
  const fares = `${filler(30)} the fares it collects ${filler(200)} on its fares and tolls along with ${filler(100)}`;

  it("centres a NEAR search on the pair that matched, not on a lone first hit", () => {
    expect(excerpt(remark(fares), parseQuery("tolls NEAR/3 fares").branches[0])).toContain("<mark>fares</mark> and <mark>tolls</mark>");
  });

  it("centres several words on where they come together", () => {
    const text = `${filler(30)} a budget ${filler(200)} the school aid budget for ${filler(100)}`;
    expect(excerpt(remark(text), parseQuery("school budget").branches[0])).toContain("<mark>school</mark> aid <mark>budget</mark>");
  });

  it("cites the page of the matched pair", () => {
    // Page 11 begins at word 150: after the lone "fares", before the pair.
    expect(excerptPages(remark(fares, [[150, 11]]), parseQuery("tolls NEAR/3 fares").branches[0])).toMatchObject({ hit: 11, start: 11 });
  });

  it("still opens on the first hit of a single word", () => {
    expect(excerpt(remark(fares), parseQuery("fares").branches[0])).toContain("the <mark>fares</mark> it collects");
  });
});

describe("speaker: for people the Senate's data doesn't know", () => {
  const remark = (label: string, speaker: string | null = null) => ({ url: "/t/#r-1", turn: 1, page: 4, speaker, label, text: "The tax base is shrinking.", breaks: [] as [number, number][] });
  const any = parseQuery("speaker:hiller").branches[0];

  it("matches the name printed on the remark, by any word of it", () => {
    expect(keepRemark(remark("DTF COMMISSIONER HILLER"), any, { slugs: [], labels: ["hiller"] })).toBe(true);
    expect(keepRemark(remark("DTF COMMISSIONER HILLER"), any, { slugs: [], labels: ["hil"] })).toBe(true);
    expect(keepRemark(remark("DTF COMMISSIONER HILLER"), any, { slugs: [], labels: ["commissioner hiller"] })).toBe(true);
    expect(keepRemark(remark("SENATOR KRUEGER", "liz-krueger"), any, { slugs: [], labels: ["hiller"] })).toBe(false);
  });

  it("mixes with people it knows: either one's remarks", () => {
    const both = { slugs: ["liz-krueger"], labels: ["hiller"] };
    expect(keepRemark(remark("SENATOR KRUEGER", "liz-krueger"), any, both)).toBe(true);
    expect(keepRemark(remark("DTF COMMISSIONER HILLER"), any, both)).toBe(true);
    expect(keepRemark(remark("SENATOR LANZA", "andrew-j-lanza"), any, both)).toBe(false);
  });
});


describe("brackets", () => {
  const words = (q: string) => parseQuery(q).branches.map((b) => [...b.words, ...b.phrases.map((p) => `"${p}"`)].join(" "));

  it("works out brackets and OR into branches, at any depth", () => {
    expect(words("(tolls OR fares) bridge")).toEqual(["tolls bridge", "fares bridge"]);
    expect(words("(tolls OR fares) AND bridge")).toEqual(["tolls bridge", "fares bridge"]);
    expect(words("budget AND (tax OR school)")).toEqual(["budget tax", "budget school"]);
    expect(words("(budget AND tax) OR school")).toEqual(["budget tax", "school"]);
    expect(words('((tolls OR "toll revenue") (bridge OR tunnel)) OR ferry')).toEqual(["tolls bridge", "tolls tunnel", 'bridge "toll revenue"', 'tunnel "toll revenue"', "ferry"]);
  });

  it("closes a bracket left open, and passes over one closed too many", () => {
    expect(words("(tolls OR fares")).toEqual(["tolls", "fares"]);
    expect(words("tolls) fares")).toEqual(["tolls fares"]);
    expect(words("()")).toEqual([""]);
  });

  it("takes words with brackets around them as the words alone", () => {
    expect(parseQuery("(tolls)").branches[0].words).toEqual(["tolls"]);
    expect(words("tolls - fares")).toEqual(["tolls fares"]); // a dash alone is nothing to find
  });

  it("leaves out a whole group with NOT or a minus", () => {
    const either = parseQuery("budget NOT (tax OR school)").branches;
    expect(either).toHaveLength(1);
    expect(either[0].not.map((e) => e.words)).toEqual([["tax"], ["school"]]);
    const both = parseQuery("budget -(tax school)").branches;
    expect(both[0].not.map((e) => e.words)).toEqual([["tax", "school"]]); // only remarks with both are left out
    // NOT (x AND NOT y) is NOT x OR y.
    expect(words("budget NOT (tax -school)")).toEqual(["budget", "budget school"]);
    expect(parseQuery("budget NOT (tax -school)").branches[0].not.map((e) => e.words)).toEqual([["tax"]]);
  });

  it("keeps NEAR inside a bracket, and pairs NEAR with each word of a bracket", () => {
    expect(parseQuery("(tolls NEAR fares) OR bridge").branches.map((b) => [b.near, b.words])).toEqual([
      [[{ a: "tolls", b: "fares", within: 10 }], []],
      [[], ["bridge"]],
    ]);
    expect(parseQuery("(tolls OR fares) NEAR/3 bridge").branches.map((b) => b.near)).toEqual([
      [{ a: "tolls", b: "bridge", within: 3 }],
      [{ a: "fares", b: "bridge", within: 3 }],
    ]);
  });

  it("refuses a query that works out to too many branches", () => {
    expect(parseQuery("(a OR b) (c OR d) (e OR f) (g OR h)").tooMany).toBe(false); // 16
    expect(parseQuery("(a OR b) (c OR d) (e OR f) (g OR h) (i OR j)").tooMany).toBe(true); // 32
    expect(parseQuery(Array.from({ length: 12 }, (_, i) => `(w${i} OR v${i})`).join(" ")).tooMany).toBe(true); // 4,096: stops early
  });
});

describe("shortcuts and brackets", () => {
  it("lets shortcuts outside brackets narrow the whole query, wherever they stand", () => {
    const q = parseQuery("tolls OR fares year:2019");
    expect(q.branches.map((b) => [b.words, b.filters])).toEqual([[["tolls"], { years: [2019] }], [["fares"], { years: [2019] }]]);
    expect(q.filters).toEqual({ years: [2019] });
  });

  it("gives each bracket its own shortcuts", () => {
    const q = parseQuery("(tolls speaker:krueger) OR (fares speaker:liu) type:floor");
    expect(q.branches.map((b) => [b.words, b.filters])).toEqual([
      [["tolls"], { speakers: [{ text: "krueger", senate: false }], types: ["floor"] }],
      [["fares"], { speakers: [{ text: "liu", senate: false }], types: ["floor"] }],
    ]);
    expect(q.filters).toEqual({ types: ["floor"] });
  });

  it("reads speaker:( … ) as any of those speakers", () => {
    expect(parseQuery("tolls speaker:(krueger OR liu)").filters.speakers).toEqual([{ text: "krueger", senate: false }, { text: "liu", senate: false }]);
    expect(parseQuery('tolls committee:("Ways and Means" OR Health)').filters.committees).toEqual(["Ways and Means", "Health"]);
  });

  it("leaves a speaker, year, type, committee or bill out with NOT or a minus, instead of keeping only them", () => {
    for (const q of ["tolls NOT speaker:krueger", "tolls -speaker:krueger"]) {
      const b = parseQuery(q).branches[0];
      expect(b.filters).toEqual({});
      expect(b.not).toEqual([{ words: [], phrases: [], near: [], filters: { speakers: [{ text: "krueger", senate: false }] } }]);
    }
    expect(parseQuery("tolls -year:2019 -type:hearing").branches[0].not.map((e) => e.filters)).toEqual([{ years: [2019] }, { types: ["hearing"] }]);
    expect(parseQuery("tolls -speaker:(krueger OR liu)").branches[0].not.map((e) => e.filters.speakers)).toEqual([
      [{ text: "krueger", senate: false }], [{ text: "liu", senate: false }],
    ]);
    expect(parseQuery("tolls NOT -year:2019").filters).toEqual({ years: [2019] }); // two negatives make a positive
  });

  it("asks Pagefind to leave out the transcripts a NOT rules out, and nothing for a NOT about words or a speaker", () => {
    const b = parseQuery('tolls -year:2019 -committee:"Ways and Means" -speaker:krueger -bridge').branches[0];
    expect(pagefindFilters(b.filters, null, b.not)).toEqual({ none: [{ year: ["2019"] }, { committee: "Ways and Means" }] });
    expect(pagefindFilters(parseQuery("tolls").branches[0].filters, null, [])).toEqual({});
  });
});

describe("exclusions on each remark", () => {
  const [krueger, lanza] = remarksOf(DATA);
  const page = { year: ["2025"], type: ["floor"], session: ["2025"] };
  const branch = (s: string) => parseQuery(s).branches[0];

  it("leaves out a speaker's remarks, and only theirs", () => {
    const b = branch("toll -speaker:krueger");
    expect(keepRemark(krueger, b, null, ["liz-krueger"], page)).toBe(false);
    expect(keepRemark(lanza, branch("tolls -speaker:krueger"), null, ["liz-krueger"], page)).toBe(true);
    // Not yet looked up, the name as typed still finds them.
    expect(keepRemark(krueger, branch("toll -speaker:liz-krueger"))).toBe(false);
  });

  it("leaves out remarks in the years, types and committees a NOT names", () => {
    expect(keepRemark(krueger, branch("toll -year:2025"), null, [], page)).toBe(false);
    expect(keepRemark(krueger, branch("toll -year:2019"), null, [], page)).toBe(true);
    expect(keepRemark(krueger, branch("toll -type:floor"), null, [], page)).toBe(false);
    expect(keepRemark(krueger, branch("toll -committee:Health"), null, [], page)).toBe(true);
  });

  it("leaves out by words, speaker and place together when a NOT names them together", () => {
    const b = branch("toll -(bridge speaker:krueger)");
    expect(keepRemark(krueger, b, null, ["liz-krueger"], page)).toBe(false); // Krueger, saying bridge
    expect(keepRemark(krueger, branch("toll -(tunnel speaker:krueger)"), null, ["liz-krueger"], page)).toBe(true);
  });

  it("checks each branch's own shortcuts against the transcript", () => {
    const [in2019, in2025] = parseQuery("(toll year:2019) OR (toll year:2025)").branches;
    expect(keepRemark(krueger, in2019, null, [], page)).toBe(false);
    expect(keepRemark(krueger, in2025, null, [], page)).toBe(true);
  });
});

describe("review fixes: NOT before shortcuts", () => {
  it("leaves out every value of speaker:( … ) after a NOT, outside brackets or in", () => {
    const outside = parseQuery("tolls NOT speaker:(smith jones)").branches[0];
    expect(outside.filters).toEqual({});
    expect(outside.not.map((e) => e.filters.speakers)).toEqual([[{ text: "smith", senate: false }], [{ text: "jones", senate: false }]]);
    const inside = parseQuery("(tolls NOT speaker:(smith jones)) OR fares").branches[0];
    expect(inside.filters).toEqual({});
    expect(inside.not.map((e) => e.filters.speakers)).toEqual([[{ text: "smith", senate: false }], [{ text: "jones", senate: false }]]);
  });

  it("reads NOT NOT before a shortcut as no NOT at all, leaving nothing behind", () => {
    const q = parseQuery("tolls NOT NOT year:2019 fares");
    expect(q.filters).toEqual({ years: [2019] });
    expect(q.branches.map((b) => [b.words, b.not.length])).toEqual([[["tolls", "fares"], 0]]);
  });
});

describe("how a word matches", () => {
  const remark = (text: string) => ({ url: "/t/#r-1", turn: 1, page: 3, speaker: null, label: "", text, breaks: [] as [number, number][] });
  const keeps = (q: string, text: string) => keepRemark(remark(text), parseQuery(q).branches[0]);

  it("matches a word's forms, not other words that start the same", () => {
    expect(keeps("tax", "New taxes were taxed again")).toBe(true);
    expect(keeps("tax", "Taxpayers and taxis")).toBe(false);
    expect(keeps("sad", "It is sadly true")).toBe(true);
    expect(keeps("sad", "Sadie sat in the saddle")).toBe(false);
    expect(keeps("hope", "We are hoping for more")).toBe(true);
  });

  it("matches any word that starts so with * or !", () => {
    expect(keeps("tax*", "Taxpayers and taxis")).toBe(true);
    expect(keeps("tax!", "Taxation")).toBe(true);
    expect(keeps("sad*", "Sadie sat in the saddle")).toBe(true);
  });

  it("matches exactly the word in quotes, in a NEAR too", () => {
    expect(keeps('"tax"', "New taxes")).toBe(false);
    expect(keeps('"tax"', "A new tax")).toBe(true);
    expect(keeps('"tax" NEAR/2 cap', "the taxes cap")).toBe(false);
    expect(keeps('"tax" NEAR/2 cap', "the tax cap")).toBe(true);
    expect(keeps("tax NEAR/2 cap", "the taxes cap")).toBe(true);
  });

  it("leaves out a NOT word's forms", () => {
    expect(keeps("budget -tax", "The budget and taxes")).toBe(false);
    expect(keeps("budget -tax", "The budget and taxpayers")).toBe(true);
  });

  it("marks what matched, by the same rules", () => {
    const marks = (q: string, text: string) => [...excerpt(remark(text), parseQuery(q).branches[0]).matchAll(/<mark>(.*?)<\/mark>/g)].map((m) => m[1]);
    expect(marks("tax", "Taxes, taxpayers and the tax.")).toEqual(["Taxes", "tax"]);
    expect(marks("tax*", "Taxes, taxpayers and the tax.")).toEqual(["Taxes", "taxpayers", "tax"]);
    expect(marks('"tax"', "Taxes, taxpayers and the tax.")).toEqual(["tax"]);
    expect(marks("governor", "The Governor's budget")).toEqual(["Governor's"]);
  });

  it("asks Pagefind for the bare words", () => {
    expect(pagefindTerms(parseQuery("tax* fares").branches[0])).toEqual(["tax fares"]);
    expect(pagefindTerms(parseQuery('"tax" NEAR cap').branches[0])).toEqual(["tax cap"]);
  });
});

describe("the shortcuts the filters beside the results show and change", () => {
  it("finds the ones outside brackets, where they stand, and whether a NOT or minus turns them round", () => {
    const q = '(tolls year:2020) speaker:Krueger committee:"Ways and Means" -year:2019 NOT type:floor year:2021-2023';
    expect(topShortcuts(q).map((t) => [t.field, t.value, t.negated, q.slice(t.start, t.end)])).toEqual([
      ["speaker", "Krueger", false, "speaker:Krueger"],
      ["committee", "Ways and Means", false, 'committee:"Ways and Means"'],
      ["year", "2019", true, "-year:2019"],
      ["type", "floor", true, "type:floor"],
      ["year", "2021-2023", false, "year:2021-2023"],
    ]);
  });

  it("writes runs of years as ranges", () => {
    expect(yearShortcuts([2024, 2019, 2020, 2022, 2023])).toBe("year:2019-2020 year:2022-2024");
    expect(yearShortcuts([2015])).toBe("year:2015");
    expect(yearShortcuts([])).toBe("");
  });
});

describe("a bill search keeps to the bill's own remarks", () => {
  const remark = (turn: number) => ({ url: `/t/#r-${turn}`, turn, page: 3, speaker: null, label: "", text: "Read the last section.", breaks: [] as [number, number][] });
  const places = billPlaces("A10176=632-643,700|S4149=12-20");

  it("reads the places a transcript records", () => {
    expect([...places!]).toEqual([["A10176", [[632, 643], [700, 700]]], ["S4149", [[12, 20]]]]);
    expect(billPlaces(undefined)).toBeUndefined();
  });

  it("keeps remarks in the bill's reading and debate, or that mention it, and only those", () => {
    const b = parseQuery("bill:A10176").branches[0];
    expect(keepRemark(remark(632), b, null, [], undefined, places)).toBe(true);
    expect(keepRemark(remark(643), b, null, [], undefined, places)).toBe(true);
    expect(keepRemark(remark(700), b, null, [], undefined, places)).toBe(true);
    expect(keepRemark(remark(1), b, null, [], undefined, places)).toBe(false);
    expect(keepRemark(remark(15), b, null, [], undefined, places)).toBe(false);
    // Without recorded places, a transcript keeps all its remarks.
    expect(keepRemark(remark(1), b)).toBe(true);
  });
});
