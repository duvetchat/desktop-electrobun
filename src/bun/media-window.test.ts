import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SIZE,
	isAppPage,
	KEEP_AFTER_MS,
	MediaWindows,
	MIN_SIZE,
	parsePrefs,
	placeMediaWindow,
	type MediaWindowDeps,
	type MediaWindowHandle,
} from "./media-window";
import type { DisplayArea, Rect } from "./window-frame";
import { WindowRelay, type WindowAnswer, type WindowCommand, type WindowStateMessage } from "./window-relay";

// The media controls' pop-out window (#357): where it opens, what is kept of it, and what opens and closes it.
const laptop: DisplayArea = {
	bounds: { x: 0, y: 0, width: 1512, height: 982 },
	workArea: { x: 0, y: 33, width: 1512, height: 887 },
	isPrimary: true,
};
const external: DisplayArea = {
	bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
	workArea: { x: 1512, y: 0, width: 1920, height: 1040 },
	isPrimary: false,
};
const main: Rect = { x: 100, y: 60, width: 1200, height: 800 };

describe("where the window opens", () => {
	test("the first time, by the main window's bottom left corner, at its first size", () => {
		expect(placeMediaWindow(null, [laptop], main)).toEqual({
			x: 124,
			y: 60 + 800 - DEFAULT_SIZE.height - 24,
			...DEFAULT_SIZE,
		});
	});

	test("the first time on the main window's display, when it is on the second one", () => {
		const frame = placeMediaWindow(null, [laptop, external], { x: 1700, y: 100, width: 1400, height: 900 });
		expect(frame.x).toBe(1724);
		expect(frame.y).toBe(100 + 900 - DEFAULT_SIZE.height - 24);
	});

	test("where it was left, at the size it was left", () => {
		const kept = { x: 700, y: 300, width: 360, height: 220 };
		expect(placeMediaWindow(kept, [laptop, external], main)).toEqual(kept);
		const onSecond = { x: 2000, y: 400, width: 300, height: 180 };
		expect(placeMediaWindow(onSecond, [laptop, external], main)).toEqual(onSecond);
	});

	// PLATFORM.md §3: {4200,-900,2000,300} came back on screen.
	test("a frame kept on a display that is gone comes back onto one that is there, whole", () => {
		const frame = placeMediaWindow({ x: 4200, y: -900, width: 2000, height: 300 }, [laptop], main);
		expect(frame).toEqual({ x: 0, y: 33, width: 1512, height: 300 });
	});

	test("a frame partly off its display is moved inside its work area, under the menu bar", () => {
		expect(placeMediaWindow({ x: 1400, y: 0, width: 320, height: 168 }, [laptop], main)).toEqual({
			x: 1512 - 320,
			y: 33,
			width: 320,
			height: 168,
		});
		expect(placeMediaWindow({ x: -50, y: 900, width: 320, height: 168 }, [laptop], main)).toEqual({
			x: 0,
			y: 33 + 887 - 168,
			width: 320,
			height: 168,
		});
	});

	test("it is never smaller than its controls", () => {
		const frame = placeMediaWindow({ x: 200, y: 200, width: 40, height: 10 }, [laptop], main);
		expect(frame).toMatchObject(MIN_SIZE);
	});

	test("without displays to ask, the frame is used as it is", () => {
		expect(placeMediaWindow({ x: 10, y: 20, width: 300, height: 200 }, [], null)).toEqual({
			x: 10,
			y: 20,
			width: 300,
			height: 200,
		});
		expect(placeMediaWindow(null, [], null)).toEqual({ x: 24, y: 24, ...DEFAULT_SIZE });
	});
});

describe("what is kept of the window", () => {
	test("its frame and its pin come back as they were written", () => {
		const prefs = { frame: { x: 700, y: 300, width: 360, height: 220 }, pinned: true };
		expect(parsePrefs(JSON.stringify(prefs))).toEqual(prefs);
	});

	test("a file that isn't there, is cut short or holds something else is no prefs, never an error", () => {
		const none = { frame: null, pinned: false };
		for (const text of [null, "", "{", "[]", '"pinned"', '{"frame":{"x":1},"pinned":"yes"}', '{"frame":null}'])
			expect(parsePrefs(text)).toEqual(none);
		// A frame without a size isn't one; the pin beside it is kept.
		expect(parsePrefs('{"frame":{"x":1,"y":2,"width":0,"height":100},"pinned":true}')).toEqual({
			frame: null,
			pinned: true,
		});
	});
});

describe("the app's own page", () => {
	test("is app.html in the app and /app under the dev server; the sign-in page isn't", () => {
		expect(isAppPage("views://mainview/app.html")).toBe(true);
		expect(isAppPage("http://localhost:5173/app")).toBe(true);
		expect(isAppPage("views://mainview/sign-in.html")).toBe(false);
		expect(isAppPage("views://mainview/voice-controls.html")).toBe(false);
		expect(isAppPage("not an address")).toBe(false);
	});
});

