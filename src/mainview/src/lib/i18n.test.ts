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

/** What a message's words are built around: its placeholders, tags, select cases and plural cases, and the placeholders
 * written as numbers ({count, number}), which the locale groups where a plain {count} isn't. */
interface Shape {
	args: Set<string>;
	tags: Set<string>;
	selects: Map<string, string[]>;
	plurals: Map<string, { ordinal: boolean; cases: string[] }>;
	numbers: Set<string>;
	/** The plain placeholders ({count}), written as they're passed. */
	plain: Set<string>;
}

function shapeOf(message: string): Shape {
	const shape: Shape = {
		args: new Set(),
		tags: new Set(),
		selects: new Map(),
		plurals: new Map(),
		numbers: new Set(),
		plain: new Set(),
	};
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
				if (element.type === TYPE.number) shape.numbers.add(element.value);
				if (element.type === TYPE.argument) shape.plain.add(element.value);
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
				expect(sorted(translated.numbers), where).toEqual(sorted(source.numbers));
			}
		}
	});

	// A plain {count} is written as it's passed, ungrouped in every language (messages/README.md): a count goes in
	// {count, number} or a plural. These are the names counts go by; a message whose value of that name is a string
	// already written by $lib/i18n/format is listed with it.
	test("write a count as a number or in a plural, never in a plain placeholder", () => {
		const COUNTS = ["count", "total", "done", "shown", "current", "min", "max", "ping", "seconds", "percent"];
		const FORMATTED: Record<string, string[]> = {
			chat_command_option_min: ["min"], // formatNumber (lib/commands.ts)
			chat_command_option_max: ["max"],
			settings_bucket_usage: ["max"], // megabytes()
			settings_storage_used: ["percent"], // formatNumber, as a percent
			storage_transfer_bytes: ["total"], // formatFileSize
			storage_transfer_bytes_started_by: ["total"],
		};
		const plain = Object.entries(en).flatMap(([key, message]) =>
			[...shapeOf(message).plain]
				.filter((arg) => COUNTS.includes(arg) && !FORMATTED[key]?.includes(arg))
				.map((arg) => `${key} {${arg}}`),
		);
		expect(plain).toEqual([]);
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
			fi: /\b(palvelin(ta|ten|in|ista|issa|ille|illa|ilta)?|palvelim(en|et|ia|ien|iin|issa|ista|ille|illa|ilta)?|kanav(a|an|aa|at|ien|ia|issa|ista|aan|alle|alla|alta))\b/i,
			"en-GB": /\b(servers?|channels?)\b/i,
			"es-ES": /\b(servidor(es)?|canal(es)?)\b/i,
			// \b only knows ASCII letters: these mark a word's start as not right after another letter.
			ru: /(?<!\p{L})(сервер|канал)/iu,
			uk: /(?<!\p{L})(сервер|канал)/iu,
			// No spaces between words: the word alone.
			"zh-CN": /服务器|频道/,
			"zh-TW": /伺服器|服務器|頻道/,
			ja: /サーバ|チャンネル|チャネル/,
			ko: /서버|채널/,
			th: /เซิร์ฟเวอร์|แชนแนล|แชนเนล/,
			vi: /(?<!\p{L})(máy chủ|kênh)(?!\p{L})/iu,
		};
		for (const locale of LOCALES) {
			const found = Object.entries(fileOf(locale)).filter(
				([key, message]) => !ABOUT_THE_API.has(key) && forbidden[locale].test(message),
			);
			expect({ locale, found }).toEqual({ locale, found: [] });
		}
	});

	// A machine translation's leftovers: a zero-width space or a byte-order mark is a break where no word ends, unseen.
	test("hold no zero-width spaces or byte-order marks", () => {
		for (const locale of LOCALES) {
			const found = Object.keys(fileOf(locale)).filter((key) => /[​﻿]/.test(fileOf(locale)[key]!));
			expect({ locale, found }).toEqual({ locale, found: [] });
		}
	});

	test("have translator notes only for keys that exist", () => {
		const notes = read("descriptions.json");
		expect(Object.keys(notes).filter((key) => !(key in en))).toEqual([]);
	});

	// The page's sources, and the Bun process's and its build scripts', whose menu_, window_ and os_ words are here too.
	test("hold no English key the app doesn't use", () => {
		const root = join(import.meta.dir, "..", "..", "..", "..");
		const sources = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
				entry.isDirectory()
					? sources(join(dir, entry.name))
					: /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
						? [join(dir, entry.name)]
						: [],
			);
		const code = [join(root, "src", "mainview", "src"), join(root, "src", "bun"), join(root, "scripts")]
			.flatMap(sources)
			.map((file) => readFileSync(file, "utf8"))
			.join("\n");
		expect(Object.keys(en).filter((key) => !code.includes(`"${key}"`))).toEqual([]);
	});

	// #562: a message noted [short] sits in a fixed width (a button, a tab, a menu item, a column), and a translation
	// much longer than its English may not fit there. Each one over 1.4× is listed here until it's looked at in the app,
	// in its narrowest place, and kept in lib/i18n/long-labels.json with the words that were seen to fit: a change to
	// them is looked at again. The file began with every one there was when the check came in.
	describe("a [short] message", () => {
		const RATIO = 1.4;
		// Below four letters a ratio says little: OK is Aceptar, All is Kaikki.
		const FLOOR = 4;
		// What a placeholder or a plural's number takes in the words shown, about.
		const PLACEHOLDER = 3;
		const notes = read("descriptions.json");
		const kept: Record<string, string> = JSON.parse(
			readFileSync(join(import.meta.dir, "i18n", "long-labels.json"), "utf8"),
		);

		/** How many characters a message shows: its words, a few for each placeholder, its longest plural or select
		 *  case. */
		const shownLength = (message: string): number => {
			const walk = (elements: MessageFormatElement[]): number =>
				elements.reduce((length, element) => {
					if (element.type === TYPE.literal) return length + [...element.value].length;
					if (element.type === TYPE.tag) return length + walk(element.children);
					if (element.type === TYPE.select || element.type === TYPE.plural)
						return length + Math.max(...Object.values(element.options).map((option) => walk(option.value)));
					return length + PLACEHOLDER;
				}, 0);
			return walk(parse(message, { ignoreTag: false }));
		};

		/** Every translation of a [short] message over 1.4× its English, as long-labels.json keeps it. */
		const long = new Map<string, string>();
		for (const locale of translations) {
			for (const [key, message] of Object.entries(fileOf(locale))) {
				if (!notes[key]?.startsWith("[short]")) continue;
				const english = shownLength(en[key]!);
				if (english >= FLOOR && shownLength(message) > RATIO * english) long.set(`${locale} ${key}`, message);
			}
		}

		test("isn't over 1.4× its English unless it was seen to fit (lib/i18n/long-labels.json)", () => {
			const unchecked = [...long]
				.filter(([id, message]) => kept[id] !== message)
				.map(([id, message]) => ({
					[id]: message,
				}));
			expect(unchecked).toEqual([]);
		});

		test("seen to fit is still over 1.4× its English, in the same words", () => {
			expect(Object.keys(kept).filter((id) => long.get(id) !== kept[id])).toEqual([]);
		});

		test("seen to fit is kept in alphabetical order", () => {
			const ids = Object.keys(kept);
			expect(ids).toEqual([...ids].sort());
		});
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

	// #464: the desktop app's Bun reads the system's whole list (src/bun/system-languages.ts), where WKWebView's
	// navigator.languages has the first only. The tests' web view has none: the dates' locale is the app's language.
	test("goes by the system's languages Bun says, over the web view's", async () => {
		await i18n.setLocalePref("system");
		expect(i18n.regionalLocale()).toBe("en");
		await i18n.setSystemLanguages(["es-CO", "en-GB"]);
		expect(i18n.regionalLocale()).toBe("es-CO");
		expect(i18n.systemLanguageName()).toBe("Español");
		expect(i18n.currentLocale()).toBe("es");
	});

	test("takes only the tags Intl takes from Bun's list, and a list with none leaves the web view's", async () => {
		await i18n.setSystemLanguages(["not a tag!", "", 7, "EN-au"]);
		expect(i18n.regionalLocale()).toBe("en-AU");
		await i18n.setSystemLanguages(["???"]);
		expect(i18n.regionalLocale()).toBe("en");
		await i18n.setSystemLanguages([]);
		expect(i18n.regionalLocale()).toBe("en");
	});

	// messages/README.md: a plain placeholder writes a number as it is; {n, number} and a plural's # group it.
	test("writes a number in a plain placeholder as it is, and in {n, number} or a plural the locale's way", async () => {
		await i18n.setLocalePref("en");
		expect(i18n.t("settings_language_system", { language: 1234567 })).toBe("Match system (1234567)");
		expect(i18n.t("shell_quiet_spaces", { count: 1234567 })).toBe("Quiet · 1,234,567");
		expect(i18n.t("shell_in_voice", { count: 1234567 })).toBe("1,234,567 in voice");
	});

	// A message's numbers are written in the locale formatNumber and formatFileSize write theirs in (regionalLocale): an
	// English app on a system in English (Germany) writes "Move 1.234 files (12,50 MB)", not "1,234 files (12,50 MB)".
	test("writes a message's numbers in the system's region when it's in the app's language, with or without tags", async () => {
		await i18n.setLocalePref("en");
		const voice = () => i18n.t("shell_in_voice", { count: 1234567 });
		const heading = () => i18n.richParts("people_friends_group_heading", { group: "Online", count: 1234567 });
		expect(voice()).toBe("1,234,567 in voice");
		expect(heading()).toEqual(["Online ", { tag: "num", text: "1,234,567" }]);
		await i18n.setSystemLanguages(["en-DE"]);
		expect(voice()).toBe("1.234.567 in voice");
		expect(heading()).toEqual(["Online ", { tag: "num", text: "1.234.567" }]);
		await i18n.setSystemLanguages(["en-IN"]);
		expect(voice()).toBe("12,34,567 in voice");
		// A system in another language: the app's own.
		await i18n.setSystemLanguages(["de-DE"]);
		expect(voice()).toBe("1,234,567 in voice");
		expect(heading()).toEqual(["Online ", { tag: "num", text: "1,234,567" }]);
		await i18n.setSystemLanguages([]);
		expect(voice()).toBe("1,234,567 in voice");
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
