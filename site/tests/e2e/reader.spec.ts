import { expect, test } from "@playwright/test";

test("every remark has an anchor and page breaks read p. N", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  const first = page.locator("section.turn:has(> h3)").first();
  await expect(first).toHaveAttribute("id", /^r-\d+$/);
  await expect(first.locator("> h3")).toHaveAttribute("id", /^w-\d+-\d+-.+$/);
  await expect(page.locator(".pb b").first()).toHaveText(/^p\. \d+$/);
});

test("a page break in mid-sentence stays inside its paragraph", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  await expect(page.locator("section.turn p .pb").first()).toHaveText(/^p\. \d+$/);
});

test("a remark link opens at that remark", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/#r-40");
  await expect(page.locator("#r-40")).toBeInViewport();
});

test("the calendar jumps to a bill's reading and links its bill page", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("transcripts/2025-03-04-regular-session/");
  const calendar = page.getByRole("complementary", { name: "On the calendar" });
  await expect(calendar.getByRole("link").first()).toBeVisible();
  const billLink = calendar.locator('a[href*="/bills/2025/"]').first();
  await billLink.click();
  await expect(page).toHaveURL(/bills\/2025\/[SA]\d+\//);
});

test("special-session readings without a bill number still render", async ({ page }) => {
  await page.goto("transcripts/2009-06-23-extraordinary-session/");
  await expect(page.locator("section.turn").first()).toBeVisible();
});

test("a transcript without speakers says so", async ({ page }) => {
  await page.goto("transcripts/1995-05-09-test-plain-text/");
  await expect(page.getByText("Speaker details aren't available for this transcript")).toBeVisible();
  await expect(page.locator("section.turn h3")).toHaveCount(0);
});

test("filters are attributes, not page text", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  await expect(page.locator('[data-pagefind-filter^="type:"]')).toHaveCount(1);
  const text = await page.locator("#transcript").innerText();
  expect(text).not.toContain("type:floor");
});

test("a pro forma legislative day shows its text without the reader's tools, and stays out of search", async ({ page }) => {
  await page.goto("transcripts/2023-06-04-regular-session/");
  await expect(page.locator("section.turn").first()).toBeVisible();
  await expect(page.locator("#transcript")).not.toHaveAttribute("data-pagefind-body", /.*/);
  await expect(page.locator("#reader-data")).toHaveCount(0);
  await expect(page.locator("h3.sp.k")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export" })).toHaveCount(0);
});

test("each calendar reading starts with its bill number and title", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  const header = page.locator(".rd-seg", { hasText: "No. 441 · S172" });
  await expect(header).toContainText("Increases short-term disability benefits");
  await expect(page.locator(".rd-seg + .turn, .rd-seg ~ .turn").first()).toBeAttached();
});

test("reader pages leave out the header parts they never show", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  await expect(page.locator(".bar .nav, .bar .upd, .bar .bar-search, .bar details.menu")).toHaveCount(0);
  await expect(page.locator(".bar .rd-crumb")).toHaveCount(1);
});

test("search only ships the files the site uses", async ({ request }) => {
  expect((await request.get("pagefind/pagefind.js")).ok()).toBe(true);
  expect((await request.get("pagefind/pagefind-ui.js")).status()).toBe(404);
});

test("a page that begins mid-sentence keeps the sentence flowing, with the page number in the margin", async ({ page }, info) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  const marker = page.locator("section.turn p .pb").first();
  await expect(marker).toHaveCSS("display", "inline");
  if (info.project.name === "desktop") {
    const paragraph = await marker.locator("xpath=ancestor::p[1]").boundingBox();
    const number = await marker.locator("b").boundingBox();
    expect(number!.x + number!.width).toBeLessThanOrEqual(paragraph!.x);
  }
});

test("in a long remark the speaker stays named at the top", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/#r-15");
  const strip = page.locator(".rd-who");
  await expect(page.locator("#r-15")).toBeInViewport();
  await expect(strip).toBeHidden();
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 500);
  await expect(strip).toBeVisible();
  await page.waitForTimeout(500); // still there once the page settles
  await expect(strip).toBeVisible();
  // It floats over the text: the notices strip it lives in takes no room, so nothing below it moves.
  expect(await page.locator("#reader-notices").evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(0);
  await expect(strip).toContainText(/Stewart-Cousins/i);
  await page.evaluate(() => document.getElementById("r-15")!.scrollIntoView({ block: "center" }));
  await expect(strip).toBeHidden();
});
