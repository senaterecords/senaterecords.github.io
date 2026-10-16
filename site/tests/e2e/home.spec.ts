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
  for (const example of ["tolls NOT bridge", "tolls NEAR fares", "tolls NEAR/3 fares", '"school aid" "tax cap"', "senator:Krueger", "speaker:Krueger speaker:Lanza", "year:2015-2019", "type:hearing", "committee:Health"]) {
    await expect(tips.getByText(example, { exact: true })).toBeVisible();
  }
  await expect(tips.getByText("both exact phrases", { exact: true })).toBeVisible();
  await expect(tips.getByText(/one remark/)).toHaveCount(0);
  // Every explanation has room to read on a line or two, not a crushed column.
  if (test.info().project.name === "desktop") {
    const widths = await tips.locator("dd").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(120);
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

test("the last update reads as time ago from the first paint, never as a date that then changes", async ({ page }) => {
  // Hold the site's scripts back, as a slow connection would: the label must already be right without them.
  await page.route("**/_astro/*.js", async (route) => { await new Promise((done) => setTimeout(done, 3000)); await route.continue(); });
  await page.goto("browse/", { waitUntil: "commit" }); // "DOM ready" would wait for the held-back scripts
  await expect(page.locator("time[data-updated]").first()).toHaveText(/^Updated (just now|\d+ (min|hours?|days?) ago)$/, { timeout: 1500 });
});

test("Transcripts and Bills open the current year and session directly, without a stop on the way", async ({ page, request }, info) => {
  test.skip(info.project.name === "phone"); // phones use the same links from the menu
  await page.goto("about/");
  await expect(page.locator(".bar .nav").getByRole("link", { name: "Transcripts" })).toHaveAttribute("href", /\/browse\/2025\/$/);
  await expect(page.locator(".bar .nav").getByRole("link", { name: "Bills" })).toHaveAttribute("href", /\/bills\/2025\/$/);
  await expect(page.getByRole("link", { name: "Transcripts" }).first()).toBeVisible();
  // The old addresses still lead there, leaving before their page is painted (no list of years flashes by).
  for (const old of ["browse/", "bills/"]) {
    const html = await (await request.get(old)).text();
    const head = html.slice(0, html.indexOf("<body"));
    expect(head, old).toContain("location.replace(");
  }
});

test("the header and the footer say the same thing about the last update", async ({ page }) => {
  await page.goto("about/");
  const header = page.locator(".bar time[data-updated]");
  const footer = page.locator(".foot time[data-updated]");
  await expect(footer).toHaveText(/^Updated (just now|\d+ (min|hours?|days?) ago)$/);
  if (await header.isVisible()) await expect(footer).toHaveText((await header.textContent())!);
  await expect(footer).toHaveAttribute("title", /^Updated [A-Z][a-z]+ \d+, \d{4}/); // the exact date on hover
});

