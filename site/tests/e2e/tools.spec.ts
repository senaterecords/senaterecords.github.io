import { expect, test } from "@playwright/test";

const SESSION = "transcripts/2025-03-04-regular-session/";

async function selectInFirstSenatorRemark(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const p = document.querySelector("section.turn[data-role='senator'] p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, Math.min(40, p.firstChild!.textContent!.length));
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

test("Copy with cite puts the quote and a legal citation on the clipboard", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(SESSION);
  await selectInFirstSenatorRemark(page);
  await page.getByRole("button", { name: "Copy with cite" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // Windows' clipboard hands back \r\n for the \n the page wrote.
  expect(copied).toMatch(/^“.+”\r?\nN\.Y\. Senate Tr\., Mar\. 4, 2025, at \d+(–\d+)? \(remarks of Sen\. .+\)$/s);
});

test("the plain citation is one click away", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(SESSION);
  await selectInFirstSenatorRemark(page);
  await page.getByRole("button", { name: "Plain" }).click();
  await expect(page.getByText(/^NY Senate floor transcript, March 4, 2025, pp?\. /)).toBeVisible();
});

test("J and K move between remarks", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(SESSION);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/#r-\d+$/);
  const first = page.url();
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  expect(page.url()).toBe(first);
});

test("a remark that no longer exists lands at the top with a notice", async ({ page }) => {
  await page.goto(`${SESSION}#r-999999`);
  await expect(page.getByText(/That remark is no longer in this transcript/)).toBeVisible();
});

test("Markdown export downloads the transcript", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(SESSION);
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Markdown" }).click()]);
  expect(download.suggestedFilename()).toBe("2025-03-04-regular-session.md");
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text).toMatch(/^# /);
  expect(text).toMatch(/\*\*The Secretary:\*\*/i);
  expect(text).toMatch(/\*p\. \d+\*/);
});

test("following an in-page link to a missing remark also shows the notice", async ({ page }) => {
  await page.goto(SESSION);
  await page.evaluate(() => { location.hash = "#r-999999"; });
  await expect(page.getByText(/That remark is no longer in this transcript/)).toBeVisible();
});

test("the phone remark bar steps through remarks", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto(SESSION);
  await expect(page.getByText(/Remark \d+ of \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Next remark" }).tap();
  await expect(page).toHaveURL(/#r-\d+$/);
});

test("the phone calendar sheet takes the focus", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto("transcripts/2025-03-04-regular-session/");
  const reading = await page.locator(".rd-seg + section.turn").first().getAttribute("id");
  await page.goto(`transcripts/2025-03-04-regular-session/#${reading}`);
  const bar = page.getByRole("button", { name: "Show the calendar" });
  await bar.tap();
  await expect(page.getByRole("dialog", { name: "On the calendar" })).toBeFocused();
});
