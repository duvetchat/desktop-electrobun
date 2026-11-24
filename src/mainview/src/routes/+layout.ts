import { browser } from "$app/environment";
import { startLocale } from "$lib/i18n";
import { primeSystemLanguages } from "$lib/i18n/bun-link";
import { currentShell } from "$lib/platform";

export const prerender = true;

// The user's language is loaded before the page draws (#464): a page prerendered in English takes its words on
// hydrating, rather than showing English for a moment first. In the desktop app, Bun's list of the system's languages
// is asked for first, a quarter of a second at most (lib/i18n/bun-link.ts): the web view's may have only the first
// language, and "Match system" and the order of dates and numbers would change once Bun answered.
export async function load() {
	if (!browser) return;
	if (currentShell().chrome !== "web") await primeSystemLanguages();
	await startLocale();
}
