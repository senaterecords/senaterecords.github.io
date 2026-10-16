import { expect, test } from "@playwright/test";

test("the senators index links to senator pages", async ({ page }) => {
  await page.goto("senators/");
  await page.getByRole("link", { name: /Liz Krueger/ }).click();
  await expect(page).toHaveURL(/senators\/liz-krueger\//);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sen. Liz Krueger");
});

test("a senator page shows service, recent remarks and a search for all of them", async ({ page }) => {
  await page.goto("senators/liz-krueger/");
  await expect(page.getByText(/In the Senate since 2002/)).toBeVisible();
  const remark = page.locator("#remarks a[href*='/transcripts/']").first();
  await expect(remark).toHaveAttribute("href", /#r-\d+$/);
  await expect(page.getByRole("link", { name: /Search all of Krueger's remarks/ })).toHaveAttribute("href", /q=speaker%3Aliz-krueger/);
});

test("senators from before 2009 have pages without a photo or official link", async ({ page }) => {
  await page.goto("senators/");
  const oldRow = page.locator("[data-before-records]").first();
  await oldRow.getByRole("link").click();
  await expect(page.locator("header img.photo")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Official page" })).toHaveCount(0);
});

test("exporting a senator's remarks lets go of the file afterwards", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.addInitScript(() => {
    const w = window as unknown as { __revoked: number };
    w.__revoked = 0;
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u: string) => { w.__revoked += 1; revoke(u); };
  });
  await page.goto("senators/liz-krueger/");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export/ }).first().click();
  await download;
  await expect.poll(() => page.evaluate(() => (window as unknown as { __revoked: number }).__revoked)).toBeGreaterThan(0);
});
