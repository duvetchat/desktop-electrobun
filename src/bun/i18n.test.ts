import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, PSEUDO, SHIPPED, type UiLocale } from "../mainview/src/lib/i18n/locale";
import { pseudoMessage } from "../mainview/src/lib/i18n/pseudo";
import { bunMessages, isBunKey } from "./bun-messages";
import { keptLanguage, language, parseLanguage, setLanguage, startingLanguage, t, tIn } from "./i18n";

// The Bun process's words (#464): the menu bar, the windows' titles and macOS's permission prompts, from the app's own
// language files, in the language the main window's page says.
const read = (locale: string): Record<string, string> =>
	JSON.parse(readFileSync(join(import.meta.dir, "..", "mainview", "messages", `${locale}.json`), "utf8"));

describe("Bun's messages", () => {
	test("are each language file's menu_, window_, os_ and e2e_box_ ones, and no other", () => {
		const messages = bunMessages();
		for (const locale of LOCALES) {
			const own = Object.fromEntries(Object.entries(read(locale)).filter(([key]) => isBunKey(key)));
			expect({ locale, messages: messages[locale] }).toEqual({ locale, messages: own });
		}
		expect(Object.keys(messages.en ?? {}).length).toBeGreaterThan(20);
		expect(Object.keys(messages.en ?? {}).every(isBunKey)).toBe(true);
	});

	test("have the pseudo-language's, made from English's", () => {
		const messages = bunMessages();
		const en = messages.en ?? {};
		expect(messages[PSEUDO]).toEqual(Object.fromEntries(Object.entries(en).map(([key, m]) => [key, pseudoMessage(m)])));
	});
});

describe("what Bun says", () => {
	test("is English until the page says otherwise", () => {
		expect(language()).toBe("en");
		expect(t("menu_about", { name: "Duvet" })).toBe("About Duvet");
		expect(t("window_voice_controls")).toBe("Voice controls");
	});

	test("is in the language set, and English's words where that language has none yet", () => {
		try {
			expect(setLanguage(PSEUDO)).toBe(true);
			expect(language()).toBe(PSEUDO);
			expect(t("menu_edit")).toBe(pseudoMessage("Edit"));
			// Spanish's own once it's translated; English's until then.
			expect(tIn("es", "menu_edit")).toBe(read("es").menu_edit ?? "Edit");
		} finally {
			setLanguage("en");
		}
	});

	test("shows a name as it was written: braces and apostrophes in it are no ICU", () => {
		expect(t("window_space_settings", { name: "Kiln {&} 'Clay'" })).toBe("Kiln {&} 'Clay' · Space settings");
	});

	test("changes only for a language the app has, and one it isn't in already", () => {
		expect(setLanguage("en")).toBe(false);
		expect(setLanguage("xx")).toBe(false);
		expect(setLanguage({ locale: "es" })).toBe(false);
		expect(language()).toBe("en");
		try {
			expect(setLanguage("fr")).toBe(true);
			expect(setLanguage("fr")).toBe(false);
		} finally {
			setLanguage("en");
		}
	});

	test("knows the app's languages and the pseudo-language, and nothing else", () => {
		const languages: readonly UiLocale[] = [...LOCALES, PSEUDO];
		for (const locale of languages) expect(parseLanguage(locale)).toBe(locale);
		for (const value of ["EN", "pt", "es-CO", "", null, 1]) expect(parseLanguage(value)).toBeNull();
	});
});

describe("the language a start speaks", () => {
	test("is the one the page said last time", () => {
		expect(startingLanguage(keptLanguage("fr"), ["de-DE"])).toBe("fr");
		expect(startingLanguage(keptLanguage(PSEUDO), [])).toBe(PSEUDO);
	});

	// As the page's Match system would: among the languages a released build offers.
	test("is the system's, among the shipped languages, without one kept, or with one that can't be read", () => {
		const expected = SHIPPED.includes("es") ? "es" : "en";
		for (const kept of [null, "", "{", "null", '{"locale":"xx"}', '"es"']) {
			expect(startingLanguage(kept, ["es-CO", "en-CO"])).toBe(expected);
		}
		expect(startingLanguage(null, [])).toBe("en");
	});

	// With more languages shipped than a release has today: the system's list is what it's picked by.
	test("goes by the system's languages, the first one shipped, else English", () => {
		expect(startingLanguage(null, ["es-CO", "en-CO"], ["en", "es"])).toBe("es");
		expect(startingLanguage("{", ["fr-CA", "es-MX"], ["en", "es", "fr"])).toBe("fr");
		expect(startingLanguage(null, ["nl"], ["en", "es"])).toBe("en");
	});
});
