// Years with transcripts, newest first, for the year: suggestions.
import type { APIRoute } from "astro";
import { years } from "../../lib/data";

export const GET: APIRoute = () => new Response(JSON.stringify(years()), { headers: { "Content-Type": "application/json" } });
