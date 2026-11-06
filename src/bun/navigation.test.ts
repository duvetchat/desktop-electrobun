import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { navigationRules } from "./navigation";

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
		expect(main).toContain("win.webview.setNavigationRules(navigationRules(");
		expect(main).not.toContain("navigationRules:");
	});
});
