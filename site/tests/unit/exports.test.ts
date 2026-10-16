import { describe, expect, it } from "vitest";
import { resultsBlocks, resultsCsv, senatorBlocks, senatorCsv } from "../../src/lib/exports";

const item = {
  date: "2025-03-04", record: "Floor · Regular", transcript: "Regular Session, March 4, 2025", speaker: "Sen. Liz Krueger", page: 851,
  excerpt: "… the toll revenue …", text: "We need the toll revenue, Mr. President.", cite: "N.Y. Senate Tr., Mar. 4, 2025, at 851 (remarks of Sen. Krueger)",
  link: "https://senaterecords.github.io/transcripts/2025-03-04-regular-session/?hl=x#r-15",
};

describe("search results as a Word document", () => {
  it("leads with the search and its counts, then each remark with its citation and a link to it", () => {
    const blocks = resultsBlocks('"toll revenue"', "1 remark in 1 transcript", [item]);
    expect(blocks[0]).toEqual({ kind: "title", text: 'Search: "toll revenue"' });
    expect(blocks[1].text).toBe("1 remark in 1 transcript");
    expect(blocks).toContainEqual({ kind: "heading", text: "March 4, 2025 · Sen. Liz Krueger · p. 851" });
    expect(blocks).toContainEqual({ kind: "para", text: "We need the toll revenue, Mr. President." });
    expect(blocks).toContainEqual({ kind: "meta", runs: [{ text: `${item.cite} · ` }, { text: "Read in context", link: item.link }] });
  });
});

describe("search results as a spreadsheet", () => {
  it("has one row per remark under plain column names", () => {
    const rows = resultsCsv([item]).slice(1).split("\r\n");
    expect(rows[0]).toBe("Date,Record,Transcript,Speaker,Page,Excerpt,Full remark,Citation,Link");
    expect(rows[1]).toBe(`2025-03-04,Floor · Regular,"Regular Session, March 4, 2025",Sen. Liz Krueger,851,… the toll revenue …,"We need the toll revenue, Mr. President.","${item.cite}",${item.link}`); // the citation has commas, so it is quoted
  });
});

const senator = {
  name: "Liz Krueger", service: "Senator since 2002", slug: "liz-krueger",
  recent: [{ date: "2025-03-04", page: 851, text: "We need the toll revenue.", href: "/transcripts/2025-03-04-regular-session/#r-15", kind: "floor", title: "Regular Session" }],
  appearances: [{ date: "2025-03-04", title: "Regular Session", kind: "floor", remarks: 3, presiding: 1, href: "/transcripts/2025-03-04-regular-session/#r-15" }],
};
const abs = (href: string) => `https://senaterecords.github.io${href}`;

describe("a senator's remarks as a Word document and a spreadsheet", () => {
  it("lists the recent remarks and every transcript, with links", () => {
    const blocks = senatorBlocks(senator, "https://senaterecords.github.io/senators/liz-krueger/", abs);
    expect(blocks[0]).toEqual({ kind: "title", text: "Liz Krueger" });
    expect(blocks).toContainEqual({ kind: "heading", text: "Recent remarks" });
    expect(blocks).toContainEqual({ kind: "para", runs: [{ text: "March 4, 2025, p. 851: ", bold: true }, { text: "“We need the toll revenue.” " }, { text: "Read in context", link: abs(senator.recent[0].href) }] });
    expect(blocks).toContainEqual({ kind: "heading", text: "Transcripts" });
    expect(blocks).toContainEqual({ kind: "para", runs: [{ text: "March 4, 2025, Regular Session: ", bold: true }, { text: "3 remarks, presiding once " }, { text: "Open", link: abs(senator.appearances[0].href) }] });
  });

  it("gives one spreadsheet row per transcript", () => {
    const rows = senatorCsv(senator, abs).slice(1).split("\r\n");
    expect(rows[0]).toBe("Date,Record,Transcript,Remarks,Presiding,Link");
    expect(rows[1]).toBe(`2025-03-04,Floor session,Regular Session,3,1,${abs(senator.appearances[0].href)}`);
  });
});
