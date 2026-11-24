import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { LOCALE_KEY, LOCALES, PSEUDO, SHIPPED, type Locale } from "./i18n/locale";
import { pseudoMessage } from "./i18n/pseudo";

// The app's words (#464): src/mainview/messages/<locale>.json, ICU MessageFormat, English the source. What each
// language's file must be for the app (and the mobile app, which copies them) to show it right, and how the app switches
// between them.
const MESSAGES = join(import.meta.dir, "..", "..", "messages");
const read = (name: string): Record<string, string> => JSON.parse(readFileSync(join(MESSAGES, name), "utf8"));
const en = read("en.json");
const files = new Map(LOCALES.map((locale) => [locale, read(`${locale}.json`)]));
const fileOf = (locale: Locale) => files.get(locale) ?? {};
const translations = LOCALES.filter((locale) => locale !== "en");
// The messages whose "server" is the API itself, not a Space (as lib/wording.test.ts's ABOUT_THE_API).
const ABOUT_THE_API = new Set<string>(["error_no_answer"]);

/** What a message's words are built around: its placeholders, tags, select cases and plural cases. */
interface Shape {
	args: Set<string>;
	tags: Set<string>;
	selects: Map<string, string[]>;
	plurals: Map<string, { ordinal: boolean; cases: string[] }>;
}

function shapeOf(message: string): Shape {
	const shape: Shape = { args: new Set(), tags: new Set(), selects: new Map(), plurals: new Map() };
	const walk = (elements: MessageFormatElement[]) => {
		for (const element of elements) {
			if (element.type === TYPE.tag) {
				shape.tags.add(element.value);
				walk(element.children);
			} else if (element.type === TYPE.select) {
				shape.args.add(element.value);
				shape.selects.set(element.value, Object.keys(element.options).sort());
				for (const option of Object.values(element.options)) walk(option.value);
			} else if (element.type === TYPE.plural) {
				shape.args.add(element.value);
				shape.plurals.set(element.value, {
					ordinal: element.pluralType === "ordinal",
					cases: Object.keys(element.options),
				});
				for (const option of Object.values(element.options)) walk(option.value);
			} else if (element.type !== TYPE.literal && element.type !== TYPE.pound) {
				shape.args.add(element.value);
			}
		}
	};
	walk(parse(message, { ignoreTag: false, requiresOtherClause: true }));
	return shape;
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe("the language files", () => {
	test("are the app's languages, and only those", () => {
		const names = readdirSync(MESSAGES).filter((name) => name.endsWith(".json") && name !== "descriptions.json");
		expect(names.map((name) => name.replace(/\.json$/, "")).sort()).toEqual([...LOCALES].sort());
	});

	test("hold no key English doesn't", () => {
		for (const locale of translations) {
			expect({ locale, extra: Object.keys(fileOf(locale)).filter((key) => !(key in en)) }).toEqual({
				locale,
				extra: [],
			});
		}
	});

	test("of a shipped language hold every key: Match system never shows it half translated", () => {
		for (const locale of SHIPPED) {
			const missing = Object.keys(en).filter((key) => !(key in fileOf(locale)));
			expect({ locale, missing }).toEqual({ locale, missing: [] });
		}
	});

	test("are each read as ICU MessageFormat, every plural and select with its other case", () => {
		for (const locale of LOCALES) {
			for (const [key, message] of Object.entries(fileOf(locale))) {
				expect(() => shapeOf(message), `${locale} ${key}`).not.toThrow();
			}
		}
	});

	test("keep English's placeholders, tags and select cases in every translation", () => {
		for (const locale of translations) {
			for (const [key, message] of Object.entries(fileOf(locale))) {
				const source = shapeOf(en[key]!);
				const translated = shapeOf(message);
				const where = `${locale} ${key}`;
				expect(sorted(translated.args), where).toEqual(sorted(source.args));
				expect(sorted(translated.tags), where).toEqual(sorted(source.tags));
				expect(Object.fromEntries(translated.selects), where).toEqual(Object.fromEntries(source.selects));
				expect(sorted(translated.plurals.keys()), where).toEqual(sorted(source.plurals.keys()));
			}
		}
	});

	test("give each plural the cases their language has, and other", () => {
		for (const locale of LOCALES) {
			for (const [key, message] of Object.entries(fileOf(locale))) {
				for (const [arg, plural] of shapeOf(message).plurals) {
					const type = plural.ordinal ? "ordinal" : "cardinal";
					const has = new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories;
					const unknown = plural.cases.filter((name) => !name.startsWith("=") && !has.some((rule) => rule === name));
					expect({ where: `${locale} ${key} ${arg}`, unknown }).toEqual({
						where: `${locale} ${key} ${arg}`,
						unknown: [],
					});
					expect(plural.cases, `${locale} ${key} ${arg}`).toContain("other");
				}
			}
		}
	});

	test("keep their keys in alphabetical order, so branches that add words merge cleanly (bun run messages:sort)", () => {
		for (const name of readdirSync(MESSAGES).filter((file) => file.endsWith(".json"))) {
			const keys = Object.keys(read(name));
			expect({ name, keys }).toEqual({ name, keys: [...keys].sort() });
		}
	});

	test("say Space and room, in every language: never server or channel (#57, messages/GLOSSARY.md)", () => {
		const forbidden: Record<Locale, RegExp> = {
			en: /\b(servers?|channels?)\b/i,
			es: /\b(servidor(es)?|canal(es)?)\b/i,
			fr: /\b(serveurs?|can(al|aux))\b/i,
			de: /\b(Server|Kan(al|äle))\b/i,
			"pt-BR": /\b(servidor(es)?|cana(l|is))\b/i,
			it: /\b(server|canal[ei])\b/i,
		};
		for (const locale of LOCALES) {
			const found = Object.entries(fileOf(locale)).filter(
				([key, message]) => !ABOUT_THE_API.has(key) && forbidden[locale].test(message),
			);
			expect({ locale, found }).toEqual({ locale, found: [] });
		}
	});

	test("have translator notes only for keys that exist", () => {
		const notes = read("descriptions.json");
		expect(Object.keys(notes).filter((key) => !(key in en))).toEqual([]);
	});

	test("hold no English key the app doesn't use", () => {
		const src = join(import.meta.dir, "..");
		const sources = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
				entry.isDirectory()
					? sources(join(dir, entry.name))
					: /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
						? [join(dir, entry.name)]
						: [],
			);
		const code = sources(src)
			.map((file) => readFileSync(file, "utf8"))
			.join("\n");
		expect(Object.keys(en).filter((key) => !code.includes(`"${key}"`))).toEqual([]);
	});

	test("make a pseudo-language with English's placeholders and tags, for every message", () => {
		for (const [key, message] of Object.entries(en)) {
			const pseudo = shapeOf(pseudoMessage(message));
			const source = shapeOf(message);
			expect(sorted(pseudo.args), key).toEqual(sorted(source.args));
			expect(sorted(pseudo.tags), key).toEqual(sorted(source.tags));
		}
	});
});

