import { expect, test } from "@playwright/test";

test("a phrase search returns remarks with the phrase highlighted", async ({ page }) => {
  await page.goto("search/?q=%22executive%20budget%22");
  const first = page.locator("[data-result]").first();
  await expect(first).toBeVisible();
  await expect(first.locator("mark").first()).toHaveText(/executive budget/i);
  await expect(page.getByText(/\d+ remarks? in \d+ transcripts?/)).toBeVisible();
});

test("speaker: keeps only that speaker's remarks", async ({ page }) => {
  await page.goto("search/?q=budget%20speaker%3Aliz-krueger");
  const results = page.locator("[data-result]");
  await expect(results.first()).toBeVisible();
  const speakers = await results.locator("[data-speaker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speaker")));
  expect(new Set(speakers)).toEqual(new Set(["liz-krueger"]));
});

test("a shared name asks which person", async ({ page }) => {
  await page.goto("search/?q=speaker%3Asmith");
  await expect(page.getByText(/^Which smith\?/i)).toBeVisible();
});

test("NOT removes remarks with the word", async ({ page }) => {
  await page.goto("search/?q=budget%20NOT%20tax");
  await expect(page.locator("[data-result]").first()).toBeVisible(); // results arrive after the page loads
  const texts = await page.locator("[data-result] .q").allInnerTexts();
  expect(texts.length).toBeGreaterThan(0);
  for (const t of texts) expect(t.toLowerCase()).not.toMatch(/\btax/);
});

test("a year range finds transcripts from any year in it", async ({ page }) => {
  await page.goto("search/?q=budget%20year%3A2020-2025");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  const dates = await page.locator("[data-result] .c-date b").allInnerTexts();
  for (const d of dates) expect(Number(d.slice(-4))).toBeGreaterThanOrEqual(2020);
});

test("committee: narrows to that committee's hearings, whatever the case typed", async ({ page }) => {
  await page.goto("search/?q=budget%20committee%3A%22ways%20and%20means%22");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  const kinds = await page.locator("[data-result] .c-date span").allInnerTexts();
  for (const k of kinds) expect(k).toMatch(/^Hearing/);
});

test("facets count the results and narrow the search when clicked", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=budget");
  const facets = page.getByRole("complementary", { name: "Narrow the results" });
  await facets.getByRole("button", { name: /Public hearings/ }).click();
  await expect(page).toHaveURL(/q=budget(\+|%20)type%3Ahearing/);
  await expect(page.locator("[data-result]").first()).toBeVisible();
});

test("a remark's excerpt doesn't repeat the speaker's name", async ({ page }) => {
  await page.goto("search/?q=%22executive%20budget%22");
  const first = page.locator("[data-result]").first();
  const name = (await first.locator("[data-speaker]").innerText()).replace(/^(Sen\.|Asm\.) /, "");
  expect((await first.locator(".q").innerText()).toLowerCase().startsWith(name.toLowerCase())).toBe(false);
});

test("a sentence split by a page break reads as one sentence in results", async ({ page }) => {
  await page.goto("search/?q=%22steady%20job%20growth%22");
  const first = page.locator("[data-result] .q").first();
  await expect(first).toContainText("job growth");
  await expect(first).not.toContainText("The. Division");
});

test("a search with no results suggests a spelling", async ({ page }) => {
  await page.goto("search/?q=budgett");
  await expect(page.getByRole("link", { name: /Did you mean/ })).toBeVisible();
});

test("search says so when it cannot load", async ({ page }) => {
  await page.route("**/pagefind/pagefind.js", (route) => route.abort());
  await page.goto("search/?q=budget");
  await expect(page.getByText("Search couldn't load. Check your connection and try again.")).toBeVisible();
});

test("phone filters live behind one button", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto("search/?q=budget");
  await page.getByRole("button", { name: /^Filters/ }).tap();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
});

