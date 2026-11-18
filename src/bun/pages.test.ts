import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import config from "../../electrobun.config";
import { pageCopyRules, SECOND_WINDOW_PAGES } from "../mainview/src/lib/app-windows";

// Electrobun puts in the app only what the config's `copy` names. A page without a rule still loads in the dev build
// and answers 404 in the packaged app: the platform spike found it with a second window's page (#357,
// docs/redesign/PLATFORM.md §3). Every page the UI prerenders has a rule, the other windows' pages included.
const routes = join(import.meta.dir, "../mainview/src/routes");
const copy: Record<string, string> = config.build.copy;

/** The pages SvelteKit prerenders, as their file's name in the build: a route's folders, without its (groups). */
function pages(dir = routes, route: string[] = []): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) {
			return pages(join(dir, entry.name), /^\(.*\)$/.test(entry.name) ? route : [...route, entry.name]);
		}
		return entry.name === "+page.svelte" ? [route.length ? route.join("/") : "index"] : [];
	});
}

describe("the pages the packaged app has", () => {
	test("the routes are the ones this test knows", () => {
		expect(pages().sort((a, b) => a.localeCompare(b))).toEqual(
			[
				"app",
				"change-email",
				"forgot-password",
				"index",
				"invite",
				"reset-password",
				"sign-in",
				"sign-up",
				"verify",
				...Object.values(SECOND_WINDOW_PAGES),
			].sort((a, b) => a.localeCompare(b)),
		);
	});

	test("every prerendered page has its copy rule", () => {
		const missing = pages().filter((page) => copy[`src/mainview/build/${page}.html`] !== `views/mainview/${page}.html`);
		expect(missing).toEqual([]);
	});

	test("each of the other windows' pages has its copy rule", () => {
		for (const [from, to] of Object.entries(pageCopyRules(Object.values(SECOND_WINDOW_PAGES)))) {
			expect(copy[from]).toBe(to);
		}
	});

	// Adding a window's page to the list is all its rule takes.
	test("a page added to the list gets its rule", () => {
		expect(pageCopyRules(["voice-controls", "settings"])).toEqual({
			"src/mainview/build/voice-controls.html": "views/mainview/voice-controls.html",
			"src/mainview/build/settings.html": "views/mainview/settings.html",
		});
	});

	test("no rule copies a page the UI doesn't build", () => {
		const built = new Set(pages().map((page) => `src/mainview/build/${page}.html`));
		expect(Object.keys(copy).filter((from) => from.endsWith(".html") && !built.has(from))).toEqual([]);
	});
});
