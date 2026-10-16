// One sprite of the mocks' icons, so each page references them instead of repeating their paths (about 300 bytes
// an icon, several icons a page, 60,000 pages).
import type { APIRoute } from "astro";
import { ICONS } from "../lib/icons";

export const GET: APIRoute = () => {
  const symbols = Object.entries(ICONS).map(([name, [viewBox, body]]) => `<symbol id="${name}" viewBox="${viewBox}">${body}</symbol>`);
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg">${symbols.join("")}</svg>`, { headers: { "Content-Type": "image/svg+xml" } });
};
