// The Settings windows (#357, docs/redesign/DESIGN-MAP.md S-47, S-58): in the desktop app, Settings and each Space's
// settings open in a window of their own, as native apps' do. There is one Settings window and one per Space: asking
// for an open one brings it forward, at the section asked for. Each loads its own page (lib/app-windows.ts), mirrors
// the main window through the relay (window-relay.ts) and, as it closes, gives the main window the focus back.
//
// What makes a window is the caller's (settings-window-native.ts, which needs Electrobun): this file decides which
// windows there are, where each opens and what it is told, so it can be tested.
import { shellPreload, type TitleBarStyle, type WindowKind } from "./shell";
import { displayOf, type DisplayArea, type Rect } from "./window-frame";
import type { WindowCommand, WindowStateMessage } from "./window-relay";

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

/** The window's title, which the system shows in Mission Control, the taskbar and Alt-Tab (COPY.md §4.10). */
export const windowTitle = (request: OpenAppWindow) =>
	request.window === "settings" ? "Duvet settings" : `${request.name || "Space"} · Space settings`;

/** The design's sizes. */
const SIZES: Record<OpenAppWindow["window"], { width: number; height: number }> = {
	settings: { width: 860, height: 620 },
	"space-settings": { width: 940, height: 660 },
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
export function settingsChrome(platform: string): { titleBarStyle: TitleBarStyle; nativeButtons: boolean } {
	return platform === "darwin"
		? { titleBarStyle: "hiddenInset", nativeButtons: true }
		: { titleBarStyle: "hidden", nativeButtons: false };
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
	/** Sends its page a state. */
	send(message: WindowStateMessage): void;
	/** Calls back each time its page can take messages. */
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
	relay: { add(windowId: number, send: (message: WindowStateMessage) => void): void; remove(windowId: number): void };
	/** Tells the main window's page something, without waiting for its answer. */
	tellMain(command: WindowCommand): void;
	focusMain(): void;
	now?: () => number;
}

/** The channel that tells an open window which section to show (lib/settings-windows.ts: GOTO_CHANNEL). */
export const GOTO_CHANNEL = "settings:goto";
/** The channel of what the main window is told (lib/settings-windows.ts: SETTINGS_CHANNEL). */
export const SETTINGS_CHANNEL = "settings";

export class SettingsWindows {
	readonly #deps: SettingsWindowsDeps;
	readonly #open = new Map<string, AppWindow>();
	readonly #epoch: number;
	#seq = 0;
	// The windows closeAll closes: none of them gives the focus back, as the main window is closing or its page left.
	readonly #closedWithMain = new Set<AppWindow>();

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
		if (existing) {
			existing.focus();
			if (request.section) existing.send(this.#goto(request));
			return true;
		}
		const window = this.#deps.create({
			kind: request.window,
			page,
			title: windowTitle(request),
			frame: settingsFrame(request.window, this.#deps.mainFrame(), this.#deps.displays(), this.#open.size),
			...settingsChrome(this.#deps.platform),
			preload: settingsPreload(request, this.#deps.platform),
		});
		this.#open.set(key, window);
		window.onReady(() => this.#deps.relay.add(window.id, (message) => window.send(message)));
		window.onClose(() => {
			if (this.#open.get(key) !== window) return;
			this.#open.delete(key);
			this.#deps.relay.remove(window.id);
			this.#deps.tellMain({
				channel: SETTINGS_CHANNEL,
				name: "closed",
				args: { window: request.window, spaceId: request.window === "space-settings" ? request.spaceId : null },
			});
			if (!this.#closedWithMain.delete(window)) this.#deps.focusMain();
		});
		return true;
	}

	/** Closes every Settings window: the main window is closing, or its page went elsewhere (a sign-out, a reload), and
	 * they show what it shares. */
	closeAll(): void {
		for (const window of [...this.#open.values()]) {
			this.#closedWithMain.add(window);
			window.close();
		}
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
