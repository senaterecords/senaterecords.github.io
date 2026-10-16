import { expect, test } from "@playwright/test";

test("the header reaches every section", async ({ page }, info) => {
  await page.goto("./");
  if (info.project.name === "phone") await page.getByLabel("Menu").click();
  for (const name of ["Transcripts", "Senators", "Bills", "About"]) {
    await expect(page.getByRole("navigation").getByRole("link", { name, exact: true })).toBeVisible();
  }
});

test("pages say when the data was last updated", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("time[data-updated]").first()).toContainText(/ago|just now/);
});

test("no page scrolls sideways on a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  for (const path of ["./", "about/", "404/"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
