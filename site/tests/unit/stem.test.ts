import { describe, expect, it } from "vitest";
import { stem } from "../../src/lib/stem";

describe("the English stemmer the index uses", () => {
  it("brings a word's forms to one stem", () => {
    for (const w of ["tax", "taxes", "taxed", "taxing"]) expect(stem(w), w).toBe("tax");
    for (const w of ["toll", "tolls", "tolled", "tolling"]) expect(stem(w), w).toBe("toll");
    for (const w of ["hope", "hoped", "hoping", "hopes"]) expect(stem(w), w).toBe("hope");
    for (const w of ["run", "running", "runs"]) expect(stem(w), w).toBe("run");
    for (const w of ["sad", "sadly", "sadness"]) expect(stem(w), w).toBe("sad");
  });

  it("keeps apart words that only start alike", () => {
    expect(stem("saddle")).toBe("saddl");
    expect(stem("sadie")).toBe("sadi");
    expect(stem("taxi")).toBe("taxi");
    expect(stem("taxpayer")).toBe("taxpay");
    expect(stem("general")).toBe("general");
    expect(stem("generous")).toBe("generous");
  });

  it("follows the classic algorithm's special cases", () => {
    expect(stem("ponies")).toBe("poni");
    expect(stem("ties")).toBe("tie");
    expect(stem("relational")).toBe("relat");
    expect(stem("skies")).toBe("sky");
    expect(stem("news")).toBe("news");
    expect(stem("proceed")).toBe("proceed");
    expect(stem("happy")).toBe("happi");
    expect(stem("by")).toBe("by");
  });
});
