import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../../electrobun.config";
import { pageCopyRules, SECOND_WINDOW_PAGES } from "../mainview/src/lib/app-windows";

// Electrobun puts in the app only what the config's `copy` names. A page without a rule still loads in the dev build
// and answers 404 in the packaged app: the platform spike found it with a second window's page (#357,
// docs/redesign/PLATFORM.md §3). Every page the UI prerenders has a rule, the other windows' pages included.
const routes = join(import.meta.dir, "../mainview/src/routes");
const copy: Record<string, string> = config.build.copy;
// Pages only the web serves, which the app never opens: duvet.chat/download (#456). They have no rule.
const WEB_ONLY = ["download"];

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
				"download",
				"forgot-password",
				"index",
				"invite",
				"licenses",
				"reset-password",
				"sign-in",
				"sign-up",
				"verify",
				...Object.values(SECOND_WINDOW_PAGES),
			].sort((a, b) => a.localeCompare(b)),
		);
	});

	test("every prerendered page has its copy rule, but the web's own", () => {
		const missing = pages().filter(
			(page) => !WEB_ONLY.includes(page) && copy[`src/mainview/build/${page}.html`] !== `views/mainview/${page}.html`,
		);
		expect(missing).toEqual([]);
		expect(WEB_ONLY.filter((page) => `src/mainview/build/${page}.html` in copy)).toEqual([]);
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

	// #628: the Licenses page's notices, which the page's build writes beside the pages, and the page fetches from there.
	test("the Licenses page's notices go with the pages", () => {
		expect(copy["src/mainview/build/licenses.json"]).toBe("views/mainview/licenses.json");
	});

	test("no rule copies a page the UI doesn't build", () => {
		const built = new Set(pages().map((page) => `src/mainview/build/${page}.html`));
		expect(Object.keys(copy).filter((from) => from.endsWith(".html") && !built.has(from))).toEqual([]);
	});
});

// #626: Android's update notice (the 426's «Update Duvet») opens duvet.chat/download, and the cutover's step 8 puts each
// version's APK at one name in duvetchat/releases' android-stable, as the desktop's release does Windows' installer in
// desktop-stable: the page links both there.
test("the download page offers Windows' installer and Android's APK, each at its rolling release's one name", () => {
	const page = readFileSync(join(routes, "download", "+page.svelte"), "utf8");
	const releases = "https://github.com/duvetchat/releases/releases/download/";
	expect(page).toContain(`"${releases}desktop-stable/stable-win-x64-Duvet-Setup.zip"`);
	expect(page).toContain(`"${releases}android-stable/stable-android-arm64-Duvet.apk"`);
	expect(page).toContain('t("public_download_android")');
});
