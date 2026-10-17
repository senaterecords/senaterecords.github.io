import { expect, test, type Locator, type Page } from "@playwright/test";

// Every link to a remark from another page lands on the words it is about and washes them yellow, as a search result
// does: a bill's mentions and readings, and a senator's recent remarks.

// Whether a yellow box covers the start of `words` in the remark `id` (t-N when the remark has no speaker label).
const washes = (page: Page, id: string, words: string) => page.evaluate(([id, words]) => {
  const section = document.getElementById(id) ?? document.getElementById(id.replace(/^r-/, "t-"));
  const walker = document.createTreeWalker(section!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = n.textContent!.indexOf(words);
    if (at < 0) continue;
    const r = document.createRange();
    r.setStart(n, at);
    r.setEnd(n, at + 2);
    const b = r.getBoundingClientRect();
    const x = b.x + 1;
    const y = b.y + b.height / 2;
    return [...document.querySelectorAll(".flash")].some((el) => {
      const f = el.getBoundingClientRect();
      return x >= f.left && x <= f.right && y >= f.top && y <= f.bottom;
    });
  }
  return false;
}, [id, words] as const);

async function landsWashed(page: Page, link: Locator, words?: string) {
  const href = (await link.getAttribute("href"))!;
  const id = href.split("#")[1];
  const hl = new URL(href, "http://x").searchParams.get("hl")!;
  expect(hl, href).toBeTruthy();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/transcripts/[^?]+/#${id}$`)); // the words leave the address once used
  await expect(page.locator(".flash").first()).toBeVisible();
  const start = words ?? hl.split("|")[0].split(" ").slice(0, 3).join(" ");
  expect(await washes(page, id, start), `${start} in #${id}`).toBe(true);
  await expect(page.locator(`#${id}, #${id.replace(/^r-/, "t-")}`).first()).toBeInViewport();
}

test("a bill named in a hearing as S4437 opens on the sentence that names it, on the page it is named on", async ({ page }) => {
  await page.goto("bills/2025/S4437/");
  const link = page.locator('a[href*="executive-budget-on-taxes"]').first();
  await expect(link).toHaveText("Read (p. 101)");
  await landsWashed(page, link);
  expect(await washes(page, "r-269", "S4437")).toBe(true);
});

test("a bill mentioned on the floor opens on the remark that names it", async ({ page }) => {
  await page.goto("bills/2025/S5101/");
  await landsWashed(page, page.locator('a[href*="2025-03-04-regular-session"][href*="#r-143"]').first());
  expect(await washes(page, "r-143", "Senate Bill 5101")).toBe(true);
});

test("Read the debate opens on the bill's reading, washed yellow", async ({ page }) => {
  await page.goto("bills/2025/S172/");
  await landsWashed(page, page.getByRole("link", { name: "Read the debate" }), "Calendar Number 441");
});

test("a senator's recent remark opens on the words the senator page showed", async ({ page }) => {
  await page.goto("senators/liz-krueger/");
  await landsWashed(page, page.locator("#remarks a[href*='/transcripts/']").first());
});
