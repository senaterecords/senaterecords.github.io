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
