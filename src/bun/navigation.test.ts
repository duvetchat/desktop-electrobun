import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAppPage, isOwnPage, navigatedTo, navigationRules } from "./navigation";

// Electrobun's check, as its native side has it on every platform (shouldAllowNavigationToURL over shared/glob_match.h):
// any case, "*" matches anything, the last rule that matches decides, and a URL none matches goes through.
function allowed(rules: string[], url: string): boolean {
	let allow = true;
	for (const rule of rules) {
		const block = rule.startsWith("^");
		const pattern = (block ? rule.slice(1) : rule).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
		if (new RegExp(`^${pattern.join(".*")}$`, "is").test(url)) allow = !block;
	}
	return allow;
}

const DEV = "http://localhost:5173";
const platforms = ["win32", "darwin", "linux"] as const;

const ownPages = [
	"views://mainview/index.html",
	"views://mainview/app.html",
	"views://mainview/sign-in.html",
	"views://mainview/sign-in.html?redirect=%2Finvite.html%3Fcode%3Dabc",
];

const refused = [
	"https://example.com/",
	"http://example.com/",
	// What Duvet's clients only fetch, or leave to the browser, isn't a page of the window.
	"https://duvet.chat/",
	"https://api.duvet.chat/attachments/1",
	"https://bucket.r2.cloudflarestorage.com/file",
	// A "*" in a host would match these, as it crosses a "/" and takes a user name.
	"https://example.com/.duvet.chat/",
	"https://example.com/?x=.youtube.com/",
	"http://localhost:x@example.com/",
	"http://127.0.0.1:x@example.com/",
	// Schemes no rule would name.
	"file:///C:/Windows/win.ini",
	"data:text/html,hi",
	"blob:views://mainview/8f6c1f40-6c9d-4f7e-9a3e-0d1c7b2a5e11",
	"ftp://example.com/",
	"ms-msdt:/id",
];

describe("navigationRules", () => {
	for (const platform of platforms) {
		test(`${platform} loads the app's pages and refuses the rest`, () => {
			const rules = navigationRules(platform, null);
			for (const url of ownPages) expect([url, allowed(rules, url)]).toEqual([url, true]);
			for (const url of refused) expect([url, allowed(rules, url)]).toEqual([url, false]);
		});

		test(`${platform} loads the dev server's pages only while the window is on it`, () => {
			const rules = navigationRules(platform, DEV);
			for (const url of [`${DEV}/`, `${DEV}/app`, `${DEV}/sign-in?redirect=%2Finvite%3Fcode%3Dabc`]) {
				expect([url, allowed(rules, url)]).toEqual([url, true]);
			}
			for (const url of [...refused, "http://localhost:9876/", `${DEV}@example.com/`, "http://127.0.0.1:5173/"]) {
				expect([url, allowed(rules, url)]).toEqual([url, false]);
			}
			expect(allowed(navigationRules(platform, null), `${DEV}/`)).toBe(false);
		});
	}

	const players = [
		"https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1",
		"https://www.tiktok.com/player/v1/6718335390845095173?music_info=0&description=0&rel=0&autoplay=1",
	];

	for (const platform of ["darwin", "linux"] as const) {
		test(`${platform}, which checks frames too, lets the players' frames load, and nothing else of their sites`, () => {
			const rules = navigationRules(platform, null);
			for (const url of [...players, "about:blank", "about:srcdoc", "devtools://devtools/bundled/devtools_app.html"]) {
				expect([url, allowed(rules, url)]).toEqual([url, true]);
			}
			for (const url of [
				"https://www.youtube.com/watch?v=aqz-KE-bpKQ",
				"https://www.tiktok.com/@someone",
				"https://www.youtube.com.example.com/embed/x",
				"https://www.youtube.com@example.com/embed/x",
				"https://example.com/https://www.youtube.com/embed/x",
			]) {
				expect([url, allowed(rules, url)]).toEqual([url, false]);
			}
		});
	}

	test("win32, whose check only sees the top frame, has no page of the players' sites to load", () => {
		const rules = navigationRules("win32", null);
		for (const url of [...players, "about:blank"]) expect([url, allowed(rules, url)]).toEqual([url, false]);
	});
});

describe("the main window", () => {
	// BrowserWindow stores its navigationRules option and never hands it to the native side, so they'd never apply.
	const main = readFileSync(join(import.meta.dir, "index.ts"), "utf8");

	test("gets its rules through its webview", () => {
		expect(main).toContain("win.webview.setNavigationRules(rules)");
		expect(main).not.toContain("navigationRules:");
	});

	// macOS reads them later, from an address nothing keeps: right after new BrowserWindow, a GC could leave no rules.
	test("gets them once a page has loaded, not as it's created", () => {
		expect(main).toContain('win.webview.on("dom-ready", () => win.webview.setNavigationRules(rules));');
		expect(main.match(/setNavigationRules\(/g)).toHaveLength(1);
	});
});

describe("navigatedTo", () => {
	test("is the address Electrobun's event carries", () => {
		expect(navigatedTo({ data: { detail: "views://mainview/app.html" } })).toBe("views://mainview/app.html");
	});

	test("is null for an event that names none", () => {
		for (const event of [undefined, null, "views://mainview/app.html", {}, { data: null }, { data: {} }]) {
			expect(navigatedTo(event)).toBeNull();
		}
		expect(navigatedTo({ data: { detail: { url: "views://mainview/app.html" } } })).toBeNull();
	});
});

describe("isAppPage", () => {
	test("is the app's page, packaged or under the dev server, and no other", () => {
		expect(
			["views://mainview/app.html", "http://localhost:5173/app", "http://localhost:5173/app/"].map(isAppPage),
		).toEqual([true, true, true]);
		for (const url of [
			"views://mainview/sign-in.html",
			"views://mainview/settings.html",
			"views://mainview/voice-controls.html",
			"http://localhost:5173/sign-in",
			"http://localhost:5173/apps",
			"not a url",
			"",
		]) {
			expect(isAppPage(url)).toBe(false);
		}
	});
});

describe("isOwnPage", () => {
	test("is the app's views, and the dev server's pages while it serves them", () => {
		expect(isOwnPage("views://mainview/app.html", null)).toBe(true);
		expect(isOwnPage("views://mainview/sign-in.html", null)).toBe(true);
		expect(isOwnPage("http://localhost:5173/sign-in", "http://localhost:5173")).toBe(true);
		expect(isOwnPage("http://localhost:5173/sign-in", null)).toBe(false);
	});

	// A player's frame navigating is not the app's page leaving: no window closes for it.
	test("is no frame's page, nor anything that only looks like the dev server", () => {
		for (const url of [
			"https://www.youtube.com/embed/abc",
			"about:blank",
			"http://localhost:5173.example.com/sign-in",
			"http://localhost:51730/sign-in",
			"not a url",
		]) {
			expect(isOwnPage(url, "http://localhost:5173")).toBe(false);
		}
	});
});
