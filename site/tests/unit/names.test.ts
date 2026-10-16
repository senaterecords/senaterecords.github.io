import { describe, expect, it } from "vitest";
import { findPeople, fold, matchName, resolveSpeaker, type Person } from "../../src/lib/names";

const person = (slug: string, name: string, remarks = 1, chamber: "senate" | "assembly" = "senate"): Person =>
  ({ slug, name, chamber, photo: null, detail: "", remarks });

const PEOPLE = [
  person("liz-krueger", "Liz Krueger", 9000),
  person("carl-kruger", "Carl Kruger", 3000),
  person("andrea-stewart-cousins", "Andrea Stewart-Cousins", 5000),
  person("luis-r-sepulveda", "Luis R. Sepúlveda", 800),
  person("thomas-f-omara", "Thomas F. O'Mara", 700),
  person("ada-l-smith", "Ada L. Smith", 2000),
  person("malcolm-a-smith", "Malcolm A. Smith", 2500),
  person("j-gary-pretlow", "J. Gary Pretlow", 90, "assembly"),
];

describe("name matching", () => {
  it("folds case, accents and apostrophes", () => {
    expect(fold("Sepúlveda")).toBe("sepulveda");
    expect(fold("O'Mara")).toBe("omara");
    expect(fold("Stewart-Cousins")).toBe("stewart cousins");
  });

  it("matches the start of any part of the name", () => {
    expect(matchName("liz", "Liz Krueger")).toEqual([[0, 3]]);
    expect(matchName("cousins", "Andrea Stewart-Cousins")).toEqual([[15, 22]]);
    expect(matchName("sepul", "Luis R. Sepúlveda")).toEqual([[8, 13]]);
    expect(matchName("omara", "Thomas F. O'Mara")).toEqual([[10, 16]]);
    expect(matchName("o'mara", "Thomas F. O'Mara")).toEqual([[10, 16]]);
    expect(matchName("liz kr", "Liz Krueger")).toEqual([[0, 3], [4, 6]]);
    expect(matchName("rueger", "Liz Krueger")).toBeNull();
  });

  it("lists senators before Assembly members, most remarks first", () => {
    expect(findPeople("kru", PEOPLE).map((m) => m.person.slug)).toEqual(["liz-krueger", "carl-kruger"]);
    expect(findPeople("g", PEOPLE).map((m) => m.person.slug)).toEqual(["j-gary-pretlow"]);
  });

  it("never guesses between people who share a name", () => {
    expect(resolveSpeaker("smith", PEOPLE).map((p) => p.slug)).toEqual(["malcolm-a-smith", "ada-l-smith"]);
    expect(resolveSpeaker("ada-l-smith", PEOPLE).map((p) => p.slug)).toEqual(["ada-l-smith"]);
    expect(resolveSpeaker("krueger", PEOPLE).map((p) => p.slug)).toEqual(["liz-krueger"]);
  });
});
