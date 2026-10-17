import { describe, expect, it } from "vitest";
import { inOrder } from "../../src/lib/order";

const r = (id: string, score = 0) => ({ id, score });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe("the transcripts several searches found, in one order", () => {
  it("leaves a single search's order alone", () => {
    expect(ids(inOrder([[r("b", 1), r("a", 5)]], "relevance", null))).toEqual(["b", "a"]);
  });

  it("by relevance, interleaves the searches by score and counts a transcript found twice once, at its best", () => {
    const tolls = [r("t1", 9), r("t2", 4), r("both", 3)];
    const fares = [r("f1", 7), r("both", 8), r("f2", 1)];
    expect(ids(inOrder([tolls, fares], "relevance", null))).toEqual(["t1", "both", "f1", "t2", "f2"]);
  });

  it("by date, newest or oldest first, across the searches", () => {
    const dates = { t1: "2025-03-04", t2: "2019-05-01", f1: "2024-01-10", f2: "1997-06-02", both: "2021-06-03" };
    const tolls = [r("t1"), r("both"), r("t2")];
    const fares = [r("f1"), r("both"), r("f2")];
    expect(ids(inOrder([tolls, fares], "newest", dates))).toEqual(["t1", "f1", "both", "t2", "f2"]);
    expect(ids(inOrder([tolls, fares], "oldest", dates))).toEqual(["f2", "t2", "both", "f1", "t1"]);
  });

  it("without the dates, keeps each search's own order, one after the other", () => {
    expect(ids(inOrder([[r("a"), r("b")], [r("c"), r("a")]], "newest", null))).toEqual(["a", "b", "c"]);
  });
});
