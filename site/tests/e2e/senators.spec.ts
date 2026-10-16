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

test("the senator page tabs switch the list instead of jumping down the page", async ({ page }) => {
  await page.goto("senators/liz-krueger/");
  const tabs = page.getByRole("navigation", { name: "On this page" });
  await expect(page.locator("#remarks")).toBeVisible();
  await expect(page.locator("#transcripts")).toBeHidden();
  await tabs.getByRole("link", { name: /Transcripts/ }).click();
  await expect(page).toHaveURL(/#transcripts$/);
  await expect(page.locator("#transcripts")).toBeVisible();
  await expect(page.locator("#remarks")).toBeHidden();
  await page.goBack();
  await expect(page.locator("#remarks")).toBeVisible();
});

test("the senator page tabs and name stay at the top while scrolling", async ({ page }) => {
  await page.goto("senators/liz-krueger/");
  await page.evaluate(() => window.scrollBy(0, 1200));
  await expect(page.getByRole("navigation", { name: "On this page" })).toBeInViewport();
  await expect(page.locator(".tabbar .tb-name")).toBeVisible();
  await expect(page.locator(".tabbar .tb-name")).toHaveText(/Liz Krueger$/);
});

test("in the side list a bill's status sits under its title, so the title keeps the width", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("senators/jessica-ramos/");
  const row = page.locator(".two-side .bl li:has(.status)").first();
  const title = (await row.locator(".t").boundingBox())!;
  const status = (await row.locator(".status").boundingBox())!;
  expect(Math.abs(status.x - title.x)).toBeLessThan(2);
  expect(status.y).toBeGreaterThan(title.y + 10);
});

test("the senators list narrows by term, by current or former, and by name", async ({ page }) => {
  await page.goto("senators/");
  const rows = page.locator(".sn-row:visible");
  const all = await rows.count();
  await page.getByLabel("Term").selectOption("1995");
  const terms = await rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.sessions ?? ""));
  expect(terms.length).toBeGreaterThan(0);
  expect(terms.length).toBeLessThan(all);
  for (const t of terms) expect(t.split(" ")).toContain("1995");
  await page.getByLabel("Term").selectOption("");
  await page.getByRole("group", { name: "Serving" }).getByRole("button", { name: "Current" }).click();
  for (const current of await rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).hasAttribute("data-current")))) expect(current).toBe(true);
  await page.getByRole("group", { name: "Serving" }).getByRole("button", { name: "All" }).click();
  await page.getByLabel("Find a senator").fill("krue");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Liz Krueger");
});

test("the senators list sorts by remarks or service, and keeps its choices in the address", async ({ page }) => {
  await page.goto("senators/");
  await page.getByLabel("Sort").selectOption("remarks");
  const remarks = await page.locator(".sn-row:visible").evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.remarks)));
  expect(remarks).toEqual([...remarks].sort((a, b) => b - a));
  await expect(page.locator(".sn-group h2:visible")).toHaveCount(0);
  await page.getByLabel("Term").selectOption("2025");
  await expect(page).toHaveURL(/sort=remarks/);
  await expect(page).toHaveURL(/term=2025/);
  await page.reload();
  await expect(page.getByLabel("Sort")).toHaveValue("remarks");
  await expect(page.getByLabel("Term")).toHaveValue("2025");
});

