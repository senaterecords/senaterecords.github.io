import { describe, expect, it } from "vitest";
import {
  billStatus, committeeName, count, dayDate, hearingTitle, legalCite, legalDate, legalPages, longDate, outcomeText, pageLabel,
  placeText, plainCite, plainPages, plural, relativeTime, serviceText, shortDate, speakerForms, titleCase, transcriptTitle, weekdayDate,
} from "../../src/lib/format";

describe("dates and pages", () => {
  it("writes dates the way each place needs", () => {
    expect(longDate("2025-06-10")).toBe("June 10, 2025");
    expect(shortDate("2025-06-10")).toBe("Jun 10, 2025");
    expect(legalDate("2025-06-10")).toBe("June 10, 2025");
    expect(legalDate("2025-03-18")).toBe("Mar. 18, 2025");
    expect(legalDate("2025-09-02")).toBe("Sept. 2, 2025");
    expect(dayDate("2025-06-10")).toBe("Tue, Jun 10");
    expect(weekdayDate("2025-03-04")).toBe("Tuesday, March 4, 2025");
  });

  it("writes places readably", () => {
    expect(placeText("ALBANY, NEW YORK")).toBe("Albany, New York");
    expect(placeText("Hearing Room B\nLegislative Office Building\nAlbany, New York")).toBe("Hearing Room B, Legislative Office Building, Albany, New York");
    expect(placeText(null)).toBe("");
  });

  it("writes page numbers", () => {
    expect(pageLabel(5781)).toBe("p. 5781");
    expect(legalPages(5780)).toBe("5780");
    expect(legalPages(5780, 5781)).toBe("5780–81");
    expect(legalPages(5798, 5802)).toBe("5798–802");
    expect(legalPages(98, 102)).toBe("98–102");
    expect(plainPages(5780)).toBe("p. 5780");
    expect(plainPages(5780, 5781)).toBe("pp. 5780–5781");
  });
});

describe("service, names and titles", () => {
  it("describes service in plain words", () => {
    expect(serviceText([{ from: 2017, to: null }])).toBe("In the Senate since 2017");
    expect(serviceText([{ from: 2009, to: 2016 }])).toBe("In the Senate 2009–2016");
    expect(serviceText([{ from: 1993, to: 2006, beforeRecords: true }])).toBe("In the Senate since before 1993, until 2006");
    expect(serviceText([{ from: 1993, to: 1996 }, { from: 2001, to: 2002 }, { from: 2009, to: 2010 }]))
      .toBe("In the Senate 1993–1996, 2001–2002, 2009–2010");
    expect(serviceText([])).toBe("");
  });

  it("title-cases labels without breaking name particles", () => {
    expect(titleCase("ACTING PRESIDENT BRENNAN")).toBe("Acting President Brennan");
    expect(titleCase("SENATOR DeFRANCISCO")).toBe("Senator DeFrancisco");
    expect(titleCase("SENATOR O'MARA")).toBe("Senator O'Mara");
    expect(titleCase("SENATOR HASSELL-THOMPSON")).toBe("Senator Hassell-Thompson");
    expect(titleCase("THE STATE'S RESPONSE TO COVID-19")).toBe("The State's Response To Covid-19");
    expect(titleCase("DTF COMMISSIONER HILLER")).toBe("DTF Commissioner Hiller");
    expect(titleCase("MR. GUSDORF")).toBe("Mr. Gusdorf");
    expect(titleCase("SENATOR LYNCH AND MS. WYNN")).toBe("Senator Lynch And Ms. Wynn");
    expect(titleCase("MRS. SMITH, NYC DHCR")).toBe("Mrs. Smith, NYC DHCR");
  });

  it("makes all-capital hearing titles readable", () => {
    expect(hearingTitle("JOINT LEGISLATIVE HEARING ON THE EXECUTIVE BUDGET ON TAXES"))
      .toBe("Joint Legislative Hearing on the Executive Budget on Taxes");
    expect(hearingTitle("Roundtable on rent")).toBe("Roundtable on rent");
  });

  it("also fixes titles that are mostly capitals, as the API often sends them", () => {
    expect(hearingTitle("JOINT LEGISLATIVE HEARING In the Matter of the 2025-2026 EXECUTIVE BUDGET ON TAXES"))
      .toBe("Joint Legislative Hearing in the Matter of the 2025-2026 Executive Budget on Taxes");
    expect(hearingTitle("WAYS AND MEANS")).toBe("Ways and Means");
    expect(hearingTitle("Public hearing on the MTA capital plan")).toBe("Public hearing on the MTA capital plan");
  });

  it("names transcripts in lists", () => {
    expect(transcriptTitle({ kind: "floor", sessionType: "Regular Session", title: null })).toBe("Regular Session");
    expect(transcriptTitle({ kind: "floor", sessionType: null, title: null })).toBe("Floor session");
    expect(transcriptTitle({ kind: "hearing", sessionType: null, title: "JOINT LEGISLATIVE HEARING ON TAXES" })).toBe("Joint Legislative Hearing on Taxes");
    expect(transcriptTitle({ kind: "hearing", sessionType: null, title: "Transit safety" })).toBe("Public hearing: Transit safety");
    expect(transcriptTitle({ kind: "hearing", sessionType: null, title: "NEW YORK STATE FORUM ON RENT" })).toBe("New York State Forum on Rent");
    expect(transcriptTitle({ kind: "hearing", sessionType: null, title: null })).toBe("Public hearing");
  });

  it("lower-cases the small words in committee names", () => {
    expect(committeeName("Ways And Means")).toBe("Ways and Means");
    expect(committeeName("Corporations, Authorities And Commissions")).toBe("Corporations, Authorities and Commissions");
    expect(committeeName("FINANCE")).toBe("Finance");
    expect(committeeName("Labor")).toBe("Labor");
  });

  it("counts with the right noun", () => {
    expect(plural(1, "senator")).toBe("1 senator");
    expect(plural(38, "senator")).toBe("38 senators");
    expect(plural(1204, "remark")).toBe("1,204 remarks");
  });

  it("names speakers for citations", () => {
    expect(speakerForms("senator", "SENATOR ORTEGA", "Marisol Ortega")).toEqual({ short: "Sen. Ortega", full: "Sen. Marisol Ortega" });
    expect(speakerForms("senator", "ACTING PRESIDENT BRENNAN", "Paul Brennan")).toEqual({ short: "Sen. Brennan", full: "Sen. Paul Brennan" });
    expect(speakerForms("senator", "SENATOR GOLD", null)).toEqual({ short: "Sen. Gold", full: "Sen. Gold" });
    expect(speakerForms("assembly", "ASSEMBLYMAN RA", "Edward P. Ra")).toEqual({ short: "Asm. Ra", full: "Asm. Edward P. Ra" });
    expect(speakerForms("secretary", "THE SECRETARY")).toEqual({ short: "the Secretary", full: "the Secretary" });
    expect(speakerForms("president", "THE PRESIDENT", "Antonio Delgado")).toEqual({ short: "the President", full: "Lt. Gov. Antonio Delgado" });
    expect(speakerForms("other", "MS. HERNANDEZ")).toEqual({ short: "Ms. Hernandez", full: "Ms. Hernandez" });
  });
});