// ── The window, with Electrobun played by a fixture ─────────────────────────────────────────────────────────────────

/** A pop-out window as media-window-open.ts hands it, noting what it is asked. */
function fakeWindow(id: number, frame: Rect, pinned: boolean) {
	const handlers = new Map<string, () => void>();
	const got: WindowStateMessage[] = [];
	const asked: string[] = [];
	const state = { frame, pinned, closed: false };
	const handle: MediaWindowHandle = {
		id,
		focus: () => void asked.push("focus"),
		close: () => {
			if (state.closed) return;
			state.closed = true;
			asked.push("close");
			handlers.get("close")?.();
		},
		getFrame: () => state.frame,
		setAlwaysOnTop: (on) => {
			state.pinned = on;
			asked.push(`onTop ${on}`);
		},
		send: (message) => void got.push(message),
		on: (event, handler) => void handlers.set(event, handler),
	};
	return { handle, handlers, got, asked, state, fire: (event: string) => handlers.get(event)?.() };
}

function fixture(kept: string | null = null) {
	const relay = new WindowRelay();
	// The main window's page: it answers the pop-out's commands and notes them.
	const toMain: WindowCommand[] = [];
	relay.setMain((command) => {
		toMain.push(command);
		return Promise.resolve<WindowAnswer>({ ok: true, result: command.name === "listMics" ? [] : null });
	});
	const windows: ReturnType<typeof fakeWindow>[] = [];
	const log: string[] = [];
	const files: string[] = kept === null ? [] : [kept];
	const timers: (() => void)[] = [];
	let mainFocused = 0;
	let clock = 0;
	const deps: MediaWindowDeps = {
		create: (frame, pinned) => {
			const made = fakeWindow(windows.length + 2, frame, pinned);
			windows.push(made);
			return made.handle;
		},
		displays: () => [laptop],
		mainFrame: () => main,
		focusMain: () => void mainFocused++,
		relay,
		readPrefs: () => files.at(-1) ?? null,
		writePrefs: (text) => void files.push(text),
		log: (line) => void log.push(line),
		now: () => (clock += 0.5),
		later: (run, ms) => {
			expect(ms).toBe(KEEP_AFTER_MS);
			timers.push(run);
			return () => void timers.splice(timers.indexOf(run), 1);
		},
	};
	const media = new MediaWindows(deps);
	let seq = 0;
	/** The main page publishes a state, as index.ts hands each one to the relay and to the pop-out's controller. */
	const publish = (channel: string, value: unknown) => {
		const message = { channel, epoch: 1000, seq: ++seq, sentAt: 1000 + seq, value };
		relay.stateFromMain(message);
		media.stateFromMain(message);
	};
	const wish = (open: boolean, shown = 0) => publish("media-window", { open, shown });
	const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
	return {
		media,
		relay,
		windows,
		toMain,
		log,
		files,
		timers,
		publish,
		wish,
		settle,
		mainFocused: () => mainFocused,
		prefs: () => parsePrefs(files.at(-1) ?? null),
	};
}

describe("popping out", () => {
	test("the main window's wish opens the window, by the main window, and tells the main page it opened", async () => {
		const { media, windows, toMain, wish, settle } = fixture();
		expect(media.open).toBe(false);
		wish(true);
		await settle();
		expect(media.open).toBe(true);
		expect(windows).toHaveLength(1);
		expect(windows[0].state.frame).toEqual(placeMediaWindow(null, [laptop], main));
		expect(toMain).toEqual([{ channel: "media-window", name: "opened" }]);
	});

	test("the same wish again opens no second window", () => {
		const { windows, wish } = fixture();
		wish(true);
		wish(true);
		expect(windows).toHaveLength(1);
		expect(windows[0].asked).toEqual([]);
	});

	test("its page mirrors the controls once it can take messages: the latest state at once, then each new one", () => {
		const { windows, publish, wish } = fixture();
		publish("media", { muted: false });
		wish(true);
		const popOut = windows[0];
		// Before its page is ready, nothing is sent to it.
		publish("media", { muted: true });
		expect(popOut.got).toEqual([]);
		popOut.fire("ready");
		expect(popOut.got.filter((m) => m.channel === "media").map((m) => m.value)).toEqual([{ muted: true }]);
		publish("media", { muted: false });
		expect(popOut.got.filter((m) => m.channel === "media").map((m) => m.value)).toEqual([
			{ muted: true },
			{ muted: false },
		]);
	});

	// The window's "ready" can come before its page listens: the page says hello once it does.
	test("a page that says hello gets the latest state again, and how the window is pinned", async () => {
		const { media, relay, windows, publish, wish } = fixture(JSON.stringify({ frame: null, pinned: true }));
		publish("media", { muted: true });
		wish(true);
		const popOut = windows[0];
		popOut.fire("ready");
		popOut.got.length = 0;
		expect(await media.commandFromWindow({ channel: "media-window", name: "hello" })).toEqual({
			ok: true,
			result: { pinned: true },
		});
		expect(popOut.got.filter((m) => m.channel === "media").map((m) => m.value)).toEqual([{ muted: true }]);
		// Still one mirror: hello doesn't add the window twice.
		expect(relay.mirrors).toBe(1);
	});

	test("an ask to show it brings the window to the front, once per ask", () => {
		const { windows, wish } = fixture();
		wish(true, 0);
		wish(true, 1);
		wish(true, 1);
		wish(true, 2);
		expect(windows[0].asked).toEqual(["focus", "focus"]);
	});

	test("states of other channels open nothing", () => {
		const { media, publish } = fixture();
		publish("media", { open: true, shown: 0 });
		publish("settings", { open: true, shown: 0 });
		publish("media-window", "open");
		expect(media.open).toBe(false);
	});
});

