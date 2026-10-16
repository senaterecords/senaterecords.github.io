import { describe, expect, it } from "vitest";
import { timelineSteps } from "../../src/lib/format";

describe("bill timeline", () => {
  it("shows done milestones and the steps still ahead", () => {
    const card = { basePrintNo: "S4597", milestones: [
      { type: "INTRODUCED", text: "Introduced", date: "2025-01-08" },
      { type: "IN_SENATE_COMM", text: "In Senate Committee", date: "2025-02-04" },
      { type: "PASSED_SENATE", text: "Passed Senate", date: "2025-06-10" }] };
    expect(timelineSteps(card as never)).toEqual([
      { label: "Introduced", date: "2025-01-08", done: true },
      { label: "In Senate committee", date: "2025-02-04", done: true },
      { label: "Passed Senate", date: "2025-06-10", done: true },
      { label: "Passed Assembly", date: null, done: false },
      { label: "Delivered to Governor", date: null, done: false },
      { label: "Governor", date: null, done: false },
    ]);
  });

  it("stops at the Governor's action", () => {
    const card = { basePrintNo: "A10000", milestones: [
      { type: "PASSED_ASSEMBLY", text: "Passed Assembly", date: "2026-05-27" },
      { type: "SIGNED_BY_GOV", text: "Signed by Governor", date: "2026-06-09" }] };
    expect(timelineSteps(card as never).every((s) => s.done)).toBe(true);
  });
});
