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
  await page.goto(SESSION, { waitUntil: "domcontentloaded" });
  await page.locator('h3.sp[data-key="secretary"]').first().click();
  await expect(page.getByRole("dialog", { name: "The Secretary" })).toBeVisible({ timeout: 10_000 });
});

test("text selected before the scripts load still gets the citation tools", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await slowScripts(page);
  await page.goto(SESSION, { waitUntil: "domcontentloaded" });
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

test("J pressed before the scripts load still moves to a remark", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await slowScripts(page);
  await page.goto(SESSION, { waitUntil: "domcontentloaded" });
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/#r-\d+$/, { timeout: 10_000 });
});
