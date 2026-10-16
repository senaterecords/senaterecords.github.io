import { expect, test } from "@playwright/test";

test("an example search fills the box and searching opens the results page", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: '"congestion pricing"' }).click();
  await expect(page.getByRole("searchbox")).toHaveValue('"congestion pricing"');
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/search\/\?q=%22congestion%20pricing%22/);
});

test("the record filter adds a type to the search", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Public hearings" }).click();
  await page.getByRole("searchbox").fill("budget");
  await page.getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(/q=budget%20type%3Ahearing/);
});

test("Search tips lists every shortcut and closes with Esc", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Search tips" }).click();
  const tips = page.getByRole("dialog", { name: "Search tips" });
  for (const example of ["tolls NOT bridge", "tolls NEAR fares", "tolls NEAR/3 fares", '"school aid" "tax cap"', "(tolls OR fares) bridge", "senator:Krueger", "speaker:Krueger speaker:Lanza", "-speaker:Krueger", "year:2015-2019", "type:hearing", "committee:Health"]) {
    await expect(tips.getByText(example, { exact: true })).toBeVisible();
  }
  await expect(tips.getByText("both exact phrases", { exact: true })).toBeVisible();
  // The panel's pointer sits under the Search tips link, phones included.
  const pointer = await tips.evaluate((el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el, "::before").right) - 6);
  const link = (await page.getByRole("button", { name: "Search tips" }).boundingBox())!;
  expect(pointer).toBeGreaterThan(link.x);
  expect(pointer).toBeLessThan(link.x + link.width);
  await expect(tips.getByText(/one remark/)).toHaveCount(0);
  // Every explanation has room to read on a line or two, not a crushed column.
  if (test.info().project.name === "desktop") {
    const widths = await tips.locator("dd").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(120);
  }
  await tips.getByText("speaker:Krueger", { exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("speaker:Krueger");
  await page.getByRole("button", { name: "Search tips" }).click();
  await page.keyboard.press("Escape");
  await expect(tips).toBeHidden();
});

test("latest transcripts link to the reader", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: /Joint legislative hearing|Regular Session/i }).first().click();
  await expect(page).toHaveURL(/transcripts\/.+\//);
});

test("pro forma days in the latest transcripts read as legislative days", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("link", { name: "Legislative day" })).toBeVisible();
  await expect(page.getByText("No business conducted").first()).toBeVisible();
});

test("the last update reads as time ago from the first paint, never as a date that then changes", async ({ page }) => {
  // Hold the site's scripts back, as a slow connection would: the label must already be right without them.
  await page.route("**/_astro/*.js", async (route) => { await new Promise((done) => setTimeout(done, 3000)); await route.continue(); });
  await page.goto("browse/", { waitUntil: "commit" }); // "DOM ready" would wait for the held-back scripts
  await expect(page.locator("time[data-updated]").first()).toHaveText(/^Updated (just now|\d+ (min|hours?|days?) ago)$/, { timeout: 1500 });
});

test("Transcripts and Bills open the current year and session directly, without a stop on the way", async ({ page, request }, info) => {
  test.skip(info.project.name === "phone"); // phones use the same links from the menu
  await page.goto("about/");
  await expect(page.locator(".bar .nav").getByRole("link", { name: "Transcripts" })).toHaveAttribute("href", /\/browse\/2025\/$/);
  await expect(page.locator(".bar .nav").getByRole("link", { name: "Bills" })).toHaveAttribute("href", /\/bills\/2025\/$/);
  await expect(page.getByRole("link", { name: "Transcripts" }).first()).toBeVisible();
  // The old addresses still lead there, leaving before their page is painted (no list of years flashes by).
  for (const old of ["browse/", "bills/"]) {
    const html = await (await request.get(old)).text();
    const head = html.slice(0, html.indexOf("<body"));
    expect(head, old).toContain("location.replace(");
  }
});

