import { describe, expect, test } from "bun:test";
import {
	FIRST_SIZE,
	firstFrame,
	frameFromEvent,
	frameScale,
	KEEP_AFTER_MS,
	MainWindowKeeper,
	MARGIN,
	MIN_SIZE,
	minimumSize,
	openingOf,
	parsePrefs,
	type MainWindowKeeperDeps,
	type MainWindowPrefs,
	type MainWindowState,
	type Opening,
} from "./main-window";
import type { DisplayArea, Rect } from "./window-frame";

// The main window's frame (#419): where it opens the first time, where it opens after that, and what is kept of it.

/** A display at 0,0 whose work area leaves `top` and `bottom` to a menu bar, a Dock or a taskbar. */
function display(width: number, height: number, { top = 0, bottom = 0, x = 0, scaleFactor = 1, primary = true } = {}) {
	return {
		bounds: { x, y: 0, width, height },
		workArea: { x, y: top, width, height: height - top - bottom },
		isPrimary: primary,
		scaleFactor,
	} satisfies DisplayArea;
}

// A 1440×900 MacBook with its menu bar, and Windows displays with a 48 px taskbar.
const laptop = display(1440, 900, { top: 25 });
const fullHd = display(1920, 1080, { bottom: 48 });
const qhd = display(2560, 1440, { bottom: 48 });
const ultrawide = display(3440, 1440, { bottom: 48 });
/** A second 1920×1080 display to the right of fullHd. */
const second = display(1920, 1080, { bottom: 48, x: 1920, primary: false });

const nothingKept: MainWindowPrefs = { frame: null, scale: 1, maximized: false, fullScreen: false };
const kept = (frame: Rect, more: Partial<MainWindowPrefs> = {}): MainWindowPrefs => ({
	...nothingKept,
	frame,
	...more,
});

/** Whether a frame is centred in an area, to the pixel a rounding leaves. */
function centredIn(frame: Rect, area: Rect) {
	expect(Math.abs(frame.x - area.x - (area.x + area.width - frame.x - frame.width))).toBeLessThanOrEqual(1);
	expect(Math.abs(frame.y - area.y - (area.y + area.height - frame.y - frame.height))).toBeLessThanOrEqual(1);
}

describe("the first launch's frame", () => {
	test("on a 1440×900 laptop: the first size's least, with room around it", () => {
		const frame = firstFrame(laptop.workArea);
		expect(frame).toEqual({ x: 170, y: 113, width: 1100, height: 700 });
		centredIn(frame, laptop.workArea);
	});

	test("on a 1920×1080 screen: a share of its work area", () => {
		const frame = firstFrame(fullHd.workArea);
		expect(frame).toEqual({ x: 288, y: 129, width: 1344, height: 774 });
		centredIn(frame, fullHd.workArea);
	});

	test("on a 2560×1440 screen: the first size's most, not a share of the screen", () => {
		const frame = firstFrame(qhd.workArea);
		expect(frame).toEqual({ x: 560, y: 236, ...FIRST_SIZE.max });
		centredIn(frame, qhd.workArea);
	});

	test("on a 3440×1440 ultrawide: the same size, with space all round", () => {
		const frame = firstFrame(ultrawide.workArea);
		expect(frame).toEqual({ x: 1000, y: 236, ...FIRST_SIZE.max });
		centredIn(frame, ultrawide.workArea);
	});

	test("on a display smaller than the first size's least: its work area, less a margin", () => {
		const small = display(1024, 768, { bottom: 40 });
		expect(firstFrame(small.workArea)).toEqual({ x: MARGIN, y: MARGIN, width: 1024 - 2 * MARGIN, height: 696 });
		// Smaller than the window's own minimum too: the minimum gives way, as the window must fit.
		const tiny = display(800, 600, { bottom: 40 });
		expect(firstFrame(tiny.workArea)).toEqual({ x: 16, y: 16, width: 768, height: 528 });
		expect(minimumSize(tiny.workArea)).toEqual({ width: 768, height: 528 });
	});

	test("in the work area, not under the menu bar or over the taskbar", () => {
		// A taskbar on the left takes the work area's first 60 px.
		const area = { x: 60, y: 0, width: 1860, height: 1080 };
		const frame = firstFrame(area);
		expect(frame.x).toBeGreaterThanOrEqual(60);
		centredIn(frame, area);
		expect(firstFrame(laptop.workArea).y).toBeGreaterThanOrEqual(25);
	});

	// Windows' frames are in device pixels: at 150% a 1920×1080 display has 1280×720 logical ones.
	test("on Windows at 150%: sized in logical pixels, and given in the display's own", () => {
		const scaled = display(1920, 1080, { bottom: 72, scaleFactor: 1.5 });
		expect(frameScale("win32", scaled)).toBe(1.5);
		const frame = firstFrame(scaled.workArea, 1.5);
		// 1100 logical px wide, and as tall as 672 logical px leave with a margin: 640.
		expect(frame).toEqual({ x: 135, y: 24, width: 1650, height: 960 });
		// The minimum stays in logical pixels: the window's procedure scales it (window-snap.c).
		expect(minimumSize(scaled.workArea, 1.5)).toEqual(MIN_SIZE);
	});

	test("a frame is in points on macOS and logical pixels on Linux, whatever the display's scale", () => {
		const retina = display(1512, 982, { top: 38, scaleFactor: 2 });
		expect(frameScale("darwin", retina)).toBe(1);
		expect(frameScale("linux", retina)).toBe(1);
		expect(frameScale("win32", { ...retina, scaleFactor: undefined })).toBe(1);
		expect(frameScale("win32", undefined)).toBe(1);
	});
});

