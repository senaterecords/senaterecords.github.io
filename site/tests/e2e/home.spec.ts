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
  for (const example of ["tolls NOT bridge", "tolls NEAR fares", "year:2015-2019", "type:hearing", "committee:Health"]) {
    await expect(tips.getByText(example, { exact: true })).toBeVisible();
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