describe("the pop-out's commands", () => {
	test("go to the main window's page, whose answer comes back, and each relay is logged with its time", async () => {
		const { media, toMain, log, wish, mainFocused } = fixture();
		wish(true);
		toMain.length = 0;
		expect(await media.commandFromWindow({ channel: "media", name: "toggleMute" })).toEqual({ ok: true, result: null });
		expect(await media.commandFromWindow({ channel: "media", name: "listMics" })).toEqual({ ok: true, result: [] });
		expect(toMain.map((c) => c.name)).toEqual(["toggleMute", "listMics"]);
		expect(log.filter((line) => line.startsWith("relayed"))).toEqual([
			"relayed media.toggleMute to the main window in 0.5 ms: ok",
			"relayed media.listMics to the main window in 0.5 ms: ok",
		]);
		// Muting from the pop-out leaves the main window where it is.
		expect(mainFocused()).toBe(0);
	});

	test("picking a screen to share, and opening where the user is, bring the main window forward first", async () => {
		const { media, wish, mainFocused, log } = fixture();
		wish(true);
		await media.commandFromWindow({ channel: "media", name: "shareScreen", args: false });
		expect(mainFocused()).toBe(1);
		await media.commandFromWindow({ channel: "media", name: "openPlace" });
		expect(mainFocused()).toBe(2);
		expect(log.at(-1)).toBe(
			"relayed media.openPlace to the main window in 0.5 ms: ok; the main window was brought forward",
		);
	});

	test("with the main window gone, a command answers why instead of hanging", async () => {
		const { media, relay, wish } = fixture();
		wish(true);
		relay.setMain(null);
		expect(await media.commandFromWindow({ channel: "media", name: "toggleMute" })).toEqual({
			ok: false,
			error: "The main window is closed",
		});
	});
});

describe("the pin", () => {
	test("keeps the window above the others, is remembered, and the page can ask how it is", async () => {
		const { media, windows, wish, prefs } = fixture();
		wish(true);
		expect(await media.commandFromWindow({ channel: "media-window", name: "info" })).toEqual({
			ok: true,
			result: { pinned: false },
		});
		expect(await media.commandFromWindow({ channel: "media-window", name: "pin", args: true })).toEqual({
			ok: true,
			result: { pinned: true },
		});
		expect(windows[0].asked).toEqual(["onTop true"]);
		expect(prefs().pinned).toBe(true);
		await media.commandFromWindow({ channel: "media-window", name: "pin", args: false });
		expect(windows[0].asked).toEqual(["onTop true", "onTop false"]);
		expect(prefs().pinned).toBe(false);
	});

	test("a window opened again is pinned as it was left", () => {
		const { windows, wish } = fixture(JSON.stringify({ frame: null, pinned: true }));
		wish(true);
		expect(windows[0].state.pinned).toBe(true);
	});

	test("a pin that isn't on or off is refused, and the pin isn't the main page's to answer", async () => {
		const { media, toMain, wish } = fixture();
		wish(true);
		toMain.length = 0;
		expect(await media.commandFromWindow({ channel: "media-window", name: "pin", args: "yes" })).toEqual({
			ok: false,
			error: "pin takes on or off",
		});
		expect((await media.commandFromWindow({ channel: "media-window", name: "explode" })).ok).toBe(false);
		expect(toMain).toEqual([]);
	});
});

