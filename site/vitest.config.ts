import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], env: { OTR_DATA: "tests/fixtures/data-site" } },
});
