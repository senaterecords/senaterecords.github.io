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

  it("goes on as the bill substituted for it", () => {
    const card = { basePrintNo: "S4006", milestones: [
      { type: "IN_SENATE_COMM", text: "In Senate Committee", date: "2023-01-20" },
      { type: "SENATE_FLOOR", text: "Senate Floor Calendar", date: "2023-05-02" }],
      substitutedBy: { printNo: "A3006C", basePrintNo: "A3006", date: "2023-05-02", milestones: [
        { type: "SIGNED_BY_GOV", text: "Signed by Governor", date: "2023-05-03" },
        { type: "PASSED_SENATE", text: "Passed Senate", date: "2023-05-02" },
        { type: "PASSED_ASSEMBLY", text: "Passed Assembly", date: "2023-05-01" }] } };
    expect(timelineSteps(card as never)).toEqual([
      { label: "In Senate committee", date: "2023-01-20", done: true },
      { label: "On the Senate floor", date: "2023-05-02", done: true },
      { label: "Substituted by A3006C", date: "2023-05-02", done: true },
      { label: "Passed Assembly", date: "2023-05-01", done: true },
      { label: "Passed Senate", date: "2023-05-02", done: true },
      { label: "Signed by Governor", date: "2023-05-03", done: true },
    ]);
    // Not yet signed: the steps ahead are the substitute's (an Assembly bill's path).
    const pending = { ...card, substitutedBy: { ...card.substitutedBy, milestones: card.substitutedBy.milestones.slice(1) } };
    expect(timelineSteps(pending as never).filter((s) => !s.done).map((s) => s.label)).toEqual(["Delivered to Governor", "Governor"]);
  });
});