describe("its size and position", () => {
	test("are kept once a move or a resize has rested, and it opens there again", () => {
		const { windows, wish, timers, prefs } = fixture();
		wish(true);
		const popOut = windows[0];
		popOut.state.frame = { x: 640, y: 420, width: 340, height: 200 };
		popOut.fire("move");
		popOut.fire("resize");
		popOut.fire("move");
		// One timer for the burst: each move restarts it.
		expect(timers).toHaveLength(1);
		expect(prefs().frame).toBeNull();
		timers[0]();
		expect(prefs().frame).toEqual({ x: 640, y: 420, width: 340, height: 200 });
		wish(false);
		wish(true);
		expect(windows[1].state.frame).toEqual({ x: 640, y: 420, width: 340, height: 200 });
	});

	test("where it is when it closes is kept too, without waiting", () => {
		const { windows, wish, prefs } = fixture();
		wish(true);
		windows[0].state.frame = { x: 300, y: 500, width: 320, height: 168 };
		windows[0].handle.close();
		expect(prefs().frame).toEqual({ x: 300, y: 500, width: 320, height: 168 });
	});

	test("a data folder that can't be written to doesn't end the app", () => {
		const relay = new WindowRelay();
		const log: string[] = [];
		const made = fakeWindow(2, { x: 0, y: 0, width: 320, height: 168 }, false);
		const media = new MediaWindows({
			create: () => made.handle,
			displays: () => [laptop],
			mainFrame: () => main,
			focusMain: () => {},
			relay,
			readPrefs: () => null,
			writePrefs: () => {
				throw new Error("ENOENT");
			},
			log: (line) => void log.push(line),
		});
		media.stateFromMain({ channel: "media-window", epoch: 1, seq: 1, sentAt: 1, value: { open: true, shown: 0 } });
		expect(() => made.handle.close()).not.toThrow();
		expect(log).toContain("couldn't keep the window's place: ENOENT");
	});
});

describe("putting back", () => {
	test("the main window's Put back closes the window, and the main page isn't told what it asked for", async () => {
		const { media, relay, windows, toMain, wish, settle } = fixture();
		wish(true);
		windows[0].fire("ready");
		await settle();
		toMain.length = 0;
		wish(false);
		await settle();
		expect(media.open).toBe(false);
		expect(windows[0].asked).toEqual(["close"]);
		expect(relay.mirrors).toBe(0);
		expect(toMain).toEqual([]);
	});

	test("Put back inside the window closes it and tells the main page, which docks the controls", async () => {
		const { media, windows, toMain, wish, settle } = fixture();
		wish(true);
		await settle();
		toMain.length = 0;
		expect(await media.commandFromWindow({ channel: "media-window", name: "putBack" })).toEqual({
			ok: true,
			result: null,
		});
		await settle();
		expect(media.open).toBe(false);
		expect(windows[0].state.closed).toBe(true);
		expect(toMain).toEqual([{ channel: "media-window", name: "closed" }]);
	});

	test("closing the window with its own button does the same", async () => {
		const { media, relay, windows, toMain, wish, settle } = fixture();
		wish(true);
		windows[0].fire("ready");
		await settle();
		toMain.length = 0;
		windows[0].handle.close();
		await settle();
		expect(media.open).toBe(false);
		expect(relay.mirrors).toBe(0);
		expect(toMain).toEqual([{ channel: "media-window", name: "closed" }]);
	});

	test("out and back, again and again, asks nothing of the call: only window commands reach the main page", async () => {
		const { media, windows, toMain, wish, settle } = fixture();
		for (let round = 0; round < 3; round++) {
			wish(true);
			windows.at(-1)!.fire("ready");
			wish(false);
		}
		await settle();
		expect(media.open).toBe(false);
		expect(windows).toHaveLength(3);
		expect(toMain.every((command) => command.channel === "media-window" && command.name === "opened")).toBe(true);
		expect(toMain).toHaveLength(3);
	});
});

describe("the main window going", () => {
	test("closing the main window closes the pop-out with it", () => {
		const { media, windows, wish } = fixture();
		wish(true);
		media.mainClosed();
		expect(media.open).toBe(false);
		expect(windows[0].state.closed).toBe(true);
	});

	test("signing out, which takes the main window to the sign-in page, closes it", () => {
		const { media, windows, wish, log } = fixture();
		wish(true);
		media.mainNavigated("views://mainview/sign-in.html");
		expect(media.open).toBe(false);
		expect(windows[0].state.closed).toBe(true);
		expect(log).toContain("closing: the main window left the app's page");
	});

	test("the app's own page loading again leaves it to the page's wish", () => {
		const { media, wish } = fixture();
		wish(true);
		media.mainNavigated("views://mainview/app.html");
		expect(media.open).toBe(true);
		// The page that loaded wants no window until its user pops the controls out again.
		wish(false);
		expect(media.open).toBe(false);
	});

	test("with no window open, neither does anything", () => {
		const { media, windows } = fixture();
		media.mainClosed();
		media.mainNavigated("views://mainview/sign-in.html");
		expect(windows).toHaveLength(0);
	});
});
