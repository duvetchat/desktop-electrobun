import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	NOTICE_GAP,
	NOTICE_MARGIN,
	NOTICE_STACK_GAP,
	NOTICE_WIDTH,
	PAGE_TITLE_BAR,
	noticePlace,
	placeStyle,
	underCall,
} from "$lib/notice-place";
import { shellFor } from "$lib/platform";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const shellOf = (preview: "mac" | "windows" | "linux" | "web") =>
	shellFor({ inElectrobun: preview !== "web", injected: null, userAgent: MAC_UA, preview });
const SHELLS = (["mac", "windows", "linux", "web"] as const).map(shellOf);

// The shell's title line (TitleStrip.svelte) is 52 px on every system and on the web; with a 304 px sidebar docked, it
// is the main column's.
const docked = { left: 304, width: 976, bottom: 52 };

describe("the notices' place", () => {
	test("is the same distance under the title line on macOS, Windows, Linux and the web", () => {
		const places = SHELLS.map((shell) => noticePlace(docked, 1280, shell));
		for (const place of places) expect(place).toEqual(places[0]!);
		expect(places[0]!.top).toBe(52 + NOTICE_GAP);
		// The design's 62 px from the top of the main column (DESIGN-MAP.md S-29).
		expect(places[0]!.top).toBe(62);
	});

	test("is centred on the main column, a notice wide, and never over the title line", () => {
		const place = noticePlace(docked, 1280, shellOf("windows"));
		expect(place.width).toBe(NOTICE_WIDTH);
		expect(place.left + place.width / 2).toBe(docked.left + docked.width / 2);
		// Windows' and Linux's buttons, and the tabs, are in the line: a notice starts under it.
		expect(place.top).toBeGreaterThanOrEqual(docked.bottom);
	});

	test("follows the line: a wider sidebar, the sidebar folded, a taller line", () => {
		expect(noticePlace({ left: 420, width: 860, bottom: 52 }, 1280, shellOf("mac")).left).toBe(420 + (860 - 420) / 2);
		// Folded, the strip is the whole window's line.
		expect(noticePlace({ left: 0, width: 1280, bottom: 52 }, 1280, shellOf("mac")).left).toBe(430);
		expect(noticePlace({ ...docked, bottom: 60 }, 1280, shellOf("linux")).top).toBe(60 + NOTICE_GAP);
		expect(noticePlace({ ...docked, bottom: 51.6 }, 1280, shellOf("linux")).top).toBe(52 + NOTICE_GAP);
	});

	test("keeps its margins in a narrow column", () => {
		const narrow = { left: 304, width: 300, bottom: 52 };
		const place = noticePlace(narrow, 604, shellOf("web"));
		expect(place.width).toBe(300 - 2 * NOTICE_MARGIN);
		expect(place.left).toBe(304 + NOTICE_MARGIN);
		expect(noticePlace({ left: 0, width: 20, bottom: 52 }, 20, shellOf("web")).width).toBe(0);
	});

	test("without a title line, is under what the platform switch says the page has", () => {
		// The desktop app's pages outside the shell have their own slim bar; the web has nothing over the page.
		for (const shell of SHELLS.filter((s) => s.chrome !== "web"))
			expect(noticePlace(null, 1280, shell)).toEqual({ top: PAGE_TITLE_BAR + NOTICE_GAP, left: 430, width: 420 });
		expect(noticePlace(null, 1280, shellOf("web"))).toEqual({ top: NOTICE_GAP, left: 430, width: 420 });
	});

	test("the mentions' notices start under a call's notice, and where it would be without one", () => {
		const place = noticePlace(docked, 1280, shellOf("mac"));
		expect(underCall(place, 0)).toEqual(place);
		expect(underCall(place, 64)).toEqual({ ...place, top: place.top + 64 + NOTICE_STACK_GAP });
	});

	test("as a style, takes over from the classes that centre a notice in the window", () => {
		expect(placeStyle({ top: 62, left: 582, width: 420 })).toBe(
			"top: 62px; left: 582px; right: auto; width: 420px; margin-inline: 0;",
		);
	});
});

describe("the two notices", () => {
	const source = (name: string) => readFileSync(join(import.meta.dir, "components", name), "utf8");
	const mentions = source("MentionNotices.svelte");
	const call = source("CallCard.svelte");

	test("both take their place from the title line, while they show", () => {
		for (const component of [mentions, call]) {
			expect(component).toContain("return watchNoticePlace();");
			expect(component).toMatch(/style=\{place\}/);
			// Before the line is measured: the shell's 62 px, in the window's middle.
			expect(component).toMatch(
				/fixed inset-x-0 top-\[62px\] z-\d+ mx-auto flex w-\[min\(420px,calc\(100vw-32px\)\)\]/,
			);
		}
	});

	test("neither has an offset of its own for the desktop app's old title bar", () => {
		for (const component of [mentions, call]) {
			expect(component).not.toContain("isElectrobunWindow");
			expect(component).not.toMatch(/\btop-(14|3)\b/);
		}
	});

	test("the call's notice says how tall it is, and the mentions' start under it", () => {
		expect(call).toContain("bind:offsetHeight={height}");
		expect(call).toContain("noticeArea.callHeight = shown ? height : 0;");
		expect(mentions).toContain("placeStyle(underCall(noticeArea.place, noticeArea.callHeight))");
	});
});
