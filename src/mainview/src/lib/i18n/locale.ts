// Which language the app speaks (#464): the user's pick, saved on this device, or the system's. Plain functions, so
// lib/i18n.ts and its tests share them; the words themselves are in src/mainview/messages/<locale>.json.

/** The language the user picked in Appearance, saved on this device. */
export const LOCALE_KEY = "duvet.locale.v1";

/** Every language the app has words for. English first: the others are written from it. */
export const LOCALES = ["en", "es", "fr", "de", "pt-BR", "it", "fi"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The languages a released build offers, and the only ones "Match system" comes to. A language joins once its file has
 * every key (lib/i18n.test.ts holds it to that): until then a system in that language would get the app half in it.
 * A development build offers every language, and the pseudo-language, to pick by hand.
 */
export const SHIPPED: readonly Locale[] = ["en", "es", "pt-BR", "it", "fr", "de", "fi"];

/**
 * English with every letter accented, in brackets and a third longer (lib/i18n/pseudo.ts): text still in English after
 * a switch is text no key holds, and text that's cut or wraps badly is text that won't fit a longer language.
 * Development builds only.
 */
export const PSEUDO = "en-XA";
export type UiLocale = Locale | typeof PSEUDO;

/** Each language in its own words, as the picker lists them whatever language the app is in. */
export const LOCALE_NAMES: Record<UiLocale, string> = {
	en: "English",
	es: "Español",
	fr: "Français",
	de: "Deutsch",
	"pt-BR": "Português (Brasil)",
	it: "Italiano",
	fi: "Suomi",
	[PSEUDO]: "Ƥšéûðö (en-XA)",
};

/**
 * The country whose flag the picker shows beside each language (#565), as its region code. A flag is a country's, not
 * a language's: English's is the United States', whose spelling the app's English keeps, and Spanish, written for Latin
 * America, has Mexico's, its largest country. The pseudo-language has none. The flag only decorates: the name is the
 * option's label.
 */
export const LOCALE_FLAGS: Record<UiLocale, string | null> = {
	en: "US",
	es: "MX",
	fr: "FR",
	de: "DE",
	"pt-BR": "BR",
	it: "IT",
	fi: "FI",
	[PSEUDO]: null,
};

/** A region's flag emoji: its two letters as regional indicator symbols ("FR" is 🇫🇷). */
export function flagEmoji(region: string): string {
	return String.fromCodePoint(...[...region.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** System follows the system's languages, among those shipped; a language keeps to it. */
export type LocalePref = "system" | UiLocale;

/** A saved pick, if it's one this build offers: an unknown or withdrawn one is System again. */
export function parseLocalePref(raw: string | null, offered: readonly UiLocale[]): LocalePref {
	return offered.find((locale) => locale === raw) ?? "system";
}

const language = (tag: string) => tag.split("-")[0]!.toLowerCase();

/**
 * The language the system's preferred ones (navigator.languages, most preferred first) come to among those offered: for
 * each in turn, the one that is it exactly, else one of its language (es-MX is es, pt-PT is pt-BR). English when none is.
 */
export function matchLocale(preferred: readonly string[], offered: readonly Locale[]): Locale {
	for (const tag of preferred) {
		const exact = offered.find((locale) => locale.toLowerCase() === tag.toLowerCase());
		if (exact) return exact;
		const same = offered.find((locale) => language(locale) === language(tag));
		if (same) return same;
	}
	return "en";
}

/** The language a pick comes to: System's is the system's among the shipped languages. */
export function resolveLocale(pref: LocalePref, preferred: readonly string[]): UiLocale {
	return pref === "system" ? matchLocale(preferred, SHIPPED) : pref;
}

/**
 * The locale dates, times and numbers are written in: the system's own when it's in the app's language, so an English app
 * on a British system keeps day-month order and its 24-hour clock; the app's language when the system's is another.
 */
export function formatLocale(locale: UiLocale, preferred: readonly string[]): string {
	const base = locale === PSEUDO ? "en" : locale;
	return preferred.find((tag) => language(tag) === language(base)) ?? base;
}
