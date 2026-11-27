import { expect, test } from "bun:test";
import { render } from "svelte/server";
import { tags } from "../server-render";
import { LOCALES, type LocalePref, type UiLocale } from "$lib/i18n/locale";

// Appearance's Language picker (#565), closed, as the server renders it. The list it opens, and its keys, are bits-ui's
// Select, checked in the app.
const { default: LanguageSelect } = await import("./LanguageSelect.svelte");

type Props = {
	id: string;
	value: LocalePref;
	offered: readonly UiLocale[];
	systemLabel: string;
	onValueChange: (value: string) => void;
};
const props = (overrides: Partial<Props> = {}): Props => ({
	id: "app-language",
	value: "system",
	offered: LOCALES,
	systemLabel: "Match system (English)",
	onValueChange() {},
	...overrides,
});
const html = (overrides: Partial<Props> = {}) =>
	render(LanguageSelect, { props: props(overrides) }).body.replace(/<!--[^>]*-->/g, "");

test("is a combobox the row's label names, opening a listbox", async () => {
	const trigger = (await tags(LanguageSelect, props())).find((tag) => tag.attributes.id === "app-language");
	expect(trigger?.name).toBe("button");
	expect(trigger?.attributes.role).toBe("combobox");
	expect(trigger?.attributes["aria-haspopup"]).toBe("listbox");
	expect(trigger?.attributes["aria-expanded"]).toBe("false");
});

test("shows the language chosen by its flag, in Twemoji and hidden from a screen reader, and its name in itself", () => {
	const body = html({ value: "es" });
	expect(body).toMatch(
		/<span[^>]*aria-hidden="true"[^>]*><span class="font-emoji[^"]*"[^>]*data-flag="MX"[^>]*>🇲🇽<\/span><\/span>/,
	);
	expect(body).toMatch(/<span[^>]*lang="es"[^>]*>Español<\/span>/);
});

test("shows Match system by the system's icon, not a flag", () => {
	const body = html();
	expect(body).toContain("Match system (English)");
	expect(body).toContain("lucide-monitor");
	expect(body).not.toContain("data-flag");
});

test("shows a language with no flag, the pseudo-language, by the language icon", () => {
	const body = html({ value: "en-XA", offered: [...LOCALES, "en-XA"] });
	expect(body).toContain("lucide-languages");
	expect(body).not.toContain("data-flag");
});

test("shows Match system for a pick this build doesn't offer", () => {
	expect(html({ value: "en-XA" })).toContain("Match system (English)");
});