describe("how the window opens", () => {
	test("with nothing kept, on the display under the cursor", () => {
		const opening = openingOf(nothingKept, [fullHd, second], { x: 2500, y: 300 }, "win32");
		expect(opening.frame).toEqual({ x: 1920 + 288, y: 129, width: 1344, height: 774 });
		expect(opening).toMatchObject({ normal: opening.frame, maximized: false, fullScreen: false, minimum: MIN_SIZE });
	});

	test("with nothing kept and no cursor, on the primary display", () => {
		expect(openingOf(nothingKept, [second, fullHd], null, "win32").frame).toEqual(firstFrame(fullHd.workArea));
		// A cursor on no display, too.
		expect(openingOf(nothingKept, [second, fullHd], { x: -500, y: 9000 }, "win32").frame).toEqual(
			firstFrame(fullHd.workArea),
		);
	});

	test("with no display known, still at the first size", () => {
		expect(openingOf(nothingKept, [], null, "linux").frame).toEqual({ x: 170, y: 100, width: 1100, height: 700 });
		// A frame kept is no use without one either.
		expect(openingOf(kept({ x: 5, y: 5, width: 1000, height: 700 }), [], null, "linux").frame).toEqual({
			x: 170,
			y: 100,
			width: 1100,
			height: 700,
		});
	});

	test("where it was left, at the size it was left", () => {
		const frame = { x: 300, y: 120, width: 1200, height: 760 };
		const opening = openingOf(kept(frame), [fullHd, second], { x: 2500, y: 300 }, "win32");
		expect(opening).toMatchObject({ frame, normal: frame, area: fullHd.workArea, maximized: false });
		const onSecond = { x: 2200, y: 80, width: 1300, height: 800 };
		expect(openingOf(kept(onSecond), [fullHd, second], null, "win32").frame).toEqual(onSecond);
	});

	test("a frame across two displays opens across them", () => {
		const across = { x: 1400, y: 100, width: 1100, height: 700 };
		expect(openingOf(kept(across), [fullHd, second], null, "win32").frame).toEqual(across);
	});

	test("a frame kept on an unplugged display comes back on screen", () => {
		const onSecond = { x: 2200, y: 80, width: 1300, height: 800 };
		const opening = openingOf(kept(onSecond), [fullHd], null, "win32");
		expect(opening.frame).toEqual({ x: 1920 - 1300, y: 80, width: 1300, height: 800 });
		expect(opening.area).toEqual(fullHd.workArea);
		// One the second display had above the first: onto the nearest display, whole.
		const above = { x: 400, y: -900, width: 1300, height: 800 };
		expect(openingOf(kept(above), [fullHd], null, "win32").frame).toEqual({ x: 400, y: 0, width: 1300, height: 800 });
	});

	test("a frame kept on a display that is gone goes to the nearest one, not the primary", () => {
		// Three in a row; the third is unplugged, and the second is the nearest to where the window was.
		const onThird = { x: 4000, y: 100, width: 1200, height: 700 };
		const opening = openingOf(kept(onThird), [fullHd, second], null, "win32");
		expect(opening.area).toEqual(second.workArea);
		expect(opening.frame).toEqual({ x: 3840 - 1200, y: 100, width: 1200, height: 700 });
	});

	test("a frame larger than the display now is made to fit its work area", () => {
		// Left on a 2560×1440 display that is now set to 1920×1080.
		const opening = openingOf(kept({ x: 200, y: 100, width: 2200, height: 1200 }), [fullHd], null, "win32");
		expect(opening.frame).toEqual(fullHd.workArea);
	});

	test("a frame partly past the display's edge, or under the taskbar, is moved inside", () => {
		const past = { x: 1500, y: 600, width: 1100, height: 700 };
		expect(openingOf(kept(past), [fullHd], null, "win32").frame).toEqual({
			x: 1920 - 1100,
			y: 1032 - 700,
			width: 1100,
			height: 700,
		});
	});

	test("a frame smaller than the window may be made opens at the minimum", () => {
		const opening = openingOf(kept({ x: 100, y: 100, width: 500, height: 300 }), [fullHd], null, "linux");
		expect(opening.frame).toEqual({ x: 100, y: 100, ...MIN_SIZE });
	});

	test("on Windows, a frame keeps its logical size on a display of another scale", () => {
		// Kept at 150%, where 1650×960 device pixels are 1100×640 logical ones; the display is at 100% now.
		const frame = { x: 100, y: 20, width: 1650, height: 960 };
		const opening = openingOf(kept(frame, { scale: 1.5 }), [fullHd], null, "win32");
		expect(opening.frame).toEqual({ x: 100, y: 20, width: 1100, height: 640 });
		expect(opening.scale).toBe(1);
		// And the same frame at the same scale is left alone.
		const scaled = display(1920, 1080, { bottom: 72, scaleFactor: 1.5 });
		expect(openingOf(kept(frame, { scale: 1.5 }), [scaled], null, "win32").frame).toEqual(frame);
	});

	test("left maximized, it opens filling its display's work area, and restores to the frame it had", () => {
		const frame = { x: 2200, y: 80, width: 1300, height: 800 };
		const opening = openingOf(kept(frame, { maximized: true }), [fullHd, second], null, "darwin");
		expect(opening).toMatchObject({ frame: second.workArea, normal: frame, area: second.workArea, maximized: true });
	});

	test("left maximized on Windows, it is made at the frame it had: Windows' maximize is asked after", () => {
		const frame = { x: 2200, y: 80, width: 1300, height: 800 };
		const opening = openingOf(kept(frame, { maximized: true }), [fullHd, second], null, "win32");
		expect(opening).toMatchObject({ frame, normal: frame, area: second.workArea, maximized: true });
	});

	test("left full screen, it opens full screen from the frame it had", () => {
		const frame = { x: 170, y: 113, width: 1100, height: 700 };
		expect(openingOf(kept(frame, { fullScreen: true }), [laptop], null, "darwin")).toMatchObject({
			frame,
			normal: frame,
			maximized: false,
			fullScreen: true,
		});
	});
});

