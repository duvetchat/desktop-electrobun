import { describe, expect, test } from "bun:test";
import { linuxLanguages, posixTag, systemLanguages, windowsLanguages } from "./system-languages";

// The system's preferred languages, for the pages' "Match system" (#464): the whole list each system keeps, where a web
// view tells its page only the first.
describe("on Linux", () => {
	test("a locale's name is its language tag", () => {
		expect(posixTag("es_CO.UTF-8")).toBe("es-CO");
		expect(posixTag("de_DE@euro")).toBe("de-DE");
		expect(posixTag("pt_BR.utf8@latin")).toBe("pt-BR");
		expect(posixTag("fr")).toBe("fr");
		for (const none of ["C", "C.UTF-8", "POSIX", ""]) expect(posixTag(none)).toBeNull();
	});

	test("LANGUAGE's list comes first, then the locale", () => {
		expect(linuxLanguages({ LANGUAGE: "es_CO:es:en", LANG: "es_CO.UTF-8" })).toEqual(["es-CO", "es", "en"]);
		expect(linuxLanguages({ LANGUAGE: "fr", LANG: "de_DE.UTF-8" })).toEqual(["fr", "de-DE"]);
	});

	test("the locale is LC_ALL's, else LC_MESSAGES', else LANG's", () => {
		expect(linuxLanguages({ LC_ALL: "it_IT.UTF-8", LC_MESSAGES: "fr_FR", LANG: "de_DE" })).toEqual(["it-IT"]);
		expect(linuxLanguages({ LC_MESSAGES: "fr_FR", LANG: "de_DE" })).toEqual(["fr-FR"]);
		expect(linuxLanguages({ LANG: "de_DE" })).toEqual(["de-DE"]);
	});

	// gettext's own rule: a C locale means English, whatever LANGUAGE says.
	test("in the C locale, or with none, there are none", () => {
		expect(linuxLanguages({ LANGUAGE: "es:en", LANG: "C.UTF-8" })).toEqual([]);
		expect(linuxLanguages({ LANGUAGE: "es:en" })).toEqual([]);
		expect(linuxLanguages({})).toEqual([]);
	});
});

describe("on Windows", () => {
	test("the user's language list, as reg query prints it", () => {
		const printed = [
			"",
			"HKEY_CURRENT_USER\\Control Panel\\International\\User Profile",
			"    Languages    REG_MULTI_SZ    es-CO\\0en-US\\0fr-FR",
			"",
		].join("\r\n");
		expect(windowsLanguages(printed)).toEqual(["es-CO", "en-US", "fr-FR"]);
	});

	test("nothing for a value that isn't there", () => {
		expect(windowsLanguages("ERROR: The system was unable to find the specified registry key or value.")).toEqual([]);
		expect(windowsLanguages("")).toEqual([]);
	});
});

describe.skipIf(process.platform !== "darwin")("on macOS", () => {
	test("the system's list, each a tag Intl takes", async () => {
		const languages = await systemLanguages("darwin");
		expect(languages.length).toBeGreaterThan(0);
		for (const tag of languages) expect(Intl.getCanonicalLocales(tag)).toHaveLength(1);
	});
});

test("a system it can't read has none", async () => {
	expect(await systemLanguages("aix")).toEqual([]);
});
