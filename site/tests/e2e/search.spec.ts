import { expect, test, type Page } from "@playwright/test";

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

// Where the start of "Campaign for Fiscal Equity" is on the screen now, and whether a yellow box covers it.
const washed = (page: Page) => page.evaluate(() => {
  const walker = document.createTreeWalker(document.getElementById("r-25")!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = n.textContent!.indexOf("Campaign for Fiscal Equity");
    if (at < 0) continue;
    const r = document.createRange();
    r.setStart(n, at);
    r.setEnd(n, at + 8);
    const b = r.getBoundingClientRect();
    const x = b.x + 2;
    const y = b.y + b.height / 2;
    return [...document.querySelectorAll(".flash")].some((el) => {
      const f = el.getBoundingClientRect();
      return x >= f.left && x <= f.right && y >= f.top && y <= f.bottom;
    });
  }
  return false;
});

test("the yellow wash fades in, and stays on the passage while the page scrolls", async ({ page }, info) => {
  // The wash's strength the moment it is added: it should start clear and fade in, not appear at full strength.
  await page.addInitScript(() => {
    new MutationObserver((changes) => {
      for (const c of changes) for (const n of c.addedNodes) {
        if (n instanceof HTMLElement && n.classList.contains("flash-layer")) (window as unknown as { __washStart: string }).__washStart = getComputedStyle(n).opacity;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("search/?q=%22Campaign%20for%20Fiscal%20Equity%22");
  await page.locator("[data-result] a.ctx").first().click();
  await expect(page.locator(".flash").first()).toBeVisible();
  expect(Number(await page.evaluate(() => (window as unknown as { __washStart: string }).__washStart))).toBeLessThan(0.3);
  // Scrolling (a wheel on a computer, a swipe on a phone) keeps the wash on its words instead of wiping it away.
  if (info.project.name === "phone") {
    const s = await page.context().newCDPSession(page);
    await s.send("Input.synthesizeScrollGesture", { x: 200, y: 600, yDistance: -120, speed: 1200 });
  } else {
    await page.mouse.move(640, 500);
    await page.mouse.wheel(0, 120);
  }
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(page.locator(".flash").first()).toBeAttached();
  await expect.poll(() => washed(page)).toBe(true);
  await expect(page.locator(".flash")).toHaveCount(0, { timeout: 6000 });
});

test("a click fades the yellow wash out quickly instead of wiping it away", async ({ page }) => {
  await page.goto("search/?q=%22Campaign%20for%20Fiscal%20Equity%22");
  await page.locator("[data-result] a.ctx").first().click();
  await expect(page.locator(".flash").first()).toBeVisible();
  const strength = () => page.evaluate(() => { const layer = document.querySelector(".flash-layer"); return layer ? Number(getComputedStyle(layer).opacity) : 0; });
  await expect.poll(strength).toBeGreaterThan(0.8); // fully in
  // Click and look in the same moment, so a busy machine can't let the wash end on its own in between.
  const [before, after] = await page.evaluate(() => {
    const layer = document.querySelector(".flash-layer")!;
    const was = Number(getComputedStyle(layer).opacity);
    document.querySelector<HTMLElement>("#r-25 p")!.click();
    return [was, document.querySelector(".flash-layer") ? Number(getComputedStyle(layer).opacity) : 0];
  });
  expect(before).toBeGreaterThan(0.3);
  expect(after).toBeGreaterThan(0.3); // still there just after the click, on its way out
  await expect(page.locator(".flash")).toHaveCount(0, { timeout: 1500 });
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

test("a senator who only presided isn't offered as a speaker of that transcript", async ({ page }, info) => {
  test.skip(info.project.name === "phone"); // the filter panel is a sheet on phones
  await page.goto("search/?q=resolution");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  // Ask the index itself: on March 4, 2025 she only spoke as "ACTING PRESIDENT PERSAUD".
  const tagged = await page.evaluate(async () => {
    const pf = await import(/* @vite-ignore */ `${location.pathname.replace(/search\/$/, "")}pagefind/pagefind.js`);
    const found = await pf.search("resolution", { filters: { senator: "roxanne-j-persaud" } });
    return found.results.length;
  });
  expect(tagged).toBe(0);
});

test("when a speaker's own remarks don't have the words, the page says so and offers them from anyone", async ({ page }) => {
  await page.goto("search/?q=pledge%20senator%3Akrueger");
  await expect(page.getByText(/come up in 1 transcript where Sen\. Liz Krueger spoke, but not in .*own remarks/)).toBeVisible();
  await page.getByRole("button", { name: "Show these words from anyone" }).click();
  await expect(page).toHaveURL(/q=pledge$/);
  await expect(page.locator("[data-result]").first()).toBeVisible();
});

test("on the results page Search tips sits beside the Search button, not on a line below", async ({ page }, info) => {
  test.skip(info.project.name === "phone"); // phones keep it below: the row has no room
  await page.goto("search/?q=budget");
  const go = (await page.getByRole("button", { name: "Search", exact: true }).boundingBox())!;
  const tipsLink = page.getByRole("button", { name: "Search tips" });
  const tips = (await tipsLink.boundingBox())!;
  expect(tips.x).toBeGreaterThan(go.x + go.width);
  expect(Math.abs(tips.y + tips.height / 2 - (go.y + go.height / 2))).toBeLessThanOrEqual(4);
  await tipsLink.click();
  const panel = (await page.getByRole("dialog", { name: "Search tips" }).boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(1280);
  // The homepage keeps it under the box, beside the examples.
  await page.goto("./");
  const field = (await page.locator(".sbx-row").boundingBox())!;
  expect((await page.getByRole("button", { name: "Search tips" }).boundingBox())!.y).toBeGreaterThan(field.y + field.height);
});

test("a partly searched result explains \"possible transcripts\" in a neat popup beside the line", async ({ page }, info) => {
  // Two transcripts a batch, so this small sample stops partway, as a broad search of the real archive does.
  await page.addInitScript(() => { (window as unknown as { __otrBatch: number }).__otrBatch = 2; });
  await page.goto("search/?q=the");
  const line = page.locator(".sr-head h1 > span").first();
  await expect(line).toContainText(/searched 2 of \d+ possible transcripts/);
  expect(await line.getAttribute("title")).toBeNull(); // no plain browser tooltip
  const why = page.getByRole("button", { name: /possible transcripts/i });
  if (info.project.name === "phone") await why.tap(); else await why.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText(/^Possible transcripts here means .*all your words somewhere/);
  const box = (await page.getByRole("tooltip").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); // on screen, phones included
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("the \"i\" never wraps onto a line of its own, and on a phone the counts sit on two tidy lines", async ({ page }, info) => {
  await page.addInitScript(() => { (window as unknown as { __otrBatch: number }).__otrBatch = 2; });
  for (const width of info.project.name === "phone" ? [390, 360, 320] : [1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("search/?q=the");
    await expect(page.locator(".sr-head h1")).toContainText(/possible transcripts/);
    const lines = await page.evaluate(() => {
      const h1 = document.querySelector(".sr-head h1")!;
      const sub = h1.querySelector(".sr-sub")!;
      const button = h1.querySelector(".itip-btn")!.getBoundingClientRect();
      // The line the last word "transcripts" ends on (not counting the popup's own words).
      const walker = document.createTreeWalker(sub, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement!.closest(".itip") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      let word: DOMRect | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.textContent!.lastIndexOf("transcripts");
        if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 11); word = r.getBoundingClientRect(); }
      }
      const main = document.createRange();
      main.selectNodeContents(h1.firstChild!);
      return {
        mainTop: main.getBoundingClientRect().top, subTop: sub.getClientRects()[0].top, subLeft: sub.getClientRects()[0].left, h1Left: h1.getBoundingClientRect().left,
        wordMid: word!.top + word!.height / 2, buttonTop: button.top, buttonBottom: button.bottom, right: h1.getBoundingClientRect().right, viewport: innerWidth,
      };
    });
    expect(lines.wordMid).toBeGreaterThan(lines.buttonTop); // the "i" is on the same line as "transcripts"
    expect(lines.wordMid).toBeLessThan(lines.buttonBottom);
    expect(lines.right).toBeLessThanOrEqual(lines.viewport);
    if (info.project.name === "phone") {
      expect(lines.subTop).toBeGreaterThan(lines.mainTop + 5); // "searched … possible transcripts" starts its own line
      expect(Math.abs(lines.subLeft - lines.h1Left)).toBeLessThan(1);
    }
  }
});


// The heading once every possible transcript is read: "N remarks in M transcripts".
const counts = async (page: Page, q: string) => {
  await page.goto(`search/?q=${encodeURIComponent(q)}`);
  const heading = page.locator(".sr-head h1");
  await expect(heading).toContainText(/ in \d+ transcripts?$/);
  return (await heading.textContent())!;
};

test("brackets group the words: the same results as the search written out in full", async ({ page }) => {
  const grouped = await counts(page, "budget AND (tax OR school)");
  expect(grouped).toBe(await counts(page, "budget tax OR budget school"));
  expect(grouped).not.toBe(await counts(page, "budget tax OR school")); // what the brackets used to be read as
  expect(await counts(page, "(budget OR tax) children")).toBe(await counts(page, "budget children OR tax children"));
  expect(await counts(page, "budget NOT (tax OR school)")).toBe(await counts(page, "budget -tax -school"));
});

test("NOT and a minus leave a speaker out, instead of keeping only that speaker", async ({ page }) => {
  for (const q of ["budget -speaker:liz-krueger", "budget NOT speaker:liz-krueger"]) {
    await page.goto(`search/?q=${encodeURIComponent(q)}`);
    await expect(page.locator(".sr-head h1")).toContainText(/ in \d+ transcripts?$/);
    const speakers = await page.locator("[data-result] [data-speaker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speaker")));
    expect(speakers.length, q).toBeGreaterThan(0);
    expect(speakers, q).not.toContain("liz-krueger");
  }
  // Nor is she offered as a speaker to narrow to.
  if (test.info().project.name === "desktop") {
    const facets = page.getByRole("complementary", { name: "Narrow the results" });
    await expect(facets.getByRole("button", { name: /Robert Jackson|John Liu|Shelley Mayer/ }).first()).toBeVisible();
    await expect(facets.getByRole("button", { name: /Liz Krueger/ })).toHaveCount(0);
  }
});

test("a minus leaves out a year or a record type", async ({ page }) => {
  await page.goto("search/?q=budget%20-year%3A2025");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  const dates = await page.locator("[data-result] .c-date b").allInnerTexts();
  for (const d of dates) expect(d.slice(-4)).not.toBe("2025");
  await page.goto("search/?q=the%20-type%3Ahearing"); // every "budget" transcript in the sample is a hearing
  await expect(page.locator("[data-result]").first()).toBeVisible();
  for (const k of await page.locator("[data-result] .c-date span").allInnerTexts()) expect(k).toMatch(/^Floor/);
});

test("a shortcut outside brackets narrows every group; one inside narrows only its own", async ({ page }) => {
  await page.goto("search/?q=(budget%20OR%20tax)%20speaker%3Aliz-krueger");
  await expect(page.locator("[data-result]").first()).toBeVisible();
  const outside = await page.locator("[data-result] [data-speaker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speaker")));
  expect(new Set(outside)).toEqual(new Set(["liz-krueger"]));
  // Each group's own speaker: Krueger on the budget, or Jackson on children.
  const either = await counts(page, "(budget speaker:liz-krueger) OR (children speaker:robert-jackson)");
  const speakers = new Set(await page.locator("[data-result] [data-speaker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speaker"))));
  expect([...speakers].every((s) => s === "liz-krueger" || s === "robert-jackson")).toBe(true);
  // A remark has one speaker, so no remark is in both groups: the two add up.
  const remarks = (text: string) => Number(text.match(/^([\d,]+) remarks?/)![1].replace(/,/g, ""));
  expect(remarks(either)).toBe(remarks(await counts(page, "budget speaker:liz-krueger")) + remarks(await counts(page, "children speaker:robert-jackson")));
});

test("the counts beside the filters cover every OR group, each transcript once", async ({ page }, info) => {
  test.skip(info.project.name === "phone"); // the same counts, in a sheet
  const row = page.getByRole("complementary", { name: "Narrow the results" }).getByRole("button", { name: /Public hearings/ });
  const hearings = async (q: string) => {
    await page.goto(`search/?q=${encodeURIComponent(q)}`);
    await expect(row).toBeVisible();
    return Number(await row.locator("b").textContent());
  };
  const a = await hearings("budget");
  const b = await hearings("tax");
  const both = await hearings("budget tax");
  expect(both).toBeGreaterThan(0); // the two share transcripts, so adding them up would count some twice
  await hearings("budget OR tax");
  await expect.poll(async () => Number(await row.locator("b").textContent())).toBe(a + b - both);
});

test("a search with too many combinations says so, rather than running them all", async ({ page }) => {
  await page.goto("search/?q=(a%20OR%20b)%20(c%20OR%20d)%20(e%20OR%20f)%20(g%20OR%20h)%20(i%20OR%20j)");
  await expect(page.getByRole("alert")).toHaveText(/too many combinations to run at once \(more than 16\)/);
});

test("picking which person, inside brackets, keeps the brackets", async ({ page }) => {
  await page.goto("search/?q=(budget%20speaker%3Asmith)%20OR%20tax");
  await expect(page.getByText(/^Which smith\?/i)).toBeVisible();
  await page.locator(".sr-which-list button").first().click();
  await expect(page).toHaveURL(/q=%28budget(\+|%20)speaker%3A[a-z-]+smith[a-z-]*%29(\+|%20)OR(\+|%20)tax/);
});

test("filter counts stay right when the OR groups hold phrases", async ({ page }, info) => {
  test.skip(info.project.name === "phone"); // the same counts, in a sheet
  // A phrase is searched on its own, so a group with phrases can't be counted against another by their overlap.
  const row = page.getByRole("complementary", { name: "Narrow the results" }).getByRole("button", { name: /Floor sessions/ });
  const floor = async (q: string) => {
    await page.goto(`search/?q=${encodeURIComponent(q)}`);
    await expect(page.locator(".sr-head h1")).toBeVisible();
    return (await row.count()) ? Number(await row.locator("b").textContent()) : 0;
  };
  const a = await floor('"senate will come to order"');
  const b = await floor('"executive budget"');
  await page.goto(`search/?q=${encodeURIComponent('"senate will come to order" OR "executive budget"')}`);
  await expect.poll(async () => ((await row.count()) ? Number(await row.locator("b").textContent()) : 0)).toBeGreaterThanOrEqual(Math.max(a, b));
  expect(Number(await row.locator("b").textContent())).toBeLessThanOrEqual(a + b);
});

test("on a phone, the passage a result opens on lands clear of the reader's bars, on a small screen too", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  for (const [width, height] of [[320, 568], [390, 664]]) {
    await page.setViewportSize({ width, height });
    for (const q of ['"Campaign for Fiscal Equity"', "budget"]) {
      await page.goto(`search/?q=${encodeURIComponent(q)}`);
      await page.locator("[data-result] a.ctx").first().click();
      await expect(page.locator(".flash").first()).toBeAttached();
      await page.waitForTimeout(800); // the reader's bars are in
      const at = await page.evaluate(() => {
        const bottomOf = (sel: string) => { const el = document.querySelector(sel); const r = el?.getBoundingClientRect(); return r && r.height ? r.bottom : 0; };
        const bar = document.querySelector(".remarkbar")?.getBoundingClientRect();
        const marks = [...document.querySelectorAll(".flash")].map((m) => m.getBoundingClientRect());
        return {
          clearTop: Math.max(bottomOf(".bar"), bottomOf("#reader-notices"), bottomOf(".rd-who")),
          clearBottom: bar && bar.height ? bar.top : innerHeight,
          top: Math.min(...marks.map((r) => r.top)), bottom: Math.max(...marks.map((r) => r.bottom)),
        };
      });
      const label = `${q} at ${width}x${height}: ${JSON.stringify(at)}`;
      expect(at.top, label).toBeGreaterThanOrEqual(at.clearTop);
      // All of it shows when it fits between the bars.
      if (at.bottom - at.top <= at.clearBottom - at.clearTop) expect(at.bottom, label).toBeLessThanOrEqual(at.clearBottom);
    }
  }
});
