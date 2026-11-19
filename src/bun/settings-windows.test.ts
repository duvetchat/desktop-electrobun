import { describe, expect, test } from "bun:test";
import {
	parseOpenAppWindow,
	settingsChrome,
	settingsFrame,
	settingsMirrors,
	settingsPreload,
	SettingsWindows,
	windowKey,
	windowTitle,
	type AppWindow,
	type AppWindowSpec,
	type SettingsWindowsDeps,
} from "./settings-windows";
import type { DisplayArea } from "./window-frame";
import type { MirroredChannels, WindowCommand, WindowStateMessage } from "./window-relay";

const display = (x: number, y: number, width: number, height: number, isPrimary = false): DisplayArea => ({
	bounds: { x, y, width, height },
	workArea: { x, y: y + 25, width, height: height - 25 },
	isPrimary,
});
const laptop = display(0, 0, 1512, 982, true);

describe("where a Settings window opens", () => {
	test("at the design's size, centred over the main window", () => {
		const main = { x: 100, y: 60, width: 1300, height: 860 };
		expect(settingsFrame("settings", main, [laptop])).toEqual({ x: 320, y: 180, width: 860, height: 620 });
		expect(settingsFrame("space-settings", main, [laptop])).toEqual({ x: 280, y: 160, width: 940, height: 660 });
	});

	test("each further window a step down and right", () => {
		const main = { x: 100, y: 60, width: 1300, height: 860 };
		expect(settingsFrame("settings", main, [laptop], 1)).toEqual({ x: 348, y: 208, width: 860, height: 620 });
		expect(settingsFrame("settings", main, [laptop], 2)).toEqual({ x: 376, y: 236, width: 860, height: 620 });
	});

	test("never past the edges of the display the main window is on", () => {
		// The main window hangs off the right and the bottom.
		const main = { x: 1100, y: 600, width: 1300, height: 860 };
		const frame = settingsFrame("settings", main, [laptop]);
		expect(frame).toEqual({ x: 1512 - 860, y: 982 - 620, width: 860, height: 620 });
		// And off the top left.
		expect(settingsFrame("settings", { x: -900, y: -700, width: 1300, height: 860 }, [laptop])).toEqual({
			x: 0,
			y: 25,
			width: 860,
			height: 620,
		});
	});

	test("smaller on a display too small for it: the work area less 80 each way", () => {
		const small = display(0, 0, 800, 600, true);
		expect(settingsFrame("space-settings", { x: 0, y: 25, width: 800, height: 575 }, [small])).toEqual({
			x: 40,
			y: 65,
			width: 720,
			height: 495,
		});
	});

	test("on the main window's display, not the primary one", () => {
		const second = display(1512, 0, 1920, 1080);
		const frame = settingsFrame("settings", { x: 1700, y: 100, width: 1400, height: 900 }, [laptop, second]);
		expect(frame.x).toBeGreaterThanOrEqual(1512);
		expect(frame).toEqual({ x: 1970, y: 240, width: 860, height: 620 });
	});

	test("over the main window itself when no display is known", () => {
		expect(settingsFrame("settings", { x: 10, y: 10, width: 1000, height: 700 }, [])).toEqual({
			x: 80,
			y: 50,
			width: 860,
			height: 620,
		});
	});
});

