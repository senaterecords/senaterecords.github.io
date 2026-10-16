import { expect, test } from "@playwright/test";

test.skip(!process.env.OTR_PERF, "run against a real-data build with OTR_PERF=1 and OTR_PERF_SLUG set");

test("the largest transcript opens fast and scrolls smoothly", async ({ page }) => {
  const slug = process.env.OTR_PERF_SLUG!;
  await page.goto(`transcripts/${slug}/`);
  const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0);
  const longTasks = await page.evaluate(async () => {
    let total = 0;
    new PerformanceObserver((list) => { for (const e of list.getEntries()) total += e.duration; }).observe({ type: "longtask", buffered: false });
    for (let i = 0; i < 20; i++) { window.scrollBy(0, window.innerHeight); await new Promise((r) => requestAnimationFrame(() => r(null))); }
    await new Promise((r) => setTimeout(r, 300));
    return total;
  });
  console.log(JSON.stringify({ slug, fcp, longTasks }));
  expect(fcp).toBeLessThan(1500);
  expect(longTasks).toBeLessThan(300);
});
