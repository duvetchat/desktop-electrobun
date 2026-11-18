import type { Handle } from "@sveltejs/kit";
import { stylesheetsFirst } from "$lib/head-order";

// Runs when the pages are prerendered (every route is; nothing runs on a server afterwards): each page's stylesheet
// is requested before its module preloads, so the first paint doesn't wait behind them (lib/head-order.ts).
export const handle: Handle = ({ event, resolve }) =>
	resolve(event, { transformPageChunk: ({ html }) => stylesheetsFirst(html) });
