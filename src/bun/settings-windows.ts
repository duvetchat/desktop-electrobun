// The Settings windows (#357, docs/redesign/DESIGN-MAP.md S-47, S-58): in the desktop app, Settings and each Space's
// settings open in a window of their own, as native apps' do. There is one Settings window and one per Space: asking
// for an open one brings it forward, at the section asked for. Each loads its own page (lib/app-windows.ts), mirrors
// the main window through the relay (window-relay.ts) and, as it closes, gives the main window the focus back.
//
// What makes a window is the caller's (settings-window-native.ts, which needs Electrobun): this file decides which
// windows there are, where each opens and what it is told, so it can be tested.
import { t } from "./i18n";
import { isAppPage } from "./navigation";
import { shellPreload, windowChrome, type TitleBarStyle, type WindowChrome, type WindowKind } from "./shell";
import { displayOf, type DisplayArea, type Rect } from "./window-frame";
import type { MirroredChannels, WindowCommand, WindowStateMessage } from "./window-relay";

/** What the main window's page asks for (bun.messages.openAppWindow; lib/settings-windows.ts has its page-side twin). */
export type OpenAppWindow =
	| { window: "settings"; section?: string }
	| { window: "space-settings"; spaceId: string; name: string; section?: string };

/** The request as the page sent it, or null for anything else. */
export function parseOpenAppWindow(value: unknown): OpenAppWindow | null {
	if (typeof value !== "object" || value === null) return null;
	const fields: Record<string, unknown> = { ...value };
	const section = typeof fields.section === "string" && fields.section ? { section: fields.section } : {};
	if (fields.window === "settings") return { window: "settings", ...section };
	if (fields.window !== "space-settings") return null;
	if (typeof fields.spaceId !== "string" || !fields.spaceId) return null;
	const name = typeof fields.name === "string" ? fields.name : "";
	return { window: "space-settings", spaceId: fields.spaceId, name, ...section };
}

/** One window per key: Settings', and each Space's. */
export const windowKey = (request: OpenAppWindow) =>
	request.window === "settings" ? "settings" : `space:${request.spaceId}`;

/** The window's title, which the system shows in Mission Control, the taskbar and Alt-Tab (COPY.md §4.10), in the
 * language Bun speaks now (i18n.ts). */
export function windowTitle(request: OpenAppWindow): string {
	if (request.window === "settings") return t("window_settings");
	return request.name ? t("window_space_settings", { name: request.name }) : t("window_space_settings_unnamed");
}

/** What a Settings window's page mirrors of what the main window publishes: the values the windows share
 * (lib/settings-windows.ts: syncChannel), a Space's own only in that Space's window. The media controls' state is the
 * pop-out's, and another Space's settings are another window's. */
export function settingsMirrors(request: OpenAppWindow): MirroredChannels {
	const ofSpace = /^sync:(?:space|bans):(.*)$/;
	const spaceId = request.window === "space-settings" ? request.spaceId : null;
	return (channel) => {
		if (!channel.startsWith("sync:")) return false;
		const space = ofSpace.exec(channel);
		return space === null || space[1] === spaceId;
	};
}

/** The design's sizes: roomier than the first sheet, for the larger Settings scale. */
const SIZES: Record<OpenAppWindow["window"], { width: number; height: number }> = {
	settings: { width: 980, height: 720 },
	"space-settings": { width: 1060, height: 760 },
};
/** What a window leaves free of its display, each way. */
const MARGIN = 80;
/** How far each further window opens down and right of the last. */
const CASCADE = 28;

/**
 * Where a Settings window opens: at its design size, or the display's work area less a margin if that is smaller,
 * centred over the main window, each further one a step down and right, and always whole inside the work area of the
 * display the main window is on.
 */
export function settingsFrame(kind: OpenAppWindow["window"], main: Rect, displays: DisplayArea[], cascade = 0): Rect {
	const area = displayOf(displays, main)?.workArea ?? main;
	const width = Math.min(SIZES[kind].width, Math.max(area.width - MARGIN, 1));
	const height = Math.min(SIZES[kind].height, Math.max(area.height - MARGIN, 1));
	const step = CASCADE * cascade;
	const x = Math.round(main.x + (main.width - width) / 2) + step;
	const y = Math.round(main.y + (main.height - height) / 2) + step;
	return {
		x: Math.min(Math.max(x, area.x), area.x + area.width - width),
		y: Math.min(Math.max(y, area.y), area.y + area.height - height),
		width,
		height,
	};
}

/** A Settings window's chrome: on macOS a transparent title bar with the system's traffic lights over the page's
 * side panel (a window with none can't take keys there: window-keys.ts); elsewhere none, the page drawing its own. */
export function settingsChrome(platform: string): WindowChrome {
	return windowChrome(platform);
}

