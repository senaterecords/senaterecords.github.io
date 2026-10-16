import { describe, expect, it } from "vitest";
import { floorAppearances } from "../../src/lib/bills";
import type { BillSegment } from "../../src/lib/types";

const seg = (date: string, startTurn: number, remarks: number, debated = remarks > 0) =>
  ({ transcript: `${date}-regular-session`, date, startTurn, remarks, debated }) as BillSegment;

describe("a bill's appearances on the floor", () => {
  it("leads with the longest debate and splits the rest into earlier and later", () => {
    const first = seg("2025-03-04", 10, 0);
    const main = seg("2025-04-01", 50, 12);
    const short = seg("2025-05-06", 20, 2);
    const last = seg("2025-06-10", 5, 0);
    expect(floorAppearances([last, main, first, short])).toEqual({ main, earlier: [first], later: [last, short] });
  });

  it("lists every reading as earlier when there was no debate", () => {
    const a = seg("2025-03-04", 10, 0);
    const b = seg("2025-04-01", 50, 0);
    expect(floorAppearances([a, b])).toEqual({ main: null, earlier: [b, a], later: [] });
  });
});
