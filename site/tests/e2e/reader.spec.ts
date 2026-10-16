import { expect, test } from "@playwright/test";

test("every remark has an anchor and page breaks read p. N", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  const first = page.locator("section.turn:has(> h3)").first();
  await expect(first).toHaveAttribute("id", /^r-\d+$/);
  await expect(first.locator("> h3")).toHaveAttribute("id", /^w-\d+-\d+-.+$/);
  await expect(page.locator(".pb b").first()).toHaveText(/^p\. \d+$/);
});

test("a page break in mid-sentence stays inside its paragraph", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  await expect(page.locator("section.turn p .pb").first()).toHaveText(/^p\. \d+$/);
});

test("a remark link opens at that remark", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/#r-40");
  await expect(page.locator("#r-40")).toBeInViewport();
});

test("a calendar row jumps to its reading, and a separate control opens the bill page", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("transcripts/2025-03-04-regular-session/");
  const calendar = page.getByRole("complementary", { name: "On the calendar" });
  const row = calendar.locator("li", { has: page.getByRole("link", { name: /bill page/ }) }).first();
  // Clicking the bill number stays in the transcript, at that reading.
  await row.locator(".p .num").click();
  await expect(page).toHaveURL(/\/transcripts\/2025-03-04-regular-session\/#[rt]-\d+$/);
  await row.getByRole("link", { name: /bill page/ }).click();
  await expect(page).toHaveURL(/bills\/2025\/[SA]\d+\//);
});

test("special-session readings without a bill number still render", async ({ page }) => {
  await page.goto("transcripts/2009-06-23-extraordinary-session/");
  await expect(page.locator("section.turn").first()).toBeVisible();
});

test("a transcript without speakers says so", async ({ page }) => {
  await page.goto("transcripts/1995-05-09-test-plain-text/");
  await expect(page.getByText("Speaker details aren't available for this transcript")).toBeVisible();
  await expect(page.locator("section.turn h3")).toHaveCount(0);
});

test("filters are attributes, not page text", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  await expect(page.locator('[data-pagefind-filter^="type:"]')).toHaveCount(1);
  const text = await page.locator("#transcript").innerText();
  expect(text).not.toContain("type:floor");
});

test("a pro forma legislative day has the reader's tools, and stays out of search", async ({ page }) => {
  await page.goto("transcripts/2023-06-04-regular-session/");
  await expect(page.locator("section.turn").first()).toBeVisible();
  await expect(page.locator("#transcript")).not.toHaveAttribute("data-pagefind-body", /.*/);
  await page.locator("h3.sp.k").first().click();
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
});

test("a calendar row says how many remarks its reading has in words, apart from the bill page icon", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto("transcripts/2025-03-04-regular-session/");
  const calendar = page.getByRole("complementary", { name: "On the calendar" });
  const debated = calendar.locator("li", { hasText: "Debated" }).first();
  await expect(debated.locator(".p small")).toHaveText(/^Debated · \d+ remarks?$/);
  // No bare number sits against the icon at the end of the row.
  await expect(calendar.locator(".go > .c")).toHaveCount(0);
});

test("each calendar reading starts with its bill number and title", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  const header = page.locator(".rd-seg", { hasText: "No. 441 · S172" });
  await expect(header).toContainText("Increases short-term disability benefits");
  await expect(page.locator(".rd-seg + .turn, .rd-seg ~ .turn").first()).toBeAttached();
});

test("reader pages leave out the header parts they never show", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  await expect(page.locator(".bar .nav, .bar .upd, .bar .bar-search, .bar details.menu")).toHaveCount(0);
  await expect(page.locator(".bar .rd-crumb")).toHaveCount(1);
});

test("search only ships the files the site uses", async ({ request }) => {
  expect((await request.get("pagefind/pagefind.js")).ok()).toBe(true);
  expect((await request.get("pagefind/pagefind-ui.js")).status()).toBe(404);
});

test("a page that begins mid-sentence keeps the sentence flowing, with the page number in the margin", async ({ page }, info) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  const marker = page.locator("section.turn p .pb").first();
  await expect(marker).toHaveCSS("display", "inline");
  // No mark in the text: the number in the margin (inline "p. N" on phones) is the only sign.
  await expect(marker.locator("i")).toBeHidden();
  if (info.project.name === "desktop") {
    const paragraph = await marker.locator("xpath=ancestor::p[1]").boundingBox();
    const number = await marker.locator("b").boundingBox();
    expect(number!.x + number!.width).toBeLessThanOrEqual(paragraph!.x);
  }
});

