import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nativeNotice, newDeviceNotice, type Notice } from "./confirm";
import { NOTICE_SIZE, noticeWindow, type NoticeWindow, type NoticeWindowOptions } from "./notice-window";

// The notice that asks nothing on Linux and macOS (PLAN-E2E-PLATAFORMAS.md, Task 6; its Ruling 3): a window of Bun's own,
// where Windows shows its system's box. A test's windows stand in for Electrobun's BrowserWindow, which only a desktop
// session draws: each records what it's asked, and what the person or the page would do to it.

/** The windows a notice made, each with what it was asked since. */
function windows() {
	const made: {
		options: NoticeWindowOptions;
		titles: string[];
		scripts: string[];
		rules: string[][];
		closed: boolean;
		/** Its page is in (Electrobun's dom-ready). */
		loaded(): void;
		/** The person closes it (its title bar's ×). */
		closedByPerson(): void;
	}[] = [];
	const make = (options: NoticeWindowOptions): NoticeWindow => {
		const on: { ready?: () => void; close?: () => void } = {};
		const record = {
			options,
			titles: [] as string[],
			scripts: [] as string[],
			rules: [] as string[][],
			closed: false,
			loaded: () => on.ready?.(),
			closedByPerson: () => {
				record.closed = true;
				on.close?.();
			},
		};
		made.push(record);
		return {
			setTitle: (title) => void record.titles.push(title),
			close: () => record.closedByPerson(),
			on: (event, run) => void (event === "close" && (on.close = run)),
			webview: {
				on: (event, run) => void (event === "dom-ready" && (on.ready = run)),
				setNavigationRules: (rules) => void record.rules.push(rules),
				executeJavascript: (js) => void record.scripts.push(js),
			},
		};
	};
	return { made, make };
}

const MAIN = { x: 100, y: 50, width: 1200, height: 800 };
const DATA = "data:text/html;charset=utf-8,";
/** The page a window was made with, as its data URL holds it. */
const pageOf = ({ url }: NoticeWindowOptions) => decodeURIComponent(url.slice(DATA.length));
/** What a notice's window runs to show another notice in place of its own. */
const written = ({ title, message }: Notice) =>
	`document.title = ${JSON.stringify(title)}; document.body.textContent = ${JSON.stringify(message)};`;

const first = newDeviceNotice({ code: "0000 1111 2222 3333", scan: "4444 5555 6666 7777" });
const second = newDeviceNotice({ code: "0000 1111 2222 3333", scan: "8888 9999 aaaa bbbb" });
const third = newDeviceNotice({ code: "cccc dddd eeee ffff", scan: "1111 2222 3333 4444" });

