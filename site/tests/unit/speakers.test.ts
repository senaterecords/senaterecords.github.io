import { describe, expect, it } from "vitest";
import * as data from "../../src/lib/data";
import { speakerData } from "../../src/lib/speakers";

const ctx = () => ({ senatorsBySlug: data.senatorsBySlug(), assembly: data.assembly(), pageSlugs: data.senatorPageSlugs() });

describe("speaker cards data", () => {
  it("describes the senators, officers and Assembly members of a joint hearing", () => {
    const doc = data.transcript("2025-02-27-joint-legislative-hearing-in-the-matter-of-the-2025-2026-executive-budget-on-taxes");
    const { speakers, keyOf } = speakerData(doc, ctx());
    expect(speakers["liz-krueger"].name).toBe("Sen. Liz Krueger");
    expect(speakers["liz-krueger"].line1).toMatch(/^District \d+ · In the Senate since 2002$/);
    const asm = Object.values(speakers).find((s) => s.kind === "assembly");
    expect(asm?.name.startsWith("Asm. ")).toBe(true);
    expect(asm?.url).toBeNull();
    const firstKrueger = doc.turns.find((t) => t.senator === "liz-krueger")!;
    expect(keyOf(firstKrueger)).toBe("liz-krueger");
  });

  it("names the Secretary from the cover and the Lieutenant Governor by term", () => {
    const doc = data.transcript("2025-03-04-regular-session");
    const { speakers } = speakerData(doc, ctx());
    expect(speakers.secretary.line2).toBe("Secretary of the Senate at the time: Alejandra N. Paulino");
    if (doc.officers.president) expect(speakers.president.name).toBe("Lt. Gov. Antonio Delgado");
  });

  it("describes a senator from before 2009 without a photo", () => {
    const doc = data.transcript("1995-05-08-regular-session");
    const { speakers } = speakerData(doc, ctx());
    const old = Object.values(speakers).find((s) => s.kind === "senator" && s.photo === null);
    expect(old).toBeDefined();
    expect(old!.line1).toMatch(/In the Senate/);
  });
});