test("a filter already in the search shows as ticked", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=budget%20type%3Ahearing");
  const facets = page.getByRole("complementary", { name: "Narrow the results" });
  await expect(facets.getByRole("button", { name: /Public hearings/ })).toHaveAttribute("aria-pressed", "true");
});

const LOAD_FAILED = "Search couldn't load. Check your connection and try again.";

test("two phrases find the remarks that hold both", async ({ page }) => {
  await page.goto("search/?q=%22executive%20budget%22%20%22steady%20job%20growth%22");
  await expect(page.locator("[data-result] mark", { hasText: /steady job growth/i }).first()).toBeVisible();
});

test("a phrase with another word finds the remarks that hold both", async ({ page }) => {
  await page.goto("search/?q=%22executive%20budget%22%20growth");
  await expect(page.locator("[data-result]").first()).toBeVisible();
});

test("search says so when part of the index fails to load", async ({ page }) => {
  await page.route("**/pagefind/fragment/**", (route) => route.abort());
  await page.goto("search/?q=budget");
  await expect(page.getByText(LOAD_FAILED)).toBeVisible();
});

test("search says so when the word index fails to load", async ({ page }) => {
  await page.route("**/pagefind/index/**", (route) => route.abort());
  await page.goto("search/?q=budget");
  await expect(page.getByText(LOAD_FAILED)).toBeVisible();
});

test("the search box keeps up when a filter is clicked", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=budget");
  await page.getByRole("complementary", { name: "Narrow the results" }).getByRole("button", { name: /Public hearings/ }).click();
  await expect(page).toHaveURL(/type%3Ahearing/);
  await expect(page.getByRole("searchbox")).toHaveValue("budget type:hearing");
});

test("a remark's page is the page the quote is on", async ({ page }) => {
  await page.goto("search/?q=%22Campaign%20for%20Fiscal%20Equity%22");
  const row = page.locator("[data-result]").first();
  await expect(row.locator(".pg")).toHaveText("p. 851");
  await expect(row.getByRole("button", { name: "Copy cite" })).toHaveAttribute("data-copy", /, at 850–51 \(remarks/);
});

test("bill: with a session searches only that session's bill", async ({ page }) => {
  await page.goto("search/?q=bill%3AS50025%2F2009");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  await page.goto("search/?q=bill%3AS50025%2F2013");
  await expect(page.getByText("No remarks match.")).toBeVisible();
});

test("a committee filter shows as ticked and a second click takes it out", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=budget%20committee%3A%22Ways%20and%20Means%22");
  const button = page.getByRole("complementary", { name: "Narrow the results" }).getByRole("button", { name: /Ways and Means/ });
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect(page).toHaveURL(/\?q=budget$/);
});

test("a transcript without speaker labels can be found", async ({ page }) => {
  await page.goto("search/?q=%22Elmira%20Correctional%22");
  await expect(page.locator("[data-result] a.ctx[href*='1995-05-09-test-plain-text']")).toBeVisible();
});

test("results can be narrowed to a bill", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=senate");
  const facets = page.getByRole("complementary", { name: "Narrow the results" });
  await expect(facets.getByRole("heading", { name: "Bill" })).toBeVisible();
  await facets.locator(".fg", { has: page.getByRole("heading", { name: "Bill" }) }).getByRole("button").first().click();
  await expect(page).toHaveURL(/bill%3A[SA]\d+/);
});

test("exporting results lets go of the file afterwards", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.addInitScript(() => {
    const w = window as unknown as { __revoked: number };
    w.__revoked = 0;
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u: string) => { w.__revoked += 1; revoke(u); };
  });
  await page.goto("search/?q=budget");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export results" }).click();
  await download;
  await expect.poll(() => page.evaluate(() => (window as unknown as { __revoked: number }).__revoked)).toBeGreaterThan(0);
});

test("the phone filters sheet takes the focus", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto("search/?q=budget");
  await page.getByRole("button", { name: /^Filters/ }).tap();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeFocused();
});