test("the header and the footer say the same thing about the last update", async ({ page }) => {
  await page.goto("about/");
  const header = page.locator(".bar time[data-updated]");
  const footer = page.locator(".foot time[data-updated]");
  await expect(footer).toHaveText(/^Updated (just now|\d+ (min|hours?|days?) ago)$/);
  await expect(footer).toHaveText((await header.textContent())!);
  await expect(footer).toHaveAttribute("title", /^New records last arrived [A-Z][a-z]+ \d+, \d{4} at /); // the exact time on hover
});

test("the last update shows once: in the bar on a computer, in the footer on a phone and under the reader's bar", async ({ page }, info) => {
  await page.goto("about/");
  const phone = info.project.name === "phone";
  await expect(page.locator(".bar time[data-updated]")).toBeVisible({ visible: !phone });
  await expect(page.locator(".foot time[data-updated]")).toBeVisible({ visible: phone });
  // The reader's bar has no room for it, so its footer keeps it.
  await page.goto("transcripts/2025-03-04-regular-session/");
  await expect(page.locator(".foot time[data-updated]")).toBeVisible();
});

test("the home page is light: one sentence, a quiet records choice, plain examples, and lists without extras", async ({ page }, info) => {
  await page.goto("./");
  await expect(page.locator(".lede")).toHaveText("Find what any senator said since 1993, follow a bill's debate, and cite the exact page.");
  // The chosen record type is white on a grey track, not a black block.
  const chosen = page.getByRole("button", { name: "All records" });
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  expect(await chosen.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  // The examples are plain words, not boxes.
  const example = page.getByRole("button", { name: '"congestion pricing"' });
  expect(await example.evaluate((el) => [getComputedStyle(el).borderTopWidth, getComputedStyle(el).backgroundColor])).toEqual(["0px", "rgba(0, 0, 0, 0)"]);
  // Latest transcripts leave out page ranges; most debated bills give their status in the grey line, without a flag.
  await expect(page.locator(".hm-list").first()).not.toContainText(/pp\. \d/);
  await expect(page.locator(".hm .md .status")).toHaveCount(0);
  await expect(page.locator(".hm .md small").first()).toHaveText(/^[\d,]+ remarks? · \d+ senators? · \S/);
  if (info.project.name === "phone") {
    for (const width of [390, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      // Every example shown fits on the screen (two, or one on the narrowest phones), and Search tips is on their line.
      const shown = page.locator(".sbx-try .chip:visible");
      await expect(shown).toHaveCount(width < 360 ? 1 : 2);
      for (const box of await shown.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(width - 16);
      const tips = (await page.getByRole("button", { name: "Search tips" }).boundingBox())!;
      const first = (await shown.first().boundingBox())!;
      expect(Math.abs(tips.y + tips.height / 2 - (first.y + first.height / 2))).toBeLessThan(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
});

test("the bar says when the site last checked the Senate's records, and when new ones last arrived", async ({ page }) => {
  const checkedAt = new Date(Date.now() - 12 * 60_000).toISOString();
  await page.route("**/__status/checked.json", (route) => route.fulfill({ json: { checkedAt, updatedAt: "2026-10-16T01:35:57" } }));
  await page.goto("about/");
  const label = page.locator(".foot time[data-updated]");
  await expect(label).toHaveText("Checked 12 min ago");
  await expect(label).toHaveAttribute("title", /^Checked the Senate's records at .+ · New records last arrived October 16, 2026 at 1:35 a\.m\.$/);
  // The next page has it from the first paint, even while the file is slow to come.
  await page.unroute("**/__status/checked.json");
  await page.route("**/__status/checked.json", async (route) => { await new Promise((done) => setTimeout(done, 3000)); await route.fulfill({ json: { checkedAt, updatedAt: "2026-10-16T01:35:57" } }); });
  await page.goto("senators/", { waitUntil: "commit" });
  await expect(page.locator(".foot time[data-updated]")).toHaveText("Checked 12 min ago", { timeout: 1500 });
});

