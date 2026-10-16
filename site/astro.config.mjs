import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// SITE_BASE is the GitHub Pages project path, e.g. "/ontherecord/"; "/" for a user or custom domain.
export default defineConfig({
  output: "static",
  base: process.env.SITE_BASE ?? "/",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
