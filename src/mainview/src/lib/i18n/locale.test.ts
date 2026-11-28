import { describe, expect, test } from "bun:test";
import {
	LOCALE_FLAGS,
	LOCALE_NAMES,
	LOCALES,
	flagEmoji,
	PSEUDO,
	SHIPPED,
	formatLocale,
	matchLocale,
	parseLocalePref,
	resolveLocale,
	type UiLocale,
} from "./locale";

describe("a saved pick", () => {
	test("is kept when this build offers it", () => {
		expect(parseLocalePref("es", LOCALES)).toBe("es");
		expect(parseLocalePref("pt-BR", LOCALES)).toBe("pt-BR");
		expect(parseLocalePref("system", LOCALES)).toBe("system");
	});

	test("is System again when it's unknown, missing, or a language this build doesn't offer", () => {
		expect(parseLocalePref("tlh", LOCALES)).toBe("system");
		expect(parseLocalePref(null, LOCALES)).toBe("system");
		expect(parseLocalePref("es", SHIPPED)).toBe(SHIPPED.includes("es") ? "es" : "system");
		expect(parseLocalePref(PSEUDO, LOCALES)).toBe("system");
	});
});

describe("the system's languages", () => {
	test("come to the first that matches, exactly or by language", () => {
		expect(matchLocale(["es-MX", "en"], LOCALES)).toBe("es");
		expect(matchLocale(["pt-PT"], LOCALES)).toBe("pt-BR");
		expect(matchLocale(["pt-BR"], LOCALES)).toBe("pt-BR");
		expect(matchLocale(["sw-KE", "fr-CA", "de"], LOCALES)).toBe("fr");
		expect(matchLocale(["DE-at"], LOCALES)).toBe("de");
		expect(matchLocale(["ja-JP"], LOCALES)).toBe("ja");
	});

	test("come to the regional file they're nearer, else the language's own", () => {
		expect(matchLocale(["es-ES"], LOCALES)).toBe("es-ES");
		expect(matchLocale(["es-419"], LOCALES)).toBe("es");
		expect(matchLocale(["es"], LOCALES)).toBe("es");
		expect(matchLocale(["en-GB"], LOCALES)).toBe("en-GB");
		expect(matchLocale(["en-AU"], LOCALES)).toBe("en-GB");
		expect(matchLocale(["en-US"], LOCALES)).toBe("en");
		expect(matchLocale(["en-CA"], LOCALES)).toBe("en");
		expect(matchLocale(["zh-Hans-CN"], LOCALES)).toBe("zh-CN");
		expect(matchLocale(["zh-SG"], LOCALES)).toBe("zh-CN");
		expect(matchLocale(["zh"], LOCALES)).toBe("zh-CN");
		expect(matchLocale(["zh-Hant-TW"], LOCALES)).toBe("zh-TW");
		expect(matchLocale(["zh-HK"], LOCALES)).toBe("zh-TW");
		expect(matchLocale(["zh-Hant"], LOCALES)).toBe("zh-TW");
	});

	test("come to English when none matches, or when the system says none", () => {
		expect(matchLocale(["sw-KE", "nl"], LOCALES)).toBe("en");
		expect(matchLocale(["not a tag"], LOCALES)).toBe("en");
		expect(matchLocale([], LOCALES)).toBe("en");
	});

	test("System only comes to a shipped language: a language half done is never the default", () => {
		for (const locale of LOCALES) {
			expect(resolveLocale("system", [locale])).toBe(SHIPPED.includes(locale) ? locale : "en");
		}
	});

	test("a language picked by hand is that language, shipped or not", () => {
		expect(resolveLocale("de", ["es-MX"])).toBe("de");
		expect(resolveLocale(PSEUDO, [])).toBe(PSEUDO);
	});
});

describe("dates and numbers", () => {
	test("keep the system's region when it's in the app's language", () => {
		expect(formatLocale("en", ["en-GB", "es"])).toBe("en-GB");
		expect(formatLocale("es", ["en-GB", "es-MX"])).toBe("es-MX");
		expect(formatLocale(PSEUDO, ["en-AU"])).toBe("en-AU");
	});

	test("are in the app's language when the system is in another", () => {
		expect(formatLocale("es", ["en-US"])).toBe("es");
		expect(formatLocale("pt-BR", [])).toBe("pt-BR");
		expect(formatLocale(PSEUDO, ["fr-FR"])).toBe("en");
	});

	test("are in the app's script when the system writes its language in another", () => {
		expect(formatLocale("zh-TW", ["zh-Hans-CN"])).toBe("zh-TW");
		expect(formatLocale("zh-TW", ["zh-Hant-HK"])).toBe("zh-Hant-HK");
		expect(formatLocale("en-GB", ["en-US"])).toBe("en-US");
	});
});

test("every language has its name in itself, for the picker", () => {
	const all: UiLocale[] = [...LOCALES, PSEUDO];
	for (const locale of all) expect(LOCALE_NAMES[locale]).toBeTruthy();
	expect(LOCALE_NAMES.es).toBe("Español");
	expect(LOCALE_NAMES["pt-BR"]).toBe("Português (Brasil)");
});

test("every language has a country's flag for the picker, and the pseudo-language none", () => {
	for (const locale of LOCALES) expect(LOCALE_FLAGS[locale]).toMatch(/^[A-Z]{2}$/);
	expect(LOCALE_FLAGS[PSEUDO]).toBeNull();
	expect(LOCALE_FLAGS["pt-BR"]).toBe("BR");
});

test("a region's flag is its letters as regional indicators", () => {
	expect(flagEmoji("FR")).toBe("🇫🇷");
	expect(flagEmoji("mx")).toBe("🇲🇽");
});