// A window to hear the other windows' picks on (Bun's tests have none), there before the app's language is read.
const window = new EventTarget();
Object.assign(globalThis, { window });
const i18n = await import("./i18n");

describe("the app's language", () => {
	const settle = async () => {
		for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
	};

	test("is English until a pick says otherwise", () => {
		expect(i18n.currentLocale()).toBe("en");
		expect(i18n.t("settings_language_title")).toBe("Language");
		expect(i18n.t("settings_language_system", { language: "Español" })).toBe("Match system (Español)");
	});

	test("switches to a picked language once its file is in, and saves the pick", async () => {
		await i18n.setLocalePref("es");
		expect(i18n.currentLocale()).toBe("es");
		expect(i18n.localePref()).toBe("es");
		expect(i18n.t("settings_language_title")).toBe("Idioma");
		expect(i18n.t("settings_language_system", { language: "English" })).toBe("Igual que el sistema (English)");
		expect(localStorage.getItem(LOCALE_KEY)).toBe("es");
	});

	test("draws the pseudo-language from English", async () => {
		await i18n.setLocalePref(PSEUDO);
		expect(i18n.t("settings_language_title")).toBe(pseudoMessage("Language"));
		expect(i18n.t("settings_language_system", { language: "X" })).toContain("(X)");
	});

	test("follows a pick made in another window", async () => {
		await i18n.setLocalePref("es");
		const stop = i18n.followLocale();
		// System picked in Settings' window, as the shared localStorage tells this one.
		window.dispatchEvent(Object.assign(new Event("storage"), { key: LOCALE_KEY, newValue: "system" }));
		await settle();
		stop();
		expect(i18n.localePref()).toBe("system");
		expect(i18n.currentLocale()).toBe("en");
		expect(i18n.t("settings_language_title")).toBe("Language");
	});

	test("hears no other key's changes", async () => {
		await i18n.setLocalePref("es");
		const stop = i18n.followLocale();
		window.dispatchEvent(Object.assign(new Event("storage"), { key: "duvet.theme.v1", newValue: "light" }));
		await settle();
		stop();
		expect(i18n.currentLocale()).toBe("es");
	});
});
