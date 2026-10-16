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
  await page.getByRole("button", { name: "Export results" }).click();
  const [sheet] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /Spreadsheet/ }).click()]);
  expect(sheet.suggestedFilename()).toBe("search-results.csv");
  const csv = Buffer.concat(await (await sheet.createReadStream()).toArray()).toString("utf8");
  expect(csv).toMatch(/^\uFEFFDate,Record,Transcript,Speaker,Page,Excerpt,Full remark,Citation,Link\r\n/);
  await page.getByRole("button", { name: "Export results" }).click();
  const [word] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /Word document/ }).click()]);
  expect(word.suggestedFilename()).toBe("search-results.docx");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __revoked: number }).__revoked)).toBeGreaterThan(1);
});

test("the phone filters sheet takes the focus", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto("search/?q=budget");
  await page.getByRole("button", { name: /^Filters/ }).tap();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeFocused();
});

test("while results load, placeholder rows shimmer and the page says what it is doing", async ({ page }) => {
  await page.route("**/pagefind/fragment/**", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.goto("search/?q=budget");
  await expect(page.locator(".rrow.skel").first()).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Searching .*\d+ possible transcripts?/);
  await expect(page.locator("[data-result]").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".rrow.skel")).toHaveCount(0);
});

test("long result lists show 25 remarks at a time", async ({ page }) => {
  await page.goto("search/?q=the");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  await expect(page.locator("[data-result]")).toHaveCount(25);
  await page.getByRole("button", { name: "Show more remarks" }).click();
  expect(await page.locator("[data-result]").count()).toBeGreaterThan(25);
});

test("opening a result lands on the passage it showed and washes it yellow for a moment", async ({ page }) => {
  await page.goto("search/?q=%22Campaign%20for%20Fiscal%20Equity%22");
  await page.locator("[data-result] a.ctx").first().click();
  await expect(page).toHaveURL(/\/transcripts\/2025-03-04-regular-session\/#r-25$/);
  const flash = page.locator(".flash").first();
  await expect(flash).toBeVisible();
  const phrase = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.getElementById("r-25")!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent!.indexOf("Campaign for Fiscal Equity");
      if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 8); const b = r.getBoundingClientRect(); return { x: b.x + 2, y: b.y + b.height / 2 }; }
    }
    return null;
  });
  const boxes = await page.locator(".flash").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  expect(boxes.some((b) => phrase!.x >= b.left && phrase!.x <= b.right && phrase!.y >= b.top && phrase!.y <= b.bottom)).toBe(true);
  await expect(page.locator(".flash")).toHaveCount(0, { timeout: 6000 });
});

test("a transcript opened from search offers the way back to the results", async ({ page }, info) => {
  await page.goto("search/?q=%22Campaign%20for%20Fiscal%20Equity%22");
  await page.locator("[data-result] a.ctx").first().click();
  await expect(page).toHaveURL(/#r-25$/);
  const back = page.getByRole("link", { name: info.project.name === "phone" ? "Back to search results" : "Search results" });
  await back.click();
  await expect(page).toHaveURL(/search\/\?q=%22Campaign/);
  await expect(page.locator("[data-result]").first()).toBeVisible();
});

test("the year filter lists years newest first, whatever their counts", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=the");
  const years = page.getByRole("complementary", { name: "Narrow the results" }).locator(".fg", { has: page.getByRole("heading", { name: "Year" }) }).locator(".fg-name");
  await expect(years.first()).toBeVisible();
  const list = (await years.allInnerTexts()).map(Number);
  expect(list.length).toBeGreaterThan(2);
  expect(list).toEqual([...list].sort((a, b) => b - a));
});

test("when no single remark has every phrase, the page says so and offers the transcripts that have them", async ({ page }) => {
  await page.goto("search/?q=%22Campaign%20for%20Fiscal%20Equity%22%20and%20%22Head%20Start%22");
  await expect(page.getByText(/No single remark has all of these/)).toBeVisible();
  await expect(page.getByText(/Did you mean/)).toHaveCount(0);
  await page.getByRole("button", { name: /Show matches across a whole transcript/ }).click();
  await expect(page).toHaveURL(/in=transcript/);
  // The rows stream in after the address changes: wait for both speakers rather than read the first frame.
  const speakers = () => page.locator("[data-result] [data-speaker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speaker")));
  await expect.poll(speakers).toEqual(expect.arrayContaining(["robert-jackson", "andrea-stewart-cousins"]));
  await expect(page.getByText(/in any remark of the same transcript/)).toBeVisible();
});

test("speaker: twice finds either person's remarks", async ({ page }) => {
  await page.goto("search/?q=speaker%3Aandrea-stewart-cousins%20speaker%3Arobert-jackson");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  const speakers = await page.locator("[data-result] [data-speaker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speaker")));
  expect(new Set(speakers)).toEqual(new Set(["andrea-stewart-cousins", "robert-jackson"]));
});