test("in a long remark the speaker stays named at the top", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/#r-15");
  const strip = page.locator(".rd-who");
  await expect(page.locator("#r-15")).toBeInViewport();
  await expect(strip).toBeHidden();
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 500);
  await expect(strip).toBeVisible();
  await page.waitForTimeout(500); // still there once the page settles
  await expect(strip).toBeVisible();
  // It floats over the text: the notices strip it lives in takes no room, so nothing below it moves.
  expect(await page.locator("#reader-notices").evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(0);
  await expect(strip).toContainText(/Stewart-Cousins/i);
  // The name in the strip wears the same shade as the speaker's name in the text.
  const shade = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await shade(".rd-who .rd-who-name")).toBe(await shade("#r-15 > h3"));
  // …and the same size: one pill, whether or not the name opens a card.
  const size = (sel: string) => page.locator(sel).first().evaluate((el) => [Math.round(el.getBoundingClientRect().height), getComputedStyle(el).fontSize]);
  expect(await size(".rd-who .rd-who-name")).toEqual(await size("#r-15 > h3"));
  // With her name back on screen the strip no longer names her (it may name a long turn above hers).
  await page.evaluate(() => document.querySelector("#r-15 > h3")!.scrollIntoView({ block: "center" }));
  await expect(page.locator(".rd-who", { hasText: /Stewart-Cousins/i })).toHaveCount(0);
});

test("a witness named in the speaker strip wears the witness shade, not a member's", async ({ page }) => {
  await page.goto("transcripts/2025-02-27-joint-legislative-hearing-in-the-matter-of-the-2025-2026-executive-budget-on-taxes/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0); // the reader tools are running
  await page.evaluate(() => document.fonts.ready.then(() => true)); // and the text has its final line breaks
  // Scroll a long witness remark up until its name has just left the top of the window.
  const id = await page.evaluate(() => {
    const turn = [...document.querySelectorAll<HTMLElement>('section.turn[data-role="guest"]')].find((s) => s.offsetHeight > 900)!;
    scrollTo(0, turn.querySelector("h3")!.getBoundingClientRect().bottom + scrollY + 200);
    return turn.id;
  });
  const name = page.locator(".rd-who .rd-who-name");
  await expect(name).toBeVisible();
  const look = (sel: string) => page.locator(sel).first().evaluate((el) => {
    const css = getComputedStyle(el.matches("button") ? el.querySelector("b")! : el);
    return [getComputedStyle(el).backgroundColor, css.color];
  });
  expect(await look(".rd-who .rd-who-name")).toEqual(await look(`#${id} > h3`));
  const size = (sel: string) => page.locator(sel).first().evaluate((el) => [Math.round(el.getBoundingClientRect().height), getComputedStyle(el).fontSize]);
  expect(await size(".rd-who .rd-who-name")).toEqual(await size(`#${id} > h3`));
});

test("the speaker strip stays steady while scrolling through a long remark", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/#r-15");
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 300);
  await expect(page.locator(".rd-who")).toBeVisible();
  const seen: boolean[] = [];
  for (let step = 0; step < 8; step++) {
    await page.mouse.wheel(0, 50);
    await page.waitForTimeout(80);
    seen.push(await page.locator(".rd-who").isVisible());
  }
  expect(seen).toEqual(Array(8).fill(true));
});

test("a page that begins with a new paragraph shows its number in the margin, with no rule across the text", async ({ page }, info) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  const marker = page.locator("section.turn > .pb").first();
  await expect(marker.locator("b")).toBeVisible();
  await expect(marker.locator("i")).toBeHidden();
  if (info.project.name === "desktop") {
    const next = await marker.locator("xpath=following-sibling::p[1]").boundingBox();
    const number = await marker.locator("b").boundingBox();
    expect(number!.x + number!.width).toBeLessThanOrEqual(next!.x);
    expect(Math.abs(number!.y + number!.height / 2 - (next!.y + 14))).toBeLessThan(10);
  }
});

test("bill numbers in the text link to the bill's page", async ({ page }) => {
  await page.goto("transcripts/2025-03-04-regular-session/");
  const ref = page.locator("section.turn a.bref").first();
  await expect(ref).toHaveAttribute("href", /\/bills\/2025\/[SA]\d+\/$/);
  await expect(ref).toHaveText(/^(Senate|Assembly) (Print|Bill)/);
});

test("each kind of speaker has its own quiet shade: members, the chair of the day, the Secretary, witnesses", async ({ page }) => {
  const shade = async (url: string, role: string) => {
    await page.goto(url);
    return page.locator(`section[data-role="${role}"] > h3`).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  };
  const floor = "transcripts/2025-03-04-regular-session/";
  const hearing = "transcripts/2025-02-27-joint-legislative-hearing-in-the-matter-of-the-2025-2026-executive-budget-on-taxes/";
  const shades = [await shade(floor, "senator"), await shade(floor, "presiding"), await shade(floor, "secretary"), await shade(hearing, "guest")];
  for (const s of shades) expect(s).not.toBe("rgba(0, 0, 0, 0)");
  expect(new Set(shades).size).toBe(4);
  expect(await shade(hearing, "chair")).toBe(shades[0]); // chairs and Assembly members read as members
});
