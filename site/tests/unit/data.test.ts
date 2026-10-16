import { describe, expect, it } from "vitest";
import * as data from "../../src/lib/data";

describe("the fixture data", () => {
  it("lists every transcript newest first, the synthetic plain-text one included", () => {
    const index = data.transcriptIndex();
    expect(index.map((t) => t.slug)).toContain("2025-03-04-regular-session");
    expect(index[0].date >= index[index.length - 1].date).toBe(true);
    expect(index.find((t) => t.slug === "1995-05-09-test-plain-text")?.plainText).toBe(true);
  });

  it("reads a transcript with its turns and calendar", () => {
    const doc = data.transcript("2025-03-04-regular-session");
    expect(doc.kind).toBe("floor");
    expect(doc.segments.length).toBe(16);
    expect(doc.turns[0].i).toBe(0);
  });

  it("counts what the fixture holds", () => {
    expect(data.meta().counts.floorTranscripts).toBe(6); // five sessions and one pro forma legislative day
    expect(data.meta().counts.hearings).toBe(2);
  });

  it("maps senators by slug and by member id", () => {
    expect(data.senatorsBySlug().get("liz-krueger")?.memberId).toBe(401);
    expect(data.senatorsByMemberId().get(401)?.slug).toBe("liz-krueger");
  });

  it("gives every bill from 2009 on a page, and pre-2009 bills only when read on the floor", () => {
    const pages = data.billPages();
    expect(pages.some((p) => p.session === 2009 && p.base === "S50025")).toBe(true);
    expect(pages.filter((p) => p.session < 2009).every((p) => (data.bill(p.session, p.base)?.segments.length ?? 0) > 0)).toBe(true);
  });

  it("says whether a bill has a page, by the same rule that makes the pages", () => {
    for (const p of data.billPages()) expect(data.hasBillPage(p.session, p.base)).toBe(true);
    expect(data.hasBillPage(1995, "A3147")).toBe(false); // in the data, never read on the floor
    expect(data.hasBillPage(2025, "S99999")).toBe(false);
  });

  it("lists years with transcript counts, newest first", () => {
    const years = data.years();
    expect(years[0].year).toBeGreaterThan(years[years.length - 1].year);
    expect(years.find((y) => y.year === 1995)?.count).toBe(2);
  });
});
