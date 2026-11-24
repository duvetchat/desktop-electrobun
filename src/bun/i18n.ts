// The Bun process's words in the app's language (#464): the menu bar, the windows' titles, what Bun answers the pages
// and macOS's permission prompts. The same messages as the page's (src/mainview/messages/<locale>.json, ICU
// MessageFormat), through an i18next instance of Bun's own with i18next-icu; only the menu_, window_ and os_ ones, which
// bun-messages.ts picks as the bundle is built.
//
// Bun has no language of its own: the main window's page says which it's in, at its start and at each change
// (appLanguage, src/bun/index.ts), and the app keeps the last one for its next start, whose menu bar is set before any
// page can say (startingLanguage). Words are asked for when they're shown: a title kept from before stays in the
// language it was made in, so what shows them takes the new words when the language changes.
//
// A known limitation: what AppKit says itself follows the bundle's language, which macOS picks from the system's
// languages among the bundle's (CFBundleLocalizations, scripts/localize-bundle.ts), not from the app's pick. That's the
// names AppKit gives some items (View's Enter and Exit Full Screen, Edit's Start Dictation… and Emoji & Symbols), the
// About panel, the open and save panels, and the microphone and camera prompts. While English is the one language
// shipped, all of it is English, as a released build is; once another ships, a pick that isn't the system's has them in
// the system's language beside the app's menu items. The way out is writing the pick into the app's own AppleLanguages
// default (removing it for System), which AppKit and the prompts follow from the next start, with "Match system"
// reading the global list (CFPreferences, kCFPreferencesAnyApplication) so the app's own doesn't feed back into it.
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import type en from "../mainview/messages/en.json";
import { LOCALES, PSEUDO, resolveLocale, type UiLocale } from "../mainview/src/lib/i18n/locale";
import { bunMessages } from "./bun-messages" with { type: "macro" };

/** A message of Bun's: one of the language files' menu_, window_ and os_ keys. */
export type BunMessageKey = Extract<keyof typeof en, `menu_${string}` | `window_${string}` | `os_${string}`>;
export type MessageValues = Record<string, string | number | Date>;

const MESSAGES = bunMessages();
/** Every language Bun can be told: the app's, and the pseudo-language a development build offers. */
const LANGUAGES: readonly UiLocale[] = [...LOCALES, PSEUDO];

const i18n = createInstance();
void i18n.use(ICU).init({
	// Every language's messages are in hand: init is done before anything can ask for one.
	initAsync: false,
	lng: "en",
	fallbackLng: "en",
	resources: Object.fromEntries(LANGUAGES.map((locale) => [locale, { translation: MESSAGES[locale] ?? {} }])),
	// What Bun shows is text, never markup: nothing to escape.
	interpolation: { escapeValue: false },
});

let current: UiLocale = "en";

/** One of the languages Bun can speak, or null for anything else. */
export function parseLanguage(value: unknown): UiLocale | null {
	return LANGUAGES.find((locale) => locale === value) ?? null;
}

/** The language Bun speaks now. */
export function language(): UiLocale {
	return current;
}

/** Speaks a language from now on. False for one Bun doesn't have, or the one it speaks already: nothing changes. */
export function setLanguage(value: unknown): boolean {
	const next = parseLanguage(value);
	if (next === null || next === current) return false;
	current = next;
	return true;
}

/** A message in a given language, with its placeholders filled in: English's where that language has none yet. */
export function tIn(locale: UiLocale, key: BunMessageKey, values: MessageValues = {}): string {
	return i18n.t(key, { ...values, lng: locale });
}

/** A message in the language Bun speaks now. */
export function t(key: BunMessageKey, values?: MessageValues): string {
	return tIn(current, key, values);
}

/** What the app keeps of the language between two starts (language.json in its data). */
export const keptLanguage = (locale: UiLocale) => JSON.stringify({ locale });

/** The language a start speaks until the main window's page says: the one it said last time, else the system's among
 * the languages a released build offers, as the page's "Match system" would. */
export function startingLanguage(kept: string | null, system: readonly string[]): UiLocale {
	try {
		const value: unknown = kept === null ? null : JSON.parse(kept);
		const locale = typeof value === "object" && value !== null && "locale" in value ? value.locale : null;
		return parseLanguage(locale) ?? resolveLocale("system", system);
	} catch {
		return resolveLocale("system", system);
	}
}
