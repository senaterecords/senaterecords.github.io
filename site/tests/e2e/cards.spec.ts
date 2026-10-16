import { expect, test } from "@playwright/test";

const HEARING = "transcripts/2025-02-27-joint-legislative-hearing-in-the-matter-of-the-2025-2026-executive-budget-on-taxes/";

test("hovering a senator's name opens their card", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(HEARING);
  await page.locator('h3.sp[id$="-liz-krueger"]').first().hover();
  const card = page.getByRole("dialog", { name: "Sen. Liz Krueger" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: "Open senator page" })).toHaveAttribute("href", /senators\/liz-krueger\//);
});

test("tapping a name on a phone opens a bottom sheet", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto(HEARING);
  await page.locator('h3.sp[id$="-liz-krueger"]').first().tap();
  await expect(page.getByRole("dialog", { name: "Sen. Liz Krueger" })).toBeVisible();
});

test("Assembly members get their own card without a senator page", async ({ page }) => {
  await page.goto(HEARING);
  await page.locator('h3.sp[id*="-assembly:"]').first().click();
  const card = page.getByRole("dialog", { name: /^Asm\. / });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: "Open senator page" })).toHaveCount(0);
});

test("the Secretary's card names the Secretary of the Senate", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  await page.locator('h3.sp[id$="-secretary"]').first().click();
  await expect(page.getByRole("dialog", { name: "The Secretary" })).toContainText("Alejandra N. Paulino");
});

test("Show only filters the transcript to one speaker", async ({ page }) => {
  await page.goto(HEARING);
  await page.locator('h3.sp[id$="-liz-krueger"]').first().click();
  await page.getByRole("button", { name: "Show only Krueger" }).click();
  await expect(page.getByText("Showing only Sen. Liz Krueger")).toBeVisible();
  await expect(page.locator('section.turn:not([hidden]):not(:has(> h3[id$="-liz-krueger"]))')).toHaveCount(0);
});

test("a senator from before 2009 has a card without a photo", async ({ page }) => {
  await page.goto("transcripts/1995-05-08-regular-session/");
  await page.locator("h3.sp.sen").first().click();
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
});
