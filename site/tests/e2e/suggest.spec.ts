import { expect, test } from "@playwright/test";

test("typing speaker: suggests people by any part of their name", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("speaker:krue");
  const list = page.getByRole("listbox");
  await expect(list.getByRole("option", { name: /Liz Krueger/ })).toBeVisible();
  await expect(list.getByRole("option").first().locator("b")).toHaveText("Krue");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("searchbox")).toHaveValue("speaker:liz-krueger ");
});

test("the suggestion list fits in the window instead of stretching the page", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto("./");
  const pageHeight = () => page.evaluate(() => document.documentElement.scrollHeight);
  const before = await pageHeight();
  await page.getByRole("searchbox").pressSequentially("senator:d");
  const list = page.getByRole("listbox");
  await expect(list.getByRole("option").first()).toBeVisible();
  const box = (await list.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(560 - 8); // its bottom stays in the window, with a little room
  expect(await pageHeight()).toBe(before); // and the page doesn't grow to make room for it
  // What doesn't fit scrolls inside the list.
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});

test("a partial shortcut suggests the shortcut itself", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("ye");
  await page.getByRole("option", { name: "year:" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("year:");
});

test("year: suggests years with transcript counts", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("year:19");
  await expect(page.getByRole("option", { name: /1995.*transcripts/ })).toBeVisible();
});

test("bill: suggests bill numbers from the index", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("bill:S500");
  await expect(page.getByRole("option", { name: /S50025/ })).toBeVisible();
});

test("Esc closes the suggestions", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("speaker:krue");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
});

test("Enter searches what was typed until a suggestion is chosen", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("rent ye");
  await expect(page.getByRole("option", { name: "year:" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/search\/\?q=rent(%20|\+)ye$/); // "+" when the form is sent before the script starts
});

test("whole words like bill stay words", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("school bill");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/search\/\?q=school(%20|\+)bill$/);
});

test("a speaker: left ambiguous on Enter asks which person", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("speaker:smith");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Which smith\?/i)).toBeVisible();
});

test("picking a bill keeps its session", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("bill:S500");
  await page.getByRole("option", { name: /S50025/ }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("bill:S50025/2009 ");
});

test("senator: suggests senators only", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox").pressSequentially("senator:krue");
  const list = page.getByRole("listbox");
  await expect(list.getByRole("option", { name: /Liz Krueger/ })).toBeVisible();
  await expect(list.getByRole("group", { name: /Assembly/ })).toHaveCount(0);
});