describe("what the page asks for", () => {
	test("Settings, with or without a section", () => {
		expect(parseOpenAppWindow({ window: "settings" })).toEqual({ window: "settings" });
		expect(parseOpenAppWindow({ window: "settings", section: "appearance" })).toEqual({
			window: "settings",
			section: "appearance",
		});
	});

	test("a Space's settings, by its ID and name", () => {
		expect(parseOpenAppWindow({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" })).toEqual({
			window: "space-settings",
			spaceId: "s1",
			name: "Harbour Lights",
		});
	});

	test("nothing else", () => {
		for (const value of [null, "settings", {}, { window: "media" }, { window: "space-settings" }, { window: 1 }]) {
			expect(parseOpenAppWindow(value)).toBeNull();
		}
	});

	test("one window for Settings and one for each Space", () => {
		expect(windowKey({ window: "settings", section: "audio" })).toBe("settings");
		expect(windowKey({ window: "space-settings", spaceId: "s1", name: "A" })).toBe("space:s1");
		expect(windowKey({ window: "space-settings", spaceId: "s2", name: "A" })).toBe("space:s2");
	});

	test("the title the system shows", () => {
		expect(windowTitle({ window: "settings" })).toBe("Duvet settings");
		expect(windowTitle({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" })).toBe(
			"Harbour Lights · Space settings",
		);
		expect(windowTitle({ window: "space-settings", spaceId: "s1", name: "" })).toBe("Space · Space settings");
	});
});

/** Runs a preload as the page would, with `window` the page given. */
function preloaded(script: string, page: Record<string, unknown>): Record<string, unknown> {
	// oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call -- a preload is a script: the test runs it
	new Function("window", script)(page);
	return page;
}
const topPage = (): Record<string, unknown> => {
	const page: Record<string, unknown> = {};
	page.top = page;
	return page;
};

describe("the window's chrome and what its page is told", () => {
	test("macOS draws its traffic lights over a title bar that takes keys; elsewhere the page draws the buttons", () => {
		expect(settingsChrome("darwin")).toEqual({ titleBarStyle: "hiddenInset", nativeButtons: true });
		expect(settingsChrome("win32")).toEqual({ titleBarStyle: "hidden", nativeButtons: false });
		expect(settingsChrome("linux")).toEqual({ titleBarStyle: "hidden", nativeButtons: false });
	});

	test("the preload says which window this is, and its Space and section", () => {
		const page = preloaded(
			settingsPreload({ window: "space-settings", spaceId: "s1", name: "A" }, "darwin"),
			topPage(),
		);
		expect(page.__duvetShell).toEqual({
			os: "darwin",
			titleBarStyle: "hiddenInset",
			nativeButtons: true,
			// The glass is the main window's alone (#374): a Settings window's side panel is solid.
			glass: false,
			window: "space-settings",
		});
		expect(page.__duvetSettings).toEqual({ spaceId: "s1", section: null });
		expect(Object.isFrozen(page.__duvetSettings)).toBe(true);

		const settings = preloaded(settingsPreload({ window: "settings", section: "audio" }, "win32"), topPage());
		expect(settings.__duvetSettings).toEqual({ spaceId: null, section: "audio" });
		expect(settings.__duvetShell).toMatchObject({ window: "settings", nativeButtons: false });
	});

	// Electrobun injects preloads into subframes on some platforms: an embedded page is told nothing.
	test("a frame inside the page is told nothing", () => {
		const frame = preloaded(settingsPreload({ window: "settings" }, "darwin"), { top: {} });
		expect(frame.__duvetSettings).toBeUndefined();
	});

	// What the page sent goes into a script: it stays data there.
	test("a value can't break out of the preload", () => {
		const spaceId = 's1"});window.hacked=true;({"a":"';
		const page = preloaded(
			settingsPreload({ window: "space-settings", spaceId, name: "x", section: "</script>" }, "linux"),
			topPage(),
		);
		expect(page.hacked).toBeUndefined();
		expect(page.__duvetSettings).toEqual({ spaceId, section: "</script>" });
	});
});

// C-09 of the redesign's review: a window is sent what its page mirrors, not everything the main window publishes.
describe("what a Settings window mirrors", () => {
	const shared = ["sync:user", "sync:mobileOnly", "sync:transfers", "sync:buckets", "sync:theme", "sync:audio"];

	test("Settings: the values the windows share, and no Space's own", () => {
		const mirrors = settingsMirrors({ window: "settings" });
		expect(shared.filter(mirrors)).toEqual(shared);
		expect(["sync:space:s1", "sync:bans:s1"].filter(mirrors)).toEqual([]);
	});

	test("a Space's settings: the shared values and that Space's, never another's", () => {
		const mirrors = settingsMirrors({ window: "space-settings", spaceId: "s1", name: "Tea" });
		expect(shared.filter(mirrors)).toEqual(shared);
		expect(["sync:space:s1", "sync:bans:s1"].filter(mirrors)).toEqual(["sync:space:s1", "sync:bans:s1"]);
		expect(["sync:space:s2", "sync:bans:s2", "sync:space:s10", "sync:bans:"].filter(mirrors)).toEqual([]);
	});

	test("neither takes the media controls' state, nor the pop-out's own channel", () => {
		for (const request of [
			{ window: "settings" as const },
			{ window: "space-settings" as const, spaceId: "s1", name: "Tea" },
		]) {
			expect(["media", "media-window", "settings", "settings:goto"].filter(settingsMirrors(request))).toEqual([]);
		}
	});

	test("a window joins the relay with its own channels", () => {
		const { windows, made, mirrored } = manager();
		windows.open({ window: "settings" });
		windows.open({ window: "space-settings", spaceId: "s1", name: "Tea" });
		made[0]?.ready();
		made[1]?.ready();
		const channels = ["sync:user", "sync:space:s1", "sync:space:s2", "media"];
		expect(channels.filter(mirrored.get(made[0]?.id ?? 0) ?? (() => true))).toEqual(["sync:user"]);
		expect(channels.filter(mirrored.get(made[1]?.id ?? 0) ?? (() => true))).toEqual(["sync:user", "sync:space:s1"]);
	});
});

/** The manager with windows that only record what's done to them. */
function manager(pages: SettingsWindowsDeps["pages"] = { settings: "settings", "space-settings": "space-settings" }) {
	const log: string[] = [];
	const made: (AppWindowSpec & {
		id: number;
		sent: WindowStateMessage[];
		ready: () => void;
		closed: () => void;
		/** Set for a window that closed without telling: Electrobun throws for one. */
		gone: boolean;
	})[] = [];
	const told: WindowCommand[] = [];
	const mirrors = new Set<number>();
	const mirrored = new Map<number, MirroredChannels>();
	const windows = new SettingsWindows({
		platform: "darwin",
		pages,
		mainFrame: () => ({ x: 100, y: 60, width: 1300, height: 860 }),
		displays: () => [laptop],
		create(spec) {
			const id = made.length + 2;
			const handlers: { ready: (() => void)[]; close: (() => void)[] } = { ready: [], close: [] };
			const record = {
				...spec,
				id,
				sent: [] as WindowStateMessage[],
				gone: false,
				ready: () => handlers.ready.forEach((handler) => handler()),
				closed: () => handlers.close.forEach((handler) => handler()),
			};
			made.push(record);
			const window: AppWindow = {
				id,
				focus: () => {
					if (record.gone) throw new Error(`No window ${id}`);
					log.push(`focus ${id}`);
				},
				// A window closes a moment after it's asked to, as Electrobun's do.
				close: () => {
					if (record.gone) throw new Error(`No window ${id}`);
					log.push(`close ${id}`);
				},
				setTitle: (title) => {
					if (record.gone) throw new Error(`No window ${id}`);
					log.push(`title ${id}: ${title}`);
				},
				send: (message) => record.sent.push(message),
				onReady: (handler) => handlers.ready.push(handler),
				onClose: (handler) => handlers.close.push(handler),
			};
			return window;
		},
		relay: {
			add: (id, send, channels) => {
				mirrors.add(id);
				mirrored.set(id, channels);
				send({ channel: "sync:user", epoch: 1, seq: 1, sentAt: 0, value: { id: "u1" } });
			},
			remove: (id) => mirrors.delete(id),
		},
		tellMain: (command) => told.push(command),
		focusMain: () => log.push("focus main"),
		now: () => 1000,
	});
	return { windows, made, log, told, mirrors, mirrored };
}

describe("the Settings windows", () => {
	test("Settings opens in a window of its own, with its page, title, size and chrome", () => {
		const { windows, made } = manager();
		expect(windows.open({ window: "settings" })).toBe(true);
		expect(made).toHaveLength(1);
		expect(made[0]).toMatchObject({
			kind: "settings",
			page: "settings",
			title: "Duvet settings",
			frame: { x: 320, y: 180, width: 860, height: 620 },
			titleBarStyle: "hiddenInset",
			nativeButtons: true,
		});
		expect(windows.count).toBe(1);
	});

	test("asking for the open one brings it forward instead of making another", () => {
		const { windows, made, log } = manager();
		windows.open({ window: "settings" });
		windows.open({ window: "settings" });
		expect(made).toHaveLength(1);
		expect(log).toEqual(["focus 2"]);
	});

	test("an open window asked for a section is told to show it", () => {
		const { windows, made } = manager();
		windows.open({ window: "settings" });
		windows.open({ window: "settings", section: "appearance" });
		windows.open({ window: "settings", section: "audio" });
		const goto = (seq: number, section: string) => ({
			channel: "settings:goto",
			epoch: 1000,
			seq,
			sentAt: 1000,
			value: { spaceId: null, section },
		});
		expect(made[0].sent).toEqual([goto(1, "appearance"), goto(2, "audio")]);
	});

	test("each Space has its own window, a step down and right of the last", () => {
		const { windows, made } = manager();
		windows.open({ window: "settings" });
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		windows.open({ window: "space-settings", spaceId: "s2", name: "Kiln & Clay" });
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		expect(made.map((spec) => spec.title)).toEqual([
			"Duvet settings",
			"Harbour Lights · Space settings",
			"Kiln & Clay · Space settings",
		]);
		expect(made[1].frame).toEqual({ x: 308, y: 188, width: 940, height: 660 });
		expect(made[2].frame).toEqual({ x: 336, y: 216, width: 940, height: 660 });
	});

	test("a window mirrors the main one once its page can take messages, and again after a reload", () => {
		const { windows, made, mirrors } = manager();
		windows.open({ window: "settings" });
		expect(mirrors.size).toBe(0);
		made[0].ready();
		expect([...mirrors]).toEqual([2]);
		expect(made[0].sent.map((message) => message.channel)).toEqual(["sync:user"]);
		made[0].ready();
		expect(made[0].sent).toHaveLength(2);
	});

	test("closing one gives the main window the focus back, leaves the relay and tells the main window", () => {
		const { windows, made, log, told, mirrors } = manager();
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		made[0].ready();
		made[0].closed();
		expect(log).toEqual(["focus main"]);
		expect(mirrors.size).toBe(0);
		expect(told).toEqual([{ channel: "settings", name: "closed", args: { window: "space-settings", spaceId: "s1" } }]);
		expect(windows.count).toBe(0);
		// The next request makes a new one.
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		expect(made).toHaveLength(2);
	});

	test("closing them all, with the main window, gives no focus back, however late each one closes", () => {
		const { windows, made, log } = manager();
		windows.open({ window: "settings" });
		windows.open({ window: "space-settings", spaceId: "s1", name: "A" });
		windows.closeAll();
		expect(log).toEqual(["close 2", "close 3"]);
		made[0].closed();
		made[1].closed();
		expect(log).toEqual(["close 2", "close 3"]);
		expect(windows.count).toBe(0);
	});

	// C-12 of the redesign's review, (b): Electrobun throws for a window that is already gone, and the manager trusted
	// both the handle and the close event.
	test("closing them all leaves the relay at once, and a window already gone stops none of it", () => {
		const { windows, made, log, mirrors } = manager();
		windows.open({ window: "settings" });
		windows.open({ window: "space-settings", spaceId: "s1", name: "A" });
		windows.open({ window: "space-settings", spaceId: "s2", name: "B" });
		for (const window of made) window.ready();
		expect(mirrors.size).toBe(3);
		made[1].gone = true;
		expect(() => windows.closeAll()).not.toThrow();
		expect(log).toEqual(["close 2", "close 4"]);
		// No close event has come, and none is waited for.
		expect(mirrors.size).toBe(0);
		expect(windows.count).toBe(0);
	});

	test("asking for a window that turns out to be gone makes a new one", () => {
		const { windows, made, log, mirrors, told } = manager();
		windows.open({ window: "settings" });
		made[0].ready();
		made[0].gone = true;
		expect(windows.open({ window: "settings", section: "audio" })).toBe(true);
		expect(made).toHaveLength(2);
		expect(windows.count).toBe(1);
		expect([...mirrors]).toEqual([]);
		// The old one's close event, should it still come, is not the new window's.
		made[0].closed();
		expect(windows.count).toBe(1);
		expect(told).toEqual([]);
		expect(log).toEqual([]);
	});

	// C-20: a section asked for before the window's page listened reached nobody.
	test("a section asked for while the page loads is told again once it listens", () => {
		const { windows, made } = manager();
		windows.open({ window: "settings" });
		windows.open({ window: "settings", section: "appearance" });
		windows.open({ window: "settings", section: "audio" });
		made[0].ready();
		const sections = made[0].sent
			.filter((message) => message.channel === "settings:goto")
			.map((message) => message.value);
		expect(sections.at(-1)).toEqual({ spaceId: null, section: "audio" });
		const seqs = made[0].sent.filter((message) => message.channel === "settings:goto").map((message) => message.seq);
		expect(seqs).toEqual([1, 2, 3]);
		// Once, not with every later load.
		made[0].ready();
		expect(made[0].sent.filter((message) => message.channel === "settings:goto")).toHaveLength(3);
	});

	test("opens nothing for a request that names no window, or a window whose page isn't built", () => {
		const { windows, made } = manager({ settings: "settings" });
		expect(windows.open({ window: "media" })).toBe(false);
		expect(windows.open(null)).toBe(false);
		expect(windows.open({ window: "space-settings", spaceId: "s1", name: "A" })).toBe(false);
		expect(made).toHaveLength(0);
	});
});

// C-12 of the redesign's review, (a): the windows closed on the main page's dom-ready, which is its `load` event. The
// app is in use before that fires, and Settings opened in between closed a moment later.
describe("when the main window's page changes", () => {
	const published = (epoch: number, seq = 1): WindowStateMessage => ({
		channel: "sync:user",
		epoch,
		seq,
		sentAt: epoch + seq,
		value: { id: "u1" },
	});
	const APP = "views://mainview/app.html";

	test("the app's page finishing its load closes nothing", () => {
		const { windows, log } = manager();
		windows.stateFromMain(published(1000));
		windows.open({ window: "settings" });
		// did-navigate came as the page started; dom-ready comes with its `load`, after Settings was opened.
		windows.mainNavigated(APP);
		windows.mainNavigated("http://localhost:5173/app");
		windows.stateFromMain(published(1000, 2));
		expect(log).toEqual([]);
		expect(windows.count).toBe(1);
	});

	test("leaving the app's page, which is signing out, closes them all", () => {
		const { windows, log, mirrors } = manager();
		windows.stateFromMain(published(1000));
		windows.open({ window: "settings" });
		windows.open({ window: "space-settings", spaceId: "s1", name: "A" });
		windows.mainNavigated("views://mainview/sign-in.html");
		expect(log).toEqual(["close 2", "close 3"]);
		expect(windows.count).toBe(0);
		expect(mirrors.size).toBe(0);
	});

	test("the app's page loading again closes the windows of the page before, as its first state arrives", () => {
		const { windows, made, log } = manager();
		windows.stateFromMain(published(1000));
		windows.open({ window: "settings" });
		made[0].ready();
		// A reload: the new page publishes as it starts.
		windows.stateFromMain(published(2000));
		expect(log).toEqual(["close 2"]);
		expect(windows.count).toBe(0);
		// Settings opened on the new page stays, through the rest of its states and its `load`.
		windows.open({ window: "settings" });
		windows.stateFromMain(published(2000, 2));
		windows.mainNavigated(APP);
		expect(log).toEqual(["close 2"]);
		expect(windows.count).toBe(1);
	});

	test("a window opened before its page published anything is that page's", () => {
		const { windows, log } = manager();
		windows.open({ window: "settings" });
		windows.stateFromMain(published(1000));
		windows.stateFromMain(published(1000, 2));
		expect(log).toEqual([]);
		windows.stateFromMain(published(2000));
		expect(log).toEqual(["close 2"]);
	});

	test("a window closed for the page gives no focus back, and its close event tells nobody", () => {
		const { windows, made, log, told } = manager();
		windows.stateFromMain(published(1000));
		windows.open({ window: "space-settings", spaceId: "s1", name: "A" });
		windows.stateFromMain(published(2000));
		made[0].closed();
		expect(log).toEqual(["close 2"]);
		expect(told).toEqual([]);
	});
});

// From the Windows builder's hand-back: a Space renamed while its settings were open kept the old name in the
// window's title (Mission Control, the taskbar, Alt-Tab) until the window was closed and opened again.
describe("a Space's settings window's title", () => {
	const space = (spaceId: string, name: string, seq: number, more: object = {}): WindowStateMessage => ({
		channel: `sync:space:${spaceId}`,
		epoch: 1000,
		seq,
		sentAt: 1000 + seq,
		value: { id: spaceId, name, ...more },
	});

	test("follows the Space's name as the main window shares it", () => {
		const { windows, made, log } = manager();
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		expect(made[0].title).toBe("Harbour Lights · Space settings");
		windows.stateFromMain(space("s1", "Harbour Lights", 1));
		expect(log).toEqual([]);
		windows.stateFromMain(space("s1", "Harbour Lanterns", 2));
		expect(log).toEqual(["title 2: Harbour Lanterns · Space settings"]);
	});

	test("is set once for a name, however often the Space is shared again", () => {
		const { windows, log } = manager();
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		// The Space is published with every presence update of its members.
		for (let seq = 1; seq <= 20; seq++) windows.stateFromMain(space("s1", "Harbour Lanterns", seq, { online: seq }));
		expect(log).toEqual(["title 2: Harbour Lanterns · Space settings"]);
	});

	test("is only that Space's window's: not another Space's, nor Settings' own", () => {
		const { windows, log } = manager();
		windows.open({ window: "settings" });
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		windows.open({ window: "space-settings", spaceId: "s2", name: "Kiln & Clay" });
		windows.stateFromMain(space("s2", "Kiln, Clay & Glaze", 1));
		windows.stateFromMain(space("s3", "Elsewhere", 1));
		expect(log).toEqual(["title 4: Kiln, Clay & Glaze · Space settings"]);
	});

	test("a Space with no name left is called Space, and a state that isn't a Space changes nothing", () => {
		const { windows, log } = manager();
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		windows.stateFromMain({ channel: "sync:space:s1", epoch: 1000, seq: 1, sentAt: 0, value: null });
		windows.stateFromMain({ channel: "sync:bans:s1", epoch: 1000, seq: 1, sentAt: 0, value: { name: "x" } });
		expect(log).toEqual([]);
		windows.stateFromMain(space("s1", "", 2));
		expect(log).toEqual(["title 2: Space · Space settings"]);
	});

	test("a window that is going keeps its title, and nothing breaks", () => {
		const { windows, made } = manager();
		windows.open({ window: "space-settings", spaceId: "s1", name: "Harbour Lights" });
		made[0].gone = true;
		expect(() => windows.stateFromMain(space("s1", "Harbour Lanterns", 1))).not.toThrow();
	});
});
