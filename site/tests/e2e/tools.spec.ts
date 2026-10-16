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

test("a quote across two speakers names each line's speaker, and both in the citation", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(SESSION);
  // From the middle of one senator's remark into the next remark, by someone else.
  const names = await page.evaluate(() => {
    const turns = [...document.querySelectorAll<HTMLElement>("#transcript section.turn[id^='r-']")];
    const i = turns.findIndex((t, k) => t.dataset.role === "senator" && turns[k + 1] && turns[k + 1].querySelector("h3")!.textContent !== t.querySelector("h3")!.textContent);
    const [a, b] = [turns[i], turns[i + 1]];
    const from = a.querySelector("p")!.firstChild!;
    const to = b.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(from, Math.min(5, from.textContent!.length));
    range.setEnd(to, Math.min(20, to.textContent!.length));
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    b.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return [a.querySelector("h3")!.textContent!, b.querySelector("h3")!.textContent!];
  });
  await page.getByRole("button", { name: "Copy with cite" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const [quote, cite] = [copied.slice(0, copied.lastIndexOf("N.Y. Senate")), copied.slice(copied.lastIndexOf("N.Y. Senate"))];
  const titled = (label: string) => label.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  expect(quote).toContain(`${titled(names[0])}: `);
  expect(quote).toContain(`${titled(names[1])}: `);
  expect(quote.split(names[1]).length - 1).toBe(1); // only as its line's lead: the name chip itself stays out
  expect(quote).not.toMatch(/[a-z][.?!][A-Z]/); // paragraphs keep a space between them
  expect(cite).toMatch(/\(remarks of .+ and .+\)$/);
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

test("a transcript exports as a Word document or as plain text", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(SESSION);
  const save = async (choice: string) => {
    await page.getByRole("button", { name: "Export" }).click();
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: choice }).click()]);
    return { name: file.suggestedFilename(), bytes: Buffer.concat(await (await file.createReadStream()).toArray()) };
  };
  const word = await save("Word document");
  expect(word.name).toBe("2025-03-04-regular-session.docx");
  expect(word.bytes.subarray(0, 2).toString()).toBe("PK"); // a zip, as every .docx is
  expect(word.bytes.includes(Buffer.from("word/document.xml"))).toBe(true);
  const text = await save("Plain text");
  expect(text.name).toBe("2025-03-04-regular-session.txt");
  expect(text.bytes.toString("utf8")).toMatch(/The Secretary: /i);
  expect(text.bytes.toString("utf8")).toMatch(/\[p\. \d+\]/);
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("menuitem", { name: /Markdown/ })).toHaveCount(0);
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

test("the phone remark bar keeps its arrows at the two ends and the count in the middle", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto(SESSION);
  const bar = (await page.locator(".remarkbar").boundingBox())!;
  const prev = (await page.getByRole("button", { name: "Previous remark" }).boundingBox())!;
  const next = (await page.getByRole("button", { name: "Next remark" }).boundingBox())!;
  const label = (await page.locator(".remarkbar > span").boundingBox())!;
  expect(prev.x - bar.x).toBeLessThanOrEqual(16);
  expect(bar.x + bar.width - (next.x + next.width)).toBeLessThanOrEqual(16);
  expect(Math.abs(label.x + label.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(4);
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

test("Find in transcript counts the matches and steps through them", async ({ page }, info) => {
  test.skip(info.project.name === "phone");
  await page.goto(SESSION);
  const find = page.getByRole("searchbox", { name: "Find in transcript" });
  await find.fill("SENATE");
  const count = page.locator(".fd-count");
  await expect(count).toHaveText(/^1 of \d+$/);
  const total = Number((await count.textContent())!.split(" of ")[1]);
  expect(total).toBeGreaterThan(2);
  expect(await page.evaluate(() => CSS.highlights.get("find")?.size)).toBe(total);
  await find.press("Enter");
  await expect(count).toHaveText(`2 of ${total}`);
  await expect.poll(() => page.evaluate(() => {
    const box = ([...CSS.highlights.get("find-active")!][0] as Range).getBoundingClientRect();
    return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight;
  })).toBe(true);
  await find.press("Shift+Enter");
  await expect(count).toHaveText(`1 of ${total}`);
  await find.press("Escape");
  expect(await page.evaluate(() => CSS.highlights.get("find")?.size ?? 0)).toBe(0);
  await page.locator("body").press("/");
  await expect(find).toBeFocused();
});

test("on a phone, Find in transcript opens from the toolbar", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto(SESSION);
  await page.getByRole("button", { name: "Find in transcript" }).tap();
  const find = page.getByRole("searchbox", { name: "Find in transcript" });
  await expect(find).toBeVisible();
  await find.fill("senate");
  await expect(page.locator(".fd-count")).toHaveText(/^1 of \d+$/);
  await page.getByRole("button", { name: "Close find" }).tap();
  await expect(find).toBeHidden();
});

test("on a phone the find bar closes even before anything is typed, and the toolbar has one magnifier", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto(SESSION);
  // Only Find in transcript: the site-wide Search link would be a second, identical magnifier beside it.
  await expect(page.locator(".bar").getByRole("link", { name: "Search", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Find in transcript" }).tap();
  await expect(page.getByRole("searchbox", { name: "Find in transcript" })).toBeVisible();
  await page.getByRole("button", { name: "Close find" }).tap();
  await expect(page.getByRole("searchbox", { name: "Find in transcript" })).toBeHidden();
});