describe("what is kept, as its file has it", () => {
	test("a frame, its scale, and whether it was maximized or full screen", () => {
		const prefs = {
			frame: { x: 10, y: 20, width: 1200, height: 800 },
			scale: 1.25,
			maximized: true,
			fullScreen: false,
		};
		expect(parsePrefs(JSON.stringify(prefs))).toEqual(prefs);
	});

	test("anything unreadable is nothing kept", () => {
		for (const text of [null, "", "{", "null", "7", '"frame"', "[]", "{}", '{"frame":null,"maximized":true}']) {
			expect(parsePrefs(text)).toEqual(nothingKept);
		}
		// A frame that is no frame: no size, or not numbers.
		expect(parsePrefs('{"frame":{"x":0,"y":0,"width":0,"height":700}}')).toEqual(nothingKept);
		expect(parsePrefs('{"frame":{"x":"0","y":0,"width":900,"height":700}}')).toEqual(nothingKept);
	});

	test("a frame alone is one left neither maximized nor full screen, at scale 1", () => {
		const frame = { x: 10, y: 20, width: 1200, height: 800 };
		expect(parsePrefs(JSON.stringify({ frame, scale: 0, maximized: "yes" }))).toEqual({ ...nothingKept, frame });
	});
});

describe("a frame as an event says it", () => {
	const had = { x: 100, y: 100, width: 1100, height: 700 };

	test("a resize says where and how large", () => {
		const event = { name: "resize", data: { id: 1, x: 40, y: 60, width: 1280, height: 800 } };
		expect(frameFromEvent(event, had)).toEqual({ x: 40, y: 60, width: 1280, height: 800 });
	});

	test("a move says where: the window is as large as it was", () => {
		expect(frameFromEvent({ name: "move", data: { id: 1, x: -300, y: 60 } }, had)).toEqual({
			x: -300,
			y: 60,
			width: 1100,
			height: 700,
		});
	});

	test("anything else is no frame", () => {
		expect(frameFromEvent(null, had)).toBeNull();
		expect(frameFromEvent({ data: { id: 1 } }, had)).toBeNull();
		expect(frameFromEvent({ data: { x: "1", y: 2 } }, had)).toBeNull();
		expect(frameFromEvent({ data: { x: 0, y: 0, width: 0, height: 0 } }, had)).toBeNull();
	});
});

