import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the fixture build, served the way GitHub Pages serves it (optionally under SITE_BASE).
const baseURL = `http://127.0.0.1:4329${process.env.SITE_BASE ?? "/"}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] },
    },
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: "npm run build:fixture && npm run preview",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
