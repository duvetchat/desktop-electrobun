import { expect, mock, test } from "bun:test";

// "Match system" with the system's languages as Bun says them (#464, lib/i18n.ts: setSystemLanguages). A released
// build ships English alone (SHIPPED), where every list comes to English: here a second language ships, so the list
// can be seen to pick one.
const real = { ...(await import("$lib/i18n/locale")) };
const shipped = ["en", "es"] as const;
mock.module("$lib/i18n/locale", () => ({
	...real,
	SHIPPED: shipped,
	resolveLocale: (pref: string, preferred: readonly string[]) =>
		pref === "system" ? real.matchLocale(preferred, shipped) : pref,
}));
const i18n = await import("$lib/i18n");

test("Match system takes the first shipped language of Bun's list, and the web view's again without one", async () => {
	await i18n.setLocalePref("system");
	await i18n.setSystemLanguages(["nl-NL", "es-CO"]);
	expect(i18n.currentLocale()).toBe("es");
	expect(i18n.systemLanguageName()).toBe("Español");
	await i18n.setSystemLanguages([]);
	expect(i18n.currentLocale()).toBe("en");
});
