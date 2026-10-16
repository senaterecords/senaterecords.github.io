import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// SITE_BASE is the GitHub Pages project path, e.g. "/ontherecord/"; "/" for a user or custom domain.
export default defineConfig({
  output: "static",
  base: process.env.SITE_BASE ?? "/",
  trailingSlash: "always",
  // Stylesheets are always linked, never inlined: inlining repeats them in each of 60,000 pages.
  build: { format: "directory", inlineStylesheets: "never" },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