describe("citations", () => {
  const floor = { kind: "floor" as const, date: "2025-06-10", title: null, start: 5780,
                  speaker: { short: "Sen. Ortega", full: "Sen. Marisol Ortega" } };
  const hearing = { kind: "hearing" as const, date: "2025-03-18", title: "MTA Capital Program", start: 112,
                    speaker: { short: "Sen. Okafor", full: "Sen. Adaeze Okafor" } };

  it("writes the legal citation by default", () => {
    expect(legalCite(floor)).toBe("N.Y. Senate Tr., June 10, 2025, at 5780 (remarks of Sen. Ortega)");
    expect(legalCite({ ...floor, end: 5781 })).toBe("N.Y. Senate Tr., June 10, 2025, at 5780–81 (remarks of Sen. Ortega)");
    expect(legalCite(hearing)).toBe("N.Y. Senate Pub. Hr'g Tr., MTA Capital Program, Mar. 18, 2025, at 112 (remarks of Sen. Okafor)");
  });

  it("writes the plain citation on request", () => {
    expect(plainCite(floor)).toBe("NY Senate floor transcript, June 10, 2025, p. 5780 (Sen. Marisol Ortega)");
    expect(plainCite(hearing)).toBe("NY Senate public hearing, MTA Capital Program, March 18, 2025, p. 112 (Sen. Adaeze Okafor)");
  });
});

describe("outcomes, status, time", () => {
  it("says what happened on the floor in plain words", () => {
    const seg = { debated: true, outcome: "passed" as const, ayes: 41, nays: 20 };
    expect(outcomeText(seg)).toBe("Debated and passed, 41–20");
    expect(outcomeText({ ...seg, debated: false })).toBe("Passed, 41–20");
    expect(outcomeText({ debated: false, outcome: "laid_aside", ayes: null, nays: null })).toBe("Brought up, then laid aside. No vote.");
    expect(outcomeText({ debated: false, outcome: "adopted", ayes: null, nays: null })).toBe("Adopted");
    expect(outcomeText({ debated: false, outcome: null, ayes: null, nays: null })).toBe("Read on the floor. No vote recorded.");
  });

  it("flags a bill's status", () => {
    const card = { vetoed: false, signed: false, status: { text: "Passed Senate", type: "PASSED_SENATE", date: null } };
    expect(billStatus(card as never)).toEqual({ text: "Passed Senate", tone: "ink" });
    expect(billStatus({ ...card, vetoed: true } as never)).toEqual({ text: "Vetoed", tone: "red" });
    expect(billStatus({ ...card, signed: true } as never)).toEqual({ text: "Signed by Governor", tone: "ink" });
    expect(billStatus({ ...card, status: { text: "Amended", type: null, date: null } } as never)).toEqual({ text: "Amended", tone: "amber" });
    expect(billStatus(null)).toBeNull();
  });

  it("writes relative times and counts", () => {
    const now = new Date("2025-06-10T18:40:00");
    expect(relativeTime("2025-06-10T18:00:00", now)).toBe("40 min ago");
    expect(relativeTime("2025-06-10T15:40:00", now)).toBe("3 hours ago");
    expect(relativeTime("2025-06-08T18:40:00", now)).toBe("2 days ago");
    expect(count(30004)).toBe("30,004");
  });
});
