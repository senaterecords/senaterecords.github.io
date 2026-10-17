import { expect, test } from "@playwright/test";

// A calendar number read more than once in a day (laid aside on the first pass, debated later, or read again as the
// other house's bill substituted for it) is one calendar item: one row, opening on its debate, with its vote.

// May 8, 1995: Calendar 504 (S1743A) is read at turn 102 and laid aside, then read again at 195, debated and passed.
const DAY = "transcripts/1995-05-08-regular-session/";

test("a calendar number read twice in a day is one row, opening on its debate", async ({ page }, info) => {
  test.skip(info.project.name === "phone"); // the same list, in a sheet (below)
  await page.goto(DAY);
  const calendar = page.getByRole("complementary", { name: "On the calendar" });
  const rows = calendar.locator("li");
  const numbers = await rows.locator(".n").allTextContents();
  expect(numbers.length).toBe(new Set(numbers).size);
  const row = rows.filter({ has: page.locator(".n", { hasText: /^504$/ }) });
  await expect(row).toHaveCount(1);
  await expect(row.locator("a.go")).toHaveAttribute("href", "#r-195");
  await expect(row.locator("small")).toHaveText(/^Debated/);
  // The overview counts the bills on the calendar, as the list shows them.
  await expect(page.locator(".rd-side dd", { hasText: /bills?$/ })).toHaveText(`${numbers.length} bills`);
});

test("the first reading of a bill debated later belongs to the same row, and says how its day ended", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(`${DAY}#r-102`);
  const row = page.getByRole("complementary", { name: "On the calendar" }).locator("li.cur");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".n")).toHaveText("504");
  // Laid aside here, but the bill's day ended in the vote taken on its second reading.
  await expect(page.locator(".hn-live dd").filter({ hasText: /^Debated and passed/ })).toBeVisible({ timeout: 20000 });
});

test("the phone calendar sheet lists each calendar number once", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto(`${DAY}#r-195`);
  await page.getByRole("button", { name: "Show the calendar" }).tap();
  const sheet = page.getByRole("dialog", { name: "On the calendar" });
  const numbers = await sheet.locator("li .n").allTextContents();
  expect(numbers.length).toBeGreaterThan(0);
  expect(numbers.length).toBe(new Set(numbers).size);
  await expect(sheet.locator("li.cur .n")).toHaveText("504");
  await expect(sheet.locator("li", { has: page.locator(".n", { hasText: /^504$/ }) }).locator("a")).toHaveAttribute("href", "#r-195");
});

test("a bill the Assembly's was substituted for says what became of it", async ({ page }) => {
  // S5101 (2025) was substituted on the floor by A5834, which the Governor signed; the Senate's data leaves S5101
  // on its third reading calendar.
  await page.goto("bills/2025/S5101/");
  await expect(page.locator(".pg-title .status")).toHaveText("Signed by Governor as A5834");
  await expect(page.getByText("Substituted by A5834")).toBeVisible();
});