describe("a notice's window", () => {
	// Review Focus 5: nothing in the window reaches Bun, and nothing the notice says is read as its page's markup.
	test("a notice opens a sandboxed window with its text escaped", () => {
		const { made, make } = windows();
		const notice: Notice = {
			title: `Set up <b>this</b> & "that"`,
			message: `A <script>alert(1)</script>\nB & 'C' <img src=x onerror=alert(2)>`,
		};
		noticeWindow(make, () => MAIN)(notice);
		expect(made).toHaveLength(1);
		const [{ options }] = made;
		// No RPC of its own, and Electrobun's sandbox: no bun bridge, no internal bridge, no socket key.
		expect(options.sandbox).toBe(true);
		expect(Object.keys(options).sort()).toEqual(["frame", "sandbox", "title", "url"]);
		// Its page is the address it opens with, so its first page is its own (an empty one would be Wikipedia's on Linux).
		expect(options.url.startsWith(DATA)).toBe(true);
		const page = pageOf(options);
		// Markup in the notice is text: no tag of its own reaches the page.
		expect(page).not.toMatch(/<script|<img/i);
		expect(page).toContain("<title>Set up &#60;b&#62;this&#60;/b&#62; &#38; &#34;that&#34;</title>");
		expect(page).toContain(
			"<body>A &#60;script&#62;alert(1)&#60;/script&#62;\nB &#38; &#39;C&#39; &#60;img src=x onerror=alert(2)&#62;</body>",
		);
		// The window's own title is the system's text, which no page reads.
		expect(options.title).toBe(notice.title);
		// Over the middle of the main window.
		expect(options.frame).toEqual({
			x: MAIN.x + (MAIN.width - NOTICE_SIZE.width) / 2,
			y: MAIN.y + (MAIN.height - NOTICE_SIZE.height) / 2,
			...NOTICE_SIZE,
		});
		// Once its page is in, it goes nowhere else: no link, a dropped file or a script's page.
		expect(made[0]?.rules).toEqual([]);
		made[0]?.loaded();
		expect(made[0]?.rules).toEqual([["^*"]]);
		expect(made[0]?.scripts).toEqual([]);
	});

	test("a second notice replaces the first", () => {
		const { made, make } = windows();
		const show = nativeNotice({ platform: "linux", open: noticeWindow(make, () => MAIN) });
		show(first);
		made[0]?.loaded();
		show(second);
		expect(made).toHaveLength(1);
		expect(made[0]?.closed).toBe(false);
		expect(made[0]?.titles).toEqual([second.title]);
		// As text, never as markup: what Bun writes into the page is the notice's words.
		expect(made[0]?.scripts).toEqual([written(second)]);

		// One that comes while the page is still loading is written once the page is in, the newest of them.
		const early = windows();
		const again = nativeNotice({ platform: "darwin", open: noticeWindow(early.make, () => MAIN) });
		again(first);
		again(second);
		again(third);
		expect(early.made[0]?.scripts).toEqual([]);
		early.made[0]?.loaded();
		expect(early.made[0]?.scripts).toEqual([written(third)]);
		expect(early.made[0]?.titles).toEqual([second.title, third.title]);
	});

	test("closing takes it away", () => {
		const { made, make } = windows();
		const show = nativeNotice({ platform: "linux", open: noticeWindow(make, () => MAIN) });
		show(first);
		show(null);
		expect(made[0]?.closed).toBe(true);
		// One the person closed stays closed for the rest of its run: a renewal would make a window in front (RM5).
		show(first);
		made[1]?.closedByPerson();
		show(second);
		expect(made).toHaveLength(2);
		expect(made[1]?.scripts).toEqual([]);
		// The next run's notice opens a window again.
		show(null);
		show(third);
		expect(made).toHaveLength(3);
		expect(pageOf(made[2].options)).toContain("cccc dddd eeee ffff");
	});

	// RM5: Electrobun brings every window it makes to the front, with the keyboard (its showWindow), so a window is
	// made for the first notice of a run alone, and the QR's renewal every 9 minutes is written into it.
	test("only the first takes the foreground", () => {
		const { made, make } = windows();
		const show = nativeNotice({ platform: "linux", open: noticeWindow(make, () => MAIN) });
		show(first);
		made[0]?.loaded();
		show(second);
		show(third);
		expect(made).toHaveLength(1);
		show(null);
		show(first);
		expect(made).toHaveLength(2);
	});

	test("goes where the main window is, or where the system puts it without one", () => {
		const { made, make } = windows();
		noticeWindow(make, () => {
			throw new Error("Window no longer exists");
		})(first);
		expect(made[0]?.options.frame).toEqual({ x: 0, y: 0, ...NOTICE_SIZE });
	});

	// The app's wiring (index.ts): the window off Windows, and the notice goes with the main window, which would otherwise
	// keep the app running with the notice alone (Electrobun quits once its last window closes).
	test("is the app's notice off Windows, and goes with the main window", () => {
		const index = readFileSync(join(import.meta.dir, "../index.ts"), "utf8").replaceAll("\r\n", "\n");
		expect(index).toMatch(/open:\s*process\.platform === "win32"\s*\?\s*undefined\s*:\s*noticeWindow\(/);
		expect(index).toMatch(/win\.on\("close", \(\) => \{[^}]*\bnotices\(null\);/);
	});
});
