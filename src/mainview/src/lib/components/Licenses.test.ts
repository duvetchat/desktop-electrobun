// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "./server-render";
import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import type { Licenses as LicensesFile } from "$lib/licenses";
import en from "../../../messages/en.json";
const { default: Licenses } = await import("./Licenses.svelte");

// The Licenses page (#628): what the app ships, by where it ships, each notice folded under its name, version and
// licence; the encryption core's notices, or a word that the build has none.
const LICENSES: LicensesFile = {
	page: [{ name: "svelte", version: "5.55.0", license: "MIT", text: "Copyright (c) 2016-2025 Svelte Contributors" }],
	bun: [{ name: "i18next", version: "27.2.6", license: "MIT", text: "Copyright (c) 2025 i18next" }],
	runtime: [
		{
			name: "Chromium Embedded Framework",
			version: "145.0.23",
			license: "BSD-3-Clause",
			text: "Marshall A. Greenblatt",
			platforms: ["linux"],
		},
	],
	assets: [{ name: "Inter", license: "OFL-1.1", text: "SIL Open Font License" }],
	core: { commit: "b7fc99e2254d28ff240bab1b293518f357b2f9b9", text: "SQLCipher\nOpenSSL\nOpenMLS" },
};

/** What it draws, without the comments Svelte marks its blocks with. */
const drawn = (licenses?: LicensesFile) =>
	render(Licenses, { props: licenses ? { licenses } : {} }).body.replace(/<!--[^]*?-->/g, "");

describe("the Licenses page", () => {
	test("lists what ships by where it ships, each under its name, version and licence", () => {
		const html = drawn(LICENSES);
		for (const title of [
			en.settings_licenses_page,
			en.settings_licenses_bun,
			en.settings_licenses_runtime,
			en.settings_licenses_assets,
			en.settings_licenses_core,
		]) {
			expect(html).toContain(title);
		}
		expect(html).toContain("svelte");
		expect(html).toContain("5.55.0");
		expect(html).toContain("BSD-3-Clause");
		expect(html).toContain(">Linux<");
		expect(html).toContain("duvetchat/e2e");
		expect(html).toContain("b7fc99e<");
	});

	test("keeps each notice folded until it's opened", () => {
		const html = drawn(LICENSES);
		expect(html).toContain('aria-expanded="false"');
		expect(html).not.toContain("Svelte Contributors");
		expect(html).not.toContain("OpenMLS");
	});

	test("says so when the build carries none of the encryption core's notices", () => {
		const html = drawn({ ...LICENSES, core: null });
		expect(html).toContain(en.settings_licenses_core_missing);
		expect(html).toContain('role="status"');
		expect(html).not.toContain("duvetchat/e2e");
	});

	test("draws its rows' places while the notices are on their way", () => {
		const html = drawn();
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain(`aria-label="${en.settings_licenses_loading}"`);
		expect(html).not.toContain(en.settings_licenses_page);
	});
});
