// The app's words in the user's language (#464). t() gives a message of src/mainview/messages/<locale>.json, written in
// ICU MessageFormat, through i18next and i18next-icu. English is loaded with the app and is what a missing message falls
// back to; another language's file loads when it's picked, before the switch, so nothing shows half switched.
//
// The switch happens in place: t() is a reactive read (createSubscriber), so a template or $derived that calls it runs
// again when the language changes, and a call in progress stays up. A message kept in a module's constant never would:
// modules call t() when they're asked for words, not when they load. A plain module, not runes, so Bun's tests load it
// as it is, as every component that has words will import it.
import { createInstance } from "i18next";
import { createSubscriber } from "svelte/reactivity";
import ICU from "i18next-icu";
import type { IntlMessageFormat } from "intl-messageformat";
import en from "../../messages/en.json";
import {
	LOCALE_KEY,
	LOCALE_NAMES,
	LOCALES,
	PSEUDO,
	SHIPPED,
	formatLocale,
	matchLocale,
	parseLocalePref,
	resolveLocale,
	type Locale,
	type LocalePref,
	type UiLocale,
} from "$lib/i18n/locale";
import { richFormat, richPieces, type RichPart } from "$lib/i18n/rich";

export type { RichPart };

export type MessageKey = keyof typeof en;
export type MessageValues = Record<string, string | number | Date>;
type Messages = Record<string, string>;

const devBuild = typeof VITE_APP_ENV !== "undefined" && VITE_APP_ENV === "development";

/** The languages the picker lists: the shipped ones, and in a development build every one and the pseudo-language. */
export const OFFERED: readonly UiLocale[] = devBuild ? [...LOCALES, PSEUDO] : SHIPPED;

const i18n = createInstance();
void i18n.use(ICU).init({
	// English is in hand: init is done before anything can ask for a message.
	initAsync: false,
	lng: "en",
	fallbackLng: "en",
	resources: { en: { translation: en } },
	// Svelte escapes what it puts in the page; escaping here too would show &amp; in names.
	interpolation: { escapeValue: false },
});

// The system's languages as the desktop app's Bun process reads them (setSystemLanguages): the whole list, where
// WKWebView's navigator.languages has only the first, mapped (es-CO is es-419 there). null where Bun hasn't said.
let bunLanguages: readonly string[] | null = null;

/** The system's preferred languages, most preferred first: Bun's when it has said, else the web view's. */
function systemLanguages(): readonly string[] {
	if (bunLanguages) return bunLanguages;
	return typeof navigator !== "undefined" && navigator.languages?.length ? navigator.languages : [];
}

/** A language tag Intl takes, in its canonical form; null for anything else. */
function canonicalTag(tag: unknown): string | null {
	if (typeof tag !== "string" || !tag) return null;
	try {
		return Intl.getCanonicalLocales(tag)[0] ?? null;
	} catch {
		return null;
	}
}

function readSaved(): LocalePref {
	try {
		return parseLocalePref(localStorage.getItem(LOCALE_KEY), OFFERED);
	} catch {
		return "system";
	}
}

// The language picked in Appearance, and the one the app is in now: English until startLocale() loads the pick, which
// the root layout's load waits for before the page draws.
let pref: LocalePref = typeof window === "undefined" ? "system" : readSaved();
let current: UiLocale = "en";

// What reads the language from an effect or a template runs again when it changes: changed() tells them.
let changed = () => {};
const track = createSubscriber((update) => {
	changed = update;
	return () => (changed = () => {});
});

/** The language picked in Appearance, or System. */
export function localePref(): LocalePref {
	track();
	return pref;
}

/** The language the app is in now. */
export function currentLocale(): UiLocale {
	track();
	return current;
}

/** A message in the app's language, with its placeholders filled in. One with tags in it is Rich's to draw. */
export function t(key: MessageKey, values?: MessageValues): string {
	track();
	return i18n.t(key, values ?? {});
}

/**
 * The locale dates, times and numbers are written in (lib/i18n/format.ts): the system's own when it's in the app's
 * language, else the app's language.
 */
export function regionalLocale(): string {
	track();
	return formatLocale(current, systemLanguages());
}

/** The name, in itself, of the language "Match system" comes to now. */
export function systemLanguageName(): string {
	track();
	return LOCALE_NAMES[matchLocale(systemLanguages(), SHIPPED)];
}