/** The window's preload: its shell (shell.ts), and which Space and section its page shows (window.__duvetSettings). */
export function settingsPreload(request: OpenAppWindow, platform: string): string {
	const kind: WindowKind = request.window;
	const args = {
		spaceId: request.window === "space-settings" ? request.spaceId : null,
		section: request.section ?? null,
	};
	return (
		shellPreload(kind, settingsChrome(platform), platform) +
		`\nif (window.top === window) window.__duvetSettings = Object.freeze(${JSON.stringify(args)});`
	);
}

/** What the manager asks for a window to be made. */
export interface AppWindowSpec {
	kind: OpenAppWindow["window"];
	/** The page it loads, by its route's name (lib/app-windows.ts). */
	page: string;
	title: string;
	frame: Rect;
	titleBarStyle: TitleBarStyle;
	nativeButtons: boolean;
	preload: string;
}

/** A window as the manager uses it. */
export interface AppWindow {
	id: number;
	/** Brings it forward, out of the dock or the taskbar if it was there. */
	focus(): void;
	close(): void;
	/** Names the window anew, where the system shows its name. */
	setTitle(title: string): void;
	/** Sends its page a state. */
	send(message: WindowStateMessage): void;
	/** Calls back each time its page says it listens: as it loads, and again if it loads again. */
	onReady(handler: () => void): void;
	/** Calls back once it has closed. */
	onClose(handler: () => void): void;
}

export interface SettingsWindowsDeps {
	platform: string;
	/** Each window's page. */
	pages: Partial<Record<OpenAppWindow["window"], string>>;
	create(spec: AppWindowSpec): AppWindow;
	mainFrame(): Rect;
	displays(): DisplayArea[];
	/** The relay's own: a window joins once its page can take messages, and leaves as it closes. */
	relay: {
		add(windowId: number, send: (message: WindowStateMessage) => void, mirrors: MirroredChannels): void;
		remove(windowId: number): void;
	};
	/** Tells the main window's page something, without waiting for its answer. */
	tellMain(command: WindowCommand): void;
	focusMain(): void;
	now?: () => number;
}

/** The channel that tells an open window which section to show (lib/settings-windows.ts: GOTO_CHANNEL). */
export const GOTO_CHANNEL = "settings:goto";
/** The channel of what the main window is told (lib/settings-windows.ts: SETTINGS_CHANNEL). */
export const SETTINGS_CHANNEL = "settings";

/** A window the manager has open. */
interface OpenWindow {
	window: AppWindow;
	/** The main window's page it was opened for, by its epoch; null before that page published anything. */
	epoch: number | null;
	/** Whether its page listens yet. */
	ready: boolean;
	/** The section asked for last while it didn't: sent again once it does. */
	goto: OpenAppWindow | null;
	/** What it was asked for, and the title the window has now. */
	request: OpenAppWindow;
	title: string;
}

/** The Space a state of the main window's is, when it is one: the Space as its settings window mirrors it
 * (lib/settings-windows.ts: spaceKey), with its name. */
function sharedSpace(message: WindowStateMessage): { spaceId: string; name: string } | null {
	const spaceId = /^sync:space:(.+)$/.exec(message.channel)?.[1];
	const value = message.value;
	if (!spaceId || typeof value !== "object" || value === null || !("name" in value)) return null;
	return typeof value.name === "string" ? { spaceId, name: value.name } : null;
}

export class SettingsWindows {
	readonly #deps: SettingsWindowsDeps;
	readonly #open = new Map<string, OpenWindow>();
	readonly #epoch: number;
	#seq = 0;
	/** The epoch of the main window's page, as its states carry it (lib/window-link.ts). */
	#mainEpoch: number | null = null;

	constructor(deps: SettingsWindowsDeps) {
		this.#deps = deps;
		this.#epoch = (deps.now ?? Date.now)();
	}

	/** How many Settings windows are open. */
	get count(): number {
		return this.#open.size;
	}

