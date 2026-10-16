import { describe, expect, it } from "vitest";
import { markdownEscape } from "../../src/lib/download";

describe("Markdown export", () => {
  it("keeps transcript text from turning into headings, lists or links", () => {
    expect(markdownEscape("# 1 on the calendar")).toBe(String.raw`\# 1 on the calendar`);
    expect(markdownEscape("1. The first item")).toBe(String.raw`1\. The first item`);
    expect(markdownEscape("- a dash")).toBe(String.raw`\- a dash`);
    expect(markdownEscape("> quoted")).toBe(String.raw`\> quoted`);
    expect(markdownEscape("a *b* [c] _d_ `e` <f>")).toBe(String.raw`a \*b\* \[c\] \_d\_ \`e\` \<f>`);
    expect(markdownEscape("Mr. President, 2.5 percent")).toBe("Mr. President, 2.5 percent");
  });
});