/** A language file's messages: what it holds that's a string. */
function messagesIn(file: unknown): Messages {
	const messages = typeof file === "object" && file !== null && "default" in file ? file.default : file;
	if (typeof messages !== "object" || messages === null) return {};
	return Object.fromEntries(
		Object.entries(messages).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);
}

// Each language's file but English's, which comes with the app: a chunk of its own, loaded when it's picked.
const FILES: Record<Exclude<Locale, "en">, () => Promise<unknown>> = {
	es: () => import("../../messages/es.json"),
	fr: () => import("../../messages/fr.json"),
	de: () => import("../../messages/de.json"),
	"pt-BR": () => import("../../messages/pt-BR.json"),
	it: () => import("../../messages/it.json"),
};

async function load(locale: UiLocale): Promise<void> {
	if (i18n.hasResourceBundle(locale, "translation")) return;
	const messages =
		locale === PSEUDO
			? (await import("$lib/i18n/pseudo")).pseudoMessages(en)
			: locale === "en"
				? en
				: messagesIn(await FILES[locale]());
	i18n.addResourceBundle(locale, "translation", messages);
}

let applying = 0;

/** Puts the app in the language its pick comes to now, once that language's messages are in. */
async function apply(): Promise<void> {
	const turn = ++applying;
	const next = resolveLocale(pref, systemLanguages());
	if (next === current && i18n.language === next) return;
	await load(next);
	// A later pick, or the system's languages changing, took over while this one loaded.
	if (turn !== applying) return;
	await i18n.changeLanguage(next);
	current = next;
	changed();
	if (typeof document !== "undefined") document.documentElement.lang = next;
}

/**
 * The system's preferred languages, most preferred first, as the desktop app's Bun process reads them
 * (src/bun/system-languages.ts, lib/i18n/bun-link.ts): "Match system" and the locale of dates and numbers go by them
 * rather than by the web view's, which may have only the first. A list with no tag Intl takes leaves the web view's.
 */
export function setSystemLanguages(languages: readonly unknown[]): Promise<void> {
	const tags = [...new Set(languages.map(canonicalTag).filter((tag): tag is string => tag !== null))];
	const next = tags.length ? tags : null;
	if (next?.join() !== bunLanguages?.join()) {
		bunLanguages = next;
		changed();
	}
	return apply();
}

/** The root layout's load waits for this: the page draws in the user's language from its first frame. */
export function startLocale(): Promise<void> {
	return apply();
}

/** Picks a language in Appearance, or System again. Saved on this device; the app's other windows follow it. */
export function setLocalePref(picked: LocalePref): Promise<void> {
	pref = picked;
	changed();
	try {
		localStorage.setItem(LOCALE_KEY, picked);
	} catch {
		// no storage: the pick lasts until the app closes
	}
	return apply();
}

/**
 * Keeps this window's language with the pick and the system: the windows share localStorage, so a pick made in another
 * one (Settings is its own window) arrives as a storage event; System follows the system's languages as they change.
 * Returns what stops it.
 */
export function followLocale(): () => void {
	if (typeof window === "undefined") return () => {};
	const onStorage = (event: StorageEvent) => {
		if (event.key !== LOCALE_KEY) return;
		pref = parseLocalePref(event.newValue, OFFERED);
		changed();
		void apply();
	};
	const onLanguages = () => void apply();
	window.addEventListener("storage", onStorage);
	window.addEventListener("languagechange", onLanguages);
	return () => {
		window.removeEventListener("storage", onStorage);
		window.removeEventListener("languagechange", onLanguages);
	};
}

// Each language's messages with tags, read once.
const formats = new Map<string, IntlMessageFormat>();

/**
 * A message with tags in it (<b>…</b>, <link>…</link>) in the app's language, in its pieces (lib/i18n/rich.ts), for
 * Rich.svelte to draw each tag's words as it should.
 */
export function richParts(key: MessageKey, values: MessageValues = {}): RichPart[] {
	track();
	const id = `${current}\u0000${key}`;
	let format = formats.get(id);
	if (!format) {
		const own: unknown = i18n.getResource(current, "translation", key);
		format = richFormat(typeof own === "string" ? own : en[key], current);
		formats.set(id, format);
	}
	return richPieces(format, values);
}