	/** Opens the window a request names, or brings the open one forward, at the section asked for. False for a request
	 * that names none, or a window whose page isn't built. */
	open(value: unknown): boolean {
		const request = parseOpenAppWindow(value);
		if (!request) return false;
		const page = this.#deps.pages[request.window];
		if (!page) return false;
		const key = windowKey(request);
		const existing = this.#open.get(key);
		if (existing && this.#bringForward(key, existing, request)) return true;
		const title = windowTitle(request);
		const window = this.#deps.create({
			kind: request.window,
			page,
			title,
			frame: settingsFrame(request.window, this.#deps.mainFrame(), this.#deps.displays(), this.#open.size),
			...settingsChrome(this.#deps.platform),
			preload: settingsPreload(request, this.#deps.platform),
		});
		const opened: OpenWindow = { window, epoch: this.#mainEpoch, ready: false, goto: null, request, title };
		this.#open.set(key, opened);
		const mirrors = settingsMirrors(request);
		window.onReady(() => {
			if (this.#open.get(key) !== opened) return;
			this.#deps.relay.add(window.id, (message) => window.send(message), mirrors);
			opened.ready = true;
			// A section asked for while the page loaded reached nobody: the page opened on the one it was made with.
			if (opened.goto) window.send(this.#goto(opened.goto));
			opened.goto = null;
		});
		window.onClose(() => {
			// One this closed itself was let go of as it was asked to close: only a window the person closed is here.
			if (this.#open.get(key) !== opened) return;
			this.#forget(key, opened);
			this.#deps.tellMain({
				channel: SETTINGS_CHANNEL,
				name: "closed",
				args: { window: request.window, spaceId: request.window === "space-settings" ? request.spaceId : null },
			});
			this.#deps.focusMain();
		});
		return true;
	}

	/** Every state the main window's page publishes passes here, for its epoch: a state of another epoch is another
	 * page's, the main window loaded again (a reload, a sign-in). The windows opened for the page before show what
	 * that one shared, and close. The page's first states come as it starts, long before its `load` event, which a
	 * window opened in between would not survive. */
	stateFromMain(message: WindowStateMessage) {
		if (message.epoch !== this.#mainEpoch) {
			this.#mainEpoch = message.epoch;
			for (const [key, opened] of [...this.#open]) {
				// One opened before its page had published anything is that page's.
				if (opened.epoch === null) opened.epoch = message.epoch;
				else if (opened.epoch !== message.epoch) this.#close(key, opened);
			}
		}
		this.#retitle(message);
	}

	/** The app's language changed (i18n.ts): every window is titled again, in it. */
	retitle(): void {
		for (const opened of this.#open.values()) this.#setTitle(opened);
	}

	// A Space renamed while its settings are open: the window takes the new name at once, as its page's own title
	// does. The title was the name the Space had as the window opened, until it was closed and opened again.
	#retitle(message: WindowStateMessage) {
		const space = sharedSpace(message);
		if (!space) return;
		const opened = this.#open.get(windowKey({ window: "space-settings", spaceId: space.spaceId, name: space.name }));
		if (!opened || opened.request.window !== "space-settings") return;
		// The name the window goes by from now on, in this language and the next.
		opened.request = { ...opened.request, name: space.name };
		this.#setTitle(opened);
	}

	// The Space is published with every change of it, its members' presence among them: only a title that changes is
	// set. A window that is going keeps the title it had.
	#setTitle(opened: OpenWindow) {
		const title = windowTitle(opened.request);
		if (title === opened.title) return;
		try {
			opened.window.setTitle(title);
			opened.title = title;
		} catch {
			// Gone, or going.
		}
	}

	/** The main window's page is at another address: off the app's page (signed out), every Settings window goes. */
	mainNavigated(url: string) {
		if (!isAppPage(url)) this.closeAll();
	}

	/** Closes every Settings window: the main window is closing, or its page left the app. None of them gives the
	 * focus back, nor is the main window's page told. */
	closeAll(): void {
		for (const [key, opened] of [...this.#open]) this.#close(key, opened);
	}

	// Brings an open window forward, at the section asked for. False when it turns out to be gone: Electrobun throws
	// for a window that closed without its close event reaching here, and the caller makes a new one.
	#bringForward(key: string, opened: OpenWindow, request: OpenAppWindow): boolean {
		try {
			opened.window.focus();
			if (request.section) {
				opened.window.send(this.#goto(request));
				// A page that doesn't listen yet takes nothing: it is told again once it does.
				if (!opened.ready) opened.goto = request;
			}
			return true;
		} catch {
			this.#forget(key, opened);
			return false;
		}
	}

	// Closes a window from here. It is let go of first, so nothing waits for its close event (which may not come for a
	// close asked from Bun, or come late) and a window that is already gone, for which Electrobun throws, stops
	// nothing: not the other windows' closing, nor the main window's own.
	#close(key: string, opened: OpenWindow) {
		this.#forget(key, opened);
		try {
			opened.window.close();
		} catch {
			// Already gone.
		}
	}

	#forget(key: string, opened: OpenWindow) {
		if (this.#open.get(key) === opened) this.#open.delete(key);
		this.#deps.relay.remove(opened.window.id);
	}

	#goto(request: OpenAppWindow): WindowStateMessage {
		return {
			channel: GOTO_CHANNEL,
			epoch: this.#epoch,
			seq: ++this.#seq,
			sentAt: (this.#deps.now ?? Date.now)(),
			value: {
				spaceId: request.window === "space-settings" ? request.spaceId : null,
				section: request.section ?? null,
			},
		};
	}
}
