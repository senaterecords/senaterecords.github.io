import { expect, test } from "@playwright/test";

// On a slow connection the page's scripts arrive after the text. What a reader does in that gap must still count.
const SESSION = "transcripts/2025-03-04-regular-session/";
const slowScripts = async (page: import("@playwright/test").Page) => {
  await page.route("**/_astro/*.js", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
};

test("a name clicked before the scripts load still opens its card", async ({ page }) => {
  await slowScripts(page);
  await page.goto(SESSION, { waitUntil: "commit" });
  await page.locator('h3.sp[id$="-secretary"]').first().click();
  await expect(page.getByRole("dialog", { name: "The Secretary" })).toBeVisible({ timeout: 10_000 });
});

test("a name hovered before the scripts load opens its card once they do", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await slowScripts(page);
  await page.goto(SESSION, { waitUntil: "commit" });
  await page.locator('h3.sp[id$="-secretary"]').first().hover();
  await expect(page.getByRole("dialog", { name: "The Secretary" })).toBeVisible({ timeout: 10_000 });
});

test("text selected before the scripts load still gets the citation tools", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await slowScripts(page);
  await page.goto(SESSION, { waitUntil: "commit" });
  await page.locator("section.turn[data-role='senator'] p").first().waitFor();
  await page.evaluate(() => {
    const p = document.querySelector("section.turn[data-role='senator'] p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 20);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.getByRole("button", { name: "Copy with cite" })).toBeVisible({ timeout: 10_000 });
});

test("homepage controls clicked before the scripts load still take effect", async ({ page }) => {
  await slowScripts(page);
  await page.goto("./", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Public hearings" }).click();
  await page.getByRole("button", { name: "Search tips" }).click();
  await expect(page.getByRole("dialog", { name: "Search tips" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox").fill("budget");
  await page.getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(/q=budget%20type%3Ahearing/);
});

test("text typed before the scripts load is kept and gets suggestions", async ({ page }) => {
  await slowScripts(page);
  await page.goto("./", { waitUntil: "commit" });
  await page.getByRole("searchbox").pressSequentially("ye");
  await expect(page.getByRole("option", { name: "year:" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("searchbox")).toHaveValue("ye");
});

test("searching from the homepage works even before the scripts load", async ({ page }) => {
  await page.route("**/_astro/*.js", (route) => route.abort());
  await page.goto("./");
  await page.getByRole("searchbox").fill("budget");
  await page.getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(/search\/\?q=budget/);
});

test("J pressed before the scripts load still moves to a remark", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await slowScripts(page);
  await page.goto(SESSION, { waitUntil: "commit" });
  await page.locator("#transcript").waitFor();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/#r-\d+$/, { timeout: 10_000 });
});
