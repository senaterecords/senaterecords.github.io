import { describe, expect, it } from "vitest";
import { packReader, unpackReader, type ReaderPayload } from "../../src/lib/payload";

const data: ReaderPayload = {
  slug: "2025-03-04-regular-session", kind: "floor", date: "2025-03-04", title: "Regular Session", session: 2025,
  speakers: {
    "liz-krueger": { key: "liz-krueger", kind: "senator", name: "Sen. Liz Krueger", photo: "/photos/liz-krueger.jpg", line1: "District 28 · In the Senate since 2002", line2: "22,581 remarks in 849 transcripts", url: "/senators/liz-krueger/", officialUrl: "https://www.nysenate.gov/senators/liz-krueger" },
    secretary: { key: "secretary", kind: "secretary", name: "The Secretary", photo: null, line1: "Reads bills and calls the roll.", line2: "", url: null, officialUrl: null },
  },
  segments: [
    { calNo: 441, printNo: "S172", startTurn: 154, endTurn: 172, debateEnd: 172, debated: true, title: "Increases short-term disability benefits",
      status: { text: "In Assembly Committee", tone: "ink" }, sponsor: "Sen. Jessica Ramos", url: "/bills/2025/S172/", outcome: "passed", ayes: 50, nays: 11, remarks: 6 },
    { calNo: 9, printNo: null, startTurn: 3, endTurn: 4, debateEnd: 4, debated: false, title: null, status: null, sponsor: null, url: null, outcome: null, ayes: null, nays: null, remarks: 0 },
  ],
};

describe("the reader's embedded data", () => {
  it("packs smaller and unpacks to the same data", () => {
    const packed = packReader(data);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(data).length * 0.75);
    expect(unpackReader(JSON.parse(JSON.stringify(packed)))).toEqual(data);
  });
});
