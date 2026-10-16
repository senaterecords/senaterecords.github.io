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

test("copying text across page breaks leaves the page numbers out", async ({ page }, info) => {
  test.skip(info.project.name === "phone"); // clipboard access is granted to the desktop project
  await page.goto(SESSION);
  // A whole remark with a page break inside a paragraph, then two paragraphs either side of a break between them.
  for (const pick of ["inline", "between"] as const) {
    const marks = await page.evaluate((pick) => {
      const pb = document.querySelector<HTMLElement>(pick === "inline" ? "#transcript p > .pb" : "#transcript .turn > .pb")!;
      const turn = pb.closest("section.turn")!;
      const range = document.createRange();
      if (pick === "inline") range.selectNodeContents(turn);
      else { range.setStartBefore(pb.previousElementSibling!); range.setEndAfter(pb.nextElementSibling!); }
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return [pb.querySelector("b")!.textContent!, ...(pick === "inline" ? [turn.querySelector(".g")?.textContent ?? ""] : [])].filter(Boolean);
    }, pick);
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.keyboard.press("Control+C");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.length).toBeGreaterThan(40);
    expect(copied).not.toContain(marks[0]); // "p. N"
    if (marks[1]) expect(copied).not.toMatch(new RegExp(`(^|\\s)${marks[1]}(\\s|$)`)); // the turn's page in the gutter
  }
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

test("printing or saving as PDF leaves out the reader's pop-ups", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(SESSION);
  await page.locator("h3.sp.sen").first().click();
  await expect(page.locator(".scard")).toBeVisible();
  await selectInFirstSenatorRemark(page);
  const cite = page.getByRole("dialog", { name: "Cite this passage" });
  await expect(cite).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(cite).toBeHidden();
  await expect(page.locator(".scard")).toBeHidden();
  await expect(page.locator("section.turn p").first()).toBeVisible();
});
