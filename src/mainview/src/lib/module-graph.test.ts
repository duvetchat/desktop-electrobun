import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pageCopyRules, SECOND_WINDOW_PAGES, secondWindowCopyRules, secondWindowUrl } from "$lib/app-windows";
import { importsOf, layoutsOf, reaches } from "$lib/module-graph";

const src = join(import.meta.dir, "..");
const CONNECTION = join(src, "lib/api/ws/connection.ts");
const pageOf = (route: string) => join(src, "routes", route, "+page.svelte");

// #357: only the main window opens the gateway's socket. A page of another window that reached
// lib/api/ws/connection.ts would open nothing by itself, but would load its top-level wiring, and be one call away
// from a second connection for the same session.
describe("the pages of the app's other windows", () => {
	const pages = Object.entries(SECOND_WINDOW_PAGES);

	test("each has its route", () => {
		expect(pages.filter(([, route]) => !existsSync(pageOf(route))).map(([window]) => window)).toEqual([]);
	});

	test("none reaches the gateway connection", () => {
		const reaching = pages
			.map(([window, route]) => ({ window, chain: reaches(pageOf(route), CONNECTION, src) }))
			.filter(({ chain }) => chain !== null)
			.map(({ window, chain }) => `${window}: ${chain!.join(" → ")}`);
		expect(reaching).toEqual([]);
	});

	test("each has an address in the app, and a window without a page has none", () => {
		for (const window of ["media", "settings", "space-settings"] as const) {
			const route = SECOND_WINDOW_PAGES[window];
			expect(secondWindowUrl(window)).toBe(route ? `views://mainview/${route}.html` : null);
		}
	});

	test("each gets the copy rule that puts its page in the packaged app", () => {
		expect(secondWindowCopyRules()).toEqual(pageCopyRules(pages.map(([, route]) => route)));
		expect(pageCopyRules(["voice-controls"])).toEqual({
			"src/mainview/build/voice-controls.html": "views/mainview/voice-controls.html",
		});
	});
});

describe("the guard itself", () => {
	// The app's own page is the one that should reach the connection: if the guard can't see that, it sees nothing.
	test("sees the connection where it is: the main window's page reaches it", () => {
		const chain = reaches(pageOf("app"), CONNECTION, src);
		expect(chain).not.toBeNull();
		expect(chain![0]).toBe("routes/app/+page.svelte");
		expect(chain!.at(-1)).toBe("lib/api/ws/connection.ts");
	});

	test("counts the layouts a page renders inside", () => {
		expect(layoutsOf(pageOf("(auth)/sign-in"), src).map((file) => file.slice(src.length + 1))).toEqual(
			expect.arrayContaining(["routes/+layout.svelte", "routes/+layout.ts"]),
		);
	});

	// A made-up source tree: a second window's page that reaches the connection in each way a source can, and one that
	// doesn't.
	const fake = mkdtempSync(join(tmpdir(), "duvet-module-graph-"));
	afterAll(() => rmSync(fake, { recursive: true, force: true }));
	const write = (path: string, text: string) => {
		mkdirSync(dirname(join(fake, path)), { recursive: true });
		writeFileSync(join(fake, path), text);
		return join(fake, path);
	};
	const connection = write("lib/api/ws/connection.ts", "export const connect = () => {};\n");
	write("lib/stores.svelte.ts", 'export { connect } from "$lib/api/ws/connection";\n');
	write("lib/quiet.ts", "// import { connect } from '$lib/api/ws/connection';\nexport const quiet = 1;\n");
	write("lib/lazy.ts", 'export const later = () => import("./api/ws/connection");\n');
	write("lib/components/Panel.svelte", '<script lang="ts">\n\timport "$lib/stores.svelte";\n</script>\n');
	write("routes/+layout.svelte", '<script lang="ts">\n\timport { quiet } from "$lib/quiet";\n</script>\n');

	test("finds a connection reached through a component and a re-export, and says how", () => {
		const page = write(
			"routes/direct/+page.svelte",
			'<script lang="ts">\n\timport Panel from "$lib/components/Panel.svelte";\n</script>\n<Panel />\n',
		);
		expect(reaches(page, connection, fake)).toEqual([
			"routes/direct/+page.svelte",
			"lib/components/Panel.svelte",
			"lib/stores.svelte.ts",
			"lib/api/ws/connection.ts",
		]);
	});

	test("finds one reached only by a dynamic import, through a relative path", () => {
		const page = write(
			"routes/lazy/+page.svelte",
			'<script lang="ts">\n\timport { later } from "$lib/lazy";\n</script>\n',
		);
		expect(reaches(page, connection, fake)).toEqual([
			"routes/lazy/+page.svelte",
			"lib/lazy.ts",
			"lib/api/ws/connection.ts",
		]);
	});

	test("finds one a layout above the page reaches", () => {
		write("routes/nested/+layout.svelte", '<script lang="ts">\n\timport "$lib/stores.svelte";\n</script>\n');
		const page = write("routes/nested/deep/+page.svelte", "<p>nothing of its own</p>\n");
		expect(reaches(page, connection, fake)?.[0]).toBe("routes/nested/+layout.svelte");
	});

	test("lets through a page that only mentions the connection in a comment, or imports a package", () => {
		const page = write(
			"routes/clean/+page.svelte",
			'<script lang="ts">\n\timport { quiet } from "$lib/quiet";\n\timport { Dialog } from "bits-ui";\n</script>\n<!-- import "$lib/api/ws/connection" -->\n',
		);
		expect(reaches(page, connection, fake)).toBeNull();
		expect(importsOf(page, fake).map((file) => file.slice(fake.length + 1))).toEqual(["lib/quiet.ts"]);
	});
});
