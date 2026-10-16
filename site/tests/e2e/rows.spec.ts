import { expect, test } from "@playwright/test";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("clicking anywhere in a list row opens it", async ({ page }) => {
  await page.goto("./");
  const row = page.locator(".hm-list li").first();
  const href = (await row.locator("a").first().getAttribute("href"))!;
  await row.locator(".d").click();
  await expect(page).toHaveURL(new RegExp(`${escape(href)}$`));
});

test("rows in the browse and bills lists open from anywhere in the row", async ({ page }) => {
  await page.goto("browse/2025/");
  let row = page.locator("ul.tr li").first();
  let href = (await row.locator("a").first().getAttribute("href"))!;
  await row.locator(".d").click();
  await expect(page).toHaveURL(new RegExp(`${escape(href)}$`));
  await page.goto("bills/2025/");
  row = page.locator("#bill-rows li").first();
  href = (await row.locator("a").first().getAttribute("href"))!;
  await row.locator(".st").click();
  await expect(page).toHaveURL(new RegExp(`${escape(href)}$`));
});

test("a search result opens from anywhere in the row, but selecting its words does not", async ({ page }) => {
  await page.goto("search/?q=%22executive%20budget%22");
  const row = page.locator("[data-result]").first();
  const href = (await row.locator("a.ctx").getAttribute("href"))!;
  const box = (await row.locator(".q").boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 8, { steps: 5 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/search\//);
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await row.locator(".c-date").click();
  // The link also names the passage to highlight; the page takes that off its address once it has landed.
  await expect(page).toHaveURL(new RegExp(`${escape(href.replace(/\?hl=[^#]*/, ""))}$`));
});

test("a list row shows a soft highlight while the pointer is over it, and the rules between rows are light", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("browse/2025/");
  const row = page.locator("ul.tr li").first();
  expect(await row.evaluate((el) => getComputedStyle(el).borderBottomColor)).toBe("rgb(233, 235, 237)");
  const tint = () => row.evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(await tint());
  await row.hover();
  // The tint fades in over 0.12 s, so a slow machine can read its first frame: wait for it.
  await expect.poll(tint).not.toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)$/);
});
