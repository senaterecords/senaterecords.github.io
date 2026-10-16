import { describe, expect, it } from "vitest";
import { replaceToken, tokenAt } from "../../src/lib/suggest";

describe("the token at the caret", () => {
  it("finds a shortcut being typed and its text so far", () => {
    expect(tokenAt("budget speaker:krue", 19)).toEqual({ field: "speaker", text: "krue", start: 7, end: 19 });
    expect(tokenAt('committee:"ways an', 18)).toEqual({ field: "committee", text: "ways an", start: 0, end: 18 });
    expect(tokenAt("year:19 rent", 7)).toEqual({ field: "year", text: "19", start: 0, end: 7 });
  });

  it("offers a shortcut for the start of its name", () => {
    expect(tokenAt("rent ye", 7)).toEqual({ field: null, text: "ye", start: 5, end: 7 });
    expect(tokenAt("budget", 6)).toBeNull();
    expect(tokenAt("y", 1)).toBeNull();
  });

  it("offers a shortcut only for part of its name, so whole words like bill or year stay words", () => {
    expect(tokenAt("school bil", 10)).toEqual({ field: null, text: "bil", start: 7, end: 10 });
    expect(tokenAt("school bill", 11)).toBeNull();
    expect(tokenAt("budget year", 11)).toBeNull();
    expect(tokenAt("rules committee", 15)).toBeNull();
  });

  it("replaces the token and puts the caret after it", () => {
    expect(replaceToken("budget speaker:krue", { start: 7, end: 19 }, "speaker:liz-krueger", true)).toEqual({ value: "budget speaker:liz-krueger ", caret: 27 });
    expect(replaceToken("rent ye", { start: 5, end: 7 }, "year:", false)).toEqual({ value: "rent year:", caret: 10 });
    expect(replaceToken("year:19 rent", { start: 0, end: 7 }, "year:1995", true)).toEqual({ value: "year:1995 rent", caret: 10 });
  });
});

describe("senator:", () => {
  it("is a shortcut like speaker:", () => {
    expect(tokenAt("budget senator:krue", 19)).toEqual({ field: "senator", text: "krue", start: 7, end: 19 });
    expect(tokenAt("budget sen", 10)).toEqual({ field: null, text: "sen", start: 7, end: 10 });
  });
});

describe("inside brackets and after a minus", () => {
  it("finds a shortcut that follows a bracket or a minus, and stops at a closing bracket", () => {
    expect(tokenAt("(tolls speaker:krue", 19)).toEqual({ field: "speaker", text: "krue", start: 7, end: 19 });
    expect(tokenAt("(speaker:krue", 13)).toEqual({ field: "speaker", text: "krue", start: 1, end: 13 });
    expect(tokenAt("tolls -speaker:krue", 19)).toEqual({ field: "speaker", text: "krue", start: 7, end: 19 });
    expect(tokenAt("(tolls speaker:kr) OR fares", 17)).toEqual({ field: "speaker", text: "kr", start: 7, end: 17 });
    expect(tokenAt("(tolls speaker:kr) OR fares", 16)).toEqual({ field: "speaker", text: "k", start: 7, end: 17 });
    expect(tokenAt("(ye", 3)).toEqual({ field: null, text: "ye", start: 1, end: 3 });
  });

  it("puts no space before a closing bracket", () => {
    expect(replaceToken("(tolls speaker:kr) OR fares", { start: 7, end: 17 }, "speaker:liz-krueger", true)).toEqual({ value: "(tolls speaker:liz-krueger) OR fares", caret: 26 });
  });
});
