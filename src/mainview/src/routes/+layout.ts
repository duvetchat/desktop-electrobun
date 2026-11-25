import { browser } from "$app/environment";
import { startLocale } from "$lib/i18n";

export const prerender = true;

// The user's language is loaded before the page draws (#464): a page prerendered in English takes its words on
// hydrating, rather than showing English for a moment first.
export async function load() {
	if (browser) await startLocale();
}