/** A keeper over a window a test moves, with the timer a test runs by hand. */
function keeperFor(opening: Opening, platform = "darwin", displays: DisplayArea[] = [fullHd, second]) {
	const written: MainWindowPrefs[] = [];
	const window: { state: MainWindowState; frame: Rect | null; gone: boolean; asked: number } = {
		state: { minimized: false, maximized: false, fullScreen: false },
		frame: null,
		gone: false,
		asked: 0,
	};
	let timer: { run: () => void; ms: number } | null = null;
	const logged: string[] = [];
	const deps: MainWindowKeeperDeps = {
		platform,
		frame: () => {
			if (window.gone) throw new Error("the window was asked after it closed");
			return window.frame;
		},
		state: () => {
			if (window.gone) throw new Error("the window was asked after it closed");
			window.asked++;
			return window.state;
		},
		displays: () => displays,
		writePrefs: (text) => written.push(parsePrefs(text)),
		log: (line) => logged.push(line),
		later: (run, ms) => {
			timer = { run, ms };
			return () => {
				timer = null;
			};
		},
	};
	const keeper = new MainWindowKeeper(deps, opening);
	return {
		keeper,
		window,
		written,
		logged,
		deps,
		/** Lets the window rest: runs the timer a move started. */
		rest: () => {
			const due = timer;
			timer = null;
			due?.run();
		},
		waiting: () => timer?.ms ?? null,
	};
}