test("senator: finds a senator's remarks", async ({ page }) => {
  await page.goto("search/?q=budget%20senator%3Akrueger");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  const speakers = await page.locator("[data-result] [data-speaker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speaker")));
  expect(new Set(speakers)).toEqual(new Set(["liz-krueger"]));
});

test("a search with only a speaker reads one small index file, not the whole index", async ({ page }) => {
  const chunks: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/pagefind/index/")) chunks.push(r.url()); });
  await page.goto("search/?q=speaker%3Aliz-krueger");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  expect(chunks.length).toBeLessThanOrEqual(1);
});

test("ticking a year keeps the other years listed, and a second year adds to the search", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=the");
  const years = page.getByRole("complementary", { name: "Narrow the results" }).locator(".fg", { has: page.getByRole("heading", { name: "Year" }) });
  await expect(years.locator(".fg-row").nth(1)).toBeVisible();
  const before = await years.locator(".fg-name").allInnerTexts();
  await years.getByRole("button", { name: new RegExp(before[0]) }).click();
  await expect(page).toHaveURL(new RegExp(`year%3A${before[0]}`));
  await expect(years.locator(".fg-row")).toHaveCount(before.length);
  await years.getByRole("button", { name: new RegExp(before[1]) }).click();
  await expect(page).toHaveURL(new RegExp(`year%3A${before[0]}.*year%3A${before[1]}`));
  await expect(page.locator("[data-result]").first()).toBeVisible();
});

test("committee: twice finds hearings of either committee", async ({ page }) => {
  await page.goto("search/?q=committee%3ADisabilities%20committee%3A%22Ways%20and%20Means%22");
  // Filter-only searches list newest first, so the 2025 hearing fills the first screen; the count covers both.
  await expect(page.locator(".sr-head h1")).toContainText("in 2 transcripts");
});

test("each filter group shows its top entries, with the rest a click away", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=the");
  const group = page.getByRole("complementary", { name: "Narrow the results" }).locator(".fg", { has: page.getByRole("heading", { name: "Speaker" }) });
  await expect(group.locator(".fg-row")).toHaveCount(10);
  await group.getByRole("button", { name: /^All \d+ speakers$/ }).click();
  expect(await group.locator(".fg-row").count()).toBeGreaterThan(10);
  await group.getByRole("button", { name: "Fewer" }).click();
  await expect(group.locator(".fg-row")).toHaveCount(10);
});

test("ticking a speaker leaves the speaker list where it was: nothing drops out or moves", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("search/?q=the");
  const group = page.getByRole("complementary", { name: "Narrow the results" }).locator(".fg", { has: page.getByRole("heading", { name: "Speaker" }) });
  await expect(group.locator(".fg-row")).toHaveCount(10);
  const before = await group.locator(".fg-name").allInnerTexts();
  // Watch every redraw of the facets while the click is handled.
  await page.evaluate(() => {
    const w = window as unknown as { __lists: string[][] };
    w.__lists = [];
    const read = () => {
      const g = [...document.querySelectorAll(".sr-facets .fg")].find((el) => el.querySelector("h3")?.textContent === "Speaker");
      w.__lists.push(g ? [...g.querySelectorAll(".fg-name")].map((n) => n.textContent ?? "") : []);
    };
    new MutationObserver(read).observe(document.querySelector(".sr-facets")!, { childList: true, subtree: true, characterData: true });
  });
  await group.getByRole("button", { name: new RegExp(before[2]) }).click();
  await expect(page).toHaveURL(/speaker%3A/);
  await expect(page.locator("[data-result]").first()).toBeVisible();
  await page.waitForTimeout(800);
  const lists = await page.evaluate(() => (window as unknown as { __lists: string[][] }).__lists);
  for (const list of lists) expect(list).toEqual(before);
});

test("NEAR takes a distance and a phrase", async ({ page }) => {
  await page.goto("search/?q=%22Campaign%20for%20Fiscal%20Equity%22%20NEAR%2F25%20litigating");
  await expect(page.locator("[data-result] [data-speaker]").first()).toHaveAttribute("data-speaker", "robert-jackson");
  await page.goto("search/?q=%22Campaign%20for%20Fiscal%20Equity%22%20NEAR%2F3%20litigating");
  await expect(page.getByText("No remarks match.")).toBeVisible();
});

test("speaker: finds a hearing witness by the name the transcript prints", async ({ page }) => {
  await page.goto("search/?q=speaker%3Ahiller");
  const first = page.locator("[data-result]").first();
  await expect(first).toBeVisible();
  await expect(first).toContainText(/Hiller/i);
  await expect(page.getByText(/named .Hiller. in the transcripts/i)).toBeVisible();
  // senator: still means senators only.
  await page.goto("search/?q=senator%3Ahiller");
  await expect(page.locator("[data-result]")).toHaveCount(0);
});