describe("what is kept of the window", () => {
	const first = openingOf(nothingKept, [fullHd, second], null, "darwin");

	test("its frame, once it has rested after a move or a resize", () => {
		const { keeper, written, rest, waiting } = keeperFor(first);
		const moved = { x: 400, y: 200, width: 1344, height: 774 };
		keeper.moved(moved);
		expect(written).toEqual([]);
		expect(waiting()).toBe(KEEP_AFTER_MS);
		rest();
		expect(written).toEqual([kept(moved)]);
		expect(keeper.frame).toEqual(moved);
	});

	test("a drag's many moves are kept once, at its last frame", () => {
		const { keeper, written, window, rest } = keeperFor(first);
		for (let x = 300; x <= 800; x += 100) keeper.moved({ x, y: 200, width: 1344, height: 774 });
		// The window isn't asked anything while it moves.
		expect(window.asked).toBe(0);
		rest();
		expect(written).toEqual([kept({ x: 800, y: 200, width: 1344, height: 774 })]);
	});

	test("where events say no frame, the window is asked for it once it rests", () => {
		const { keeper, window, written, rest } = keeperFor(first, "win32");
		keeper.moved();
		window.frame = { x: 2300, y: 150, width: 1200, height: 800 };
		rest();
		expect(written).toEqual([kept(window.frame)]);
	});

	test("on Windows, the scale of the display it is on", () => {
		const scaled = display(1920, 1080, { bottom: 72, scaleFactor: 1.5 });
		const { keeper, window, written, rest } = keeperFor(openingOf(nothingKept, [scaled], null, "win32"), "win32", [
			scaled,
		]);
		window.frame = { x: 100, y: 20, width: 1650, height: 900 };
		keeper.moved();
		rest();
		expect(written).toEqual([kept(window.frame, { scale: 1.5 })]);
	});

	test("maximized, the frame it had before: the one a restore gives back", () => {
		const { keeper, window, written, rest } = keeperFor(first, "win32");
		const normal = { x: 300, y: 120, width: 1200, height: 760 };
		window.frame = normal;
		keeper.moved();
		rest();
		// Windows' maximize puts the frame just beyond the work area's edges.
		window.state = { ...window.state, maximized: true };
		window.frame = { x: -8, y: -8, width: 1936, height: 1048 };
		keeper.moved();
		rest();
		expect(written.at(-1)).toEqual(kept(normal, { maximized: true }));
		// Restored: its frame is kept again.
		window.state = { ...window.state, maximized: false };
		window.frame = normal;
		keeper.moved();
		rest();
		expect(written.at(-1)).toEqual(kept(normal));
	});

	test("a window that fills its display's work area counts as maximized, however it came to", () => {
		const { keeper, written, rest } = keeperFor(first);
		const normal = { x: 2300, y: 150, width: 1200, height: 800 };
		keeper.moved(normal);
		rest();
		// The title bar's maximize (window-frame.ts) sets the frame: the system says nothing of it.
		keeper.moved(second.workArea);
		rest();
		expect(written.at(-1)).toEqual(kept(normal, { maximized: true }));
	});

	test("a window that still has the frame the maximize gave it counts as maximized, whatever the work area is now", () => {
		const { keeper, deps, written, rest } = keeperFor(first);
		const normal = { x: 300, y: 120, width: 1200, height: 760 };
		keeper.moved(normal);
		rest();
		// Filled when the work area was a pixel shorter: the Dock has changed since.
		const given = { ...fullHd.workArea, height: 1031 };
		deps.filled = (frame) => frame.height === 1031;
		keeper.moved(given);
		rest();
		expect(written.at(-1)).toEqual(kept(normal, { maximized: true }));
	});

	test("full screen, what it was before: its frame, and whether it was maximized", () => {
		const { keeper, window, written, rest } = keeperFor(first);
		const normal = { x: 300, y: 120, width: 1200, height: 760 };
		keeper.moved(normal);
		rest();
		window.state = { ...window.state, fullScreen: true };
		keeper.moved(fullHd.bounds);
		rest();
		expect(written.at(-1)).toEqual(kept(normal, { fullScreen: true }));
		// Back out of full screen.
		window.state = { ...window.state, fullScreen: false };
		keeper.moved(normal);
		rest();
		expect(written.at(-1)).toEqual(kept(normal));
	});

	test("a window opened maximized stays so until it is restored", () => {
		const normal = { x: 300, y: 120, width: 1200, height: 760 };
		const opening = openingOf(kept(normal, { maximized: true }), [fullHd, second], null, "darwin");
		const { keeper, written, rest } = keeperFor(opening);
		expect(keeper.frame).toEqual(fullHd.workArea);
		keeper.keepNow();
		expect(written.at(-1)).toEqual(kept(normal, { maximized: true }));
		keeper.moved(normal);
		rest();
		expect(written.at(-1)).toEqual(kept(normal));
	});

	// Windows moves a minimized window to -32000,-32000.
	test("minimized, nothing of where Windows puts it", () => {
		const { keeper, window, written, rest } = keeperFor(first, "win32");
		const normal = { x: 300, y: 120, width: 1200, height: 760 };
		window.frame = normal;
		keeper.moved();
		rest();
		window.state = { ...window.state, minimized: true };
		window.frame = { x: -32000, y: -32000, width: 160, height: 28 };
		keeper.moved();
		rest();
		expect(written.at(-1)).toEqual(kept(normal));
		expect(keeper.frame).toEqual(normal);
	});

	test("as it closes, what it was when it last rested, without asking a window that is gone", () => {
		const { keeper, window, written, rest, waiting } = keeperFor(first, "win32");
		const normal = { x: 300, y: 120, width: 1200, height: 760 };
		window.frame = normal;
		keeper.moved();
		rest();
		// A move that hadn't rested yet, then the close: the window's handle has nothing behind it now.
		keeper.moved();
		window.gone = true;
		keeper.closed();
		expect(waiting()).toBeNull();
		expect(written.at(-1)).toEqual(kept(normal));
		// Nothing after that either: no event that comes late, nor the app's quit.
		const count = written.length;
		keeper.moved({ x: 1, y: 1, width: 1000, height: 700 });
		keeper.keepNow();
		keeper.closed();
		rest();
		expect(written).toHaveLength(count);
	});

	test("before it is asked to close, and as the app quits, where it is at that moment", () => {
		const { keeper, window, written, waiting } = keeperFor(first, "win32");
		window.frame = { x: 500, y: 300, width: 1000, height: 700 };
		keeper.moved();
		keeper.keepNow();
		expect(waiting()).toBeNull();
		expect(written).toEqual([kept(window.frame)]);
	});

	test("a window that can't be asked keeps what it had", () => {
		const { keeper, deps, written } = keeperFor(first);
		deps.state = () => {
			throw new Error("Can't get window state. Window no longer exists");
		};
		keeper.keepNow();
		expect(written).toEqual([kept(first.frame)]);
	});

	test("a file that can't be written is logged, not thrown", () => {
		const { keeper, deps, logged } = keeperFor(first);
		deps.writePrefs = () => {
			throw new Error("ENOENT");
		};
		expect(() => keeper.keepNow()).not.toThrow();
		expect(logged).toEqual(["couldn't keep the window's place: ENOENT"]);
	});
});
