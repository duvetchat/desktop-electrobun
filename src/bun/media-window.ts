// The media controls' pop-out window (#357, BRIEF.md "Media controls", docs/redesign/PLATFORM.md §3 to §8): a small
// window of its own holding the media controls, on the desktop app only. The call never leaves the main window: the
// gateway, WebRTC and the microphone stay in its page. This window's page mirrors the controls' state, which the relay
// sends it (window-relay.ts), and its commands go to the main window's page through here.
//
// The main window's page says whether it wants the window, as a state of the "media-window" channel
// (src/mainview/src/lib/media-window.ts): this opens or closes it to match, brings it forward when asked, tells the
// main page when it opened or closed, keeps its frame and its pin on this device, and closes it with the main window,
// or when that window leaves the app's page (signing out). Electrobun is handed in (media-window-open.ts makes the real
// window), so this runs in tests.
import { isAppPage } from "./navigation";
import { windowChrome, type WindowChrome } from "./shell";
import { displayOf, rectOf, type DisplayArea, type Rect } from "./window-frame";
import type { MirroredChannels, WindowAnswer, WindowCommand, WindowStateMessage } from "./window-relay";

/** The channel of the window itself: the main page's wish for it, and the commands about it. */
export const MEDIA_WINDOW_CHANNEL = "media-window";
/** The channel of the media controls: their state, and the commands the pop-out sends the main page. */
export const MEDIA_CHANNEL = "media";
/** The window's title bar, which is every window's of the app (shell.ts): on macOS the system's own lights over a
 * transparent bar, which also lets the window take the keyboard (window-keys.ts); elsewhere none, the page drawing
 * its close button (routes/voice-controls). */
export function mediaWindowTitleBar(platform: string): WindowChrome {
	return windowChrome(platform);
}

/** What the pop-out's page mirrors: the media controls' state, and nothing else the main window publishes. */
export const mediaWindowMirrors: MirroredChannels = (channel) => channel === MEDIA_CHANNEL;
/** The media commands that need the main window in front: the system's screen picker opens over it, and the voice room
 * or call opens in it. */
export const COMMANDS_THAT_SHOW_MAIN: readonly string[] = ["shareScreen", "openPlace"];

/** The window's size the first time: the call panel's, with the window's own strip. */
export const DEFAULT_SIZE = { width: 320, height: 168 };
/** The smallest it is put back at: the one row and the strip. */
export const MIN_SIZE = { width: 260, height: 96 };
/** How far from the main window's bottom left corner it first opens. */
const FIRST_INSET = 24;
/** A move or a resize is kept once it has rested this long. */
export const KEEP_AFTER_MS = 300;

/** What is kept of the window on this device. */
export interface MediaWindowPrefs {
	frame: Rect | null;
	pinned: boolean;
}

/** The kept prefs as their file has them; anything unreadable is no prefs, never an error. */
export function parsePrefs(text: string | null): MediaWindowPrefs {
	const none: MediaWindowPrefs = { frame: null, pinned: false };
	if (!text) return none;
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null) return none;
		return {
			frame: "frame" in value ? rectOf(value.frame) : null,
			pinned: "pinned" in value && value.pinned === true,
		};
	} catch {
		return none;
	}
}

/**
 * Where the window opens. The frame kept from last time, moved onto the display it overlaps most and made to fit its
 * work area: a display that is gone (a dock unplugged) or a smaller one never leaves it off screen. The first time, by
 * the main window's bottom left corner, on the main window's display.
 */
export function placeMediaWindow(saved: Rect | null, displays: DisplayArea[], main: Rect | null): Rect {
	const wanted: Rect = saved ?? {
		x: (main?.x ?? 0) + FIRST_INSET,
		y: main ? main.y + main.height - DEFAULT_SIZE.height - FIRST_INSET : FIRST_INSET,
		...DEFAULT_SIZE,
	};
	const sized = {
		...wanted,
		width: Math.max(Math.round(wanted.width), MIN_SIZE.width),
		height: Math.max(Math.round(wanted.height), MIN_SIZE.height),
	};
	const area = displayOf(displays, sized)?.workArea;
	if (!area) return sized;
	const width = Math.min(sized.width, area.width);
	const height = Math.min(sized.height, area.height);
	return {
		x: Math.round(Math.min(Math.max(sized.x, area.x), area.x + area.width - width)),
		y: Math.round(Math.min(Math.max(sized.y, area.y), area.y + area.height - height)),
		width,
		height,
	};
}

/** The main page's wish as it crossed the RPC, or null. */
function parseWish(value: unknown): { open: boolean; shown: number } | null {
	if (typeof value !== "object" || value === null || !("open" in value) || !("shown" in value)) return null;
	const { open, shown } = value;
	return typeof open === "boolean" && typeof shown === "number" ? { open, shown } : null;
}

/** The parts of the pop-out's window this drives (media-window-open.ts wraps Electrobun's BrowserWindow). */
export interface MediaWindowHandle {
	id: number;
	focus(): void;
	close(): void;
	getFrame(): Rect;
	setAlwaysOnTop(on: boolean): void;
	/** Sends its page a state to mirror. */
	send(message: WindowStateMessage): void;
	/** "ready" is its page able to take messages; "close" the window gone, however it went. */
	on(event: "ready" | "close" | "move" | "resize", handler: () => void): void;
}

export interface MediaWindowDeps {
	/** Makes the window at a frame, pinned or not. Its page's commands come back through commandFromWindow. */
	create(frame: Rect, pinned: boolean): MediaWindowHandle;
	displays(): DisplayArea[];
	/** The main window's frame, or null once it is gone. */
	mainFrame(): Rect | null;
	/** Brings the main window forward, out of the Dock or the taskbar if it was there. */
	focusMain(): void;
	relay: {
		add(windowId: number, send: (message: WindowStateMessage) => void, mirrors: MirroredChannels): void;
		remove(windowId: number): void;
		commandFromWindow(command: WindowCommand): Promise<WindowAnswer>;
	};
	readPrefs(): string | null;
	writePrefs(text: string): void;
	log?: (line: string) => void;
	now?: () => number;
	/** A timer's start and its stop, for tests: setTimeout and clearTimeout otherwise. */
	later?: (run: () => void, ms: number) => () => void;
}

const laterByTimeout = (run: () => void, ms: number) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

export class MediaWindows {
	readonly #deps: MediaWindowDeps;
	readonly #log: (line: string) => void;
	readonly #now: () => number;
	#window: MediaWindowHandle | null = null;
	#prefs: MediaWindowPrefs;
	#shown = 0;
	#stopKeeping: (() => void) | null = null;
	/** The window is being closed from here, for the main page: the page isn't told what it asked for. */
	#closing = false;

	constructor(deps: MediaWindowDeps) {
		this.#deps = deps;
		this.#log = deps.log ?? (() => {});
		this.#now = deps.now ?? (() => performance.now());
		this.#prefs = parsePrefs(deps.readPrefs());
	}

	/** Whether the window is open. */
	get open(): boolean {
		return this.#window !== null;
	}

	/** Every state the main page publishes passes here: its wish for the window is acted on, the rest is the relay's. */
	stateFromMain(message: WindowStateMessage) {
		if (message.channel !== MEDIA_WINDOW_CHANNEL) return;
		const wish = parseWish(message.value);
		if (!wish) return;
		if (!wish.open) {
			this.#shown = wish.shown;
			this.#close("the main window put the controls back");
			return;
		}
		if (!this.#window) this.#open();
		else if (wish.shown > this.#shown) this.#window.focus();
		this.#shown = wish.shown;
	}

	/** A command from the pop-out's page: one about the window is answered here, any other goes to the main page. */
	async commandFromWindow(command: WindowCommand): Promise<WindowAnswer> {
		if (command.channel === MEDIA_WINDOW_CHANNEL) return this.#windowCommand(command);
		const front = command.channel === MEDIA_CHANNEL && COMMANDS_THAT_SHOW_MAIN.includes(command.name);
		if (front) this.#deps.focusMain();
		const sent = this.#now();
		const answer = await this.#deps.relay.commandFromWindow(command);
		this.#log(
			`relayed ${command.channel}.${command.name} to the main window in ${(this.#now() - sent).toFixed(1)} ms: ` +
				(answer.ok ? "ok" : answer.error) +
				(front ? "; the main window was brought forward" : ""),
		);
		return answer;
	}

	/** The main window's page went to another address: off the app's page (signed out), the pop-out goes. */
	mainNavigated(url: string) {
		if (!isAppPage(url)) this.#close("the main window left the app's page");
	}

	/** The main window closed: the pop-out closes with it. */
	mainClosed() {
		this.#close("the main window closed");
	}

	#windowCommand(command: WindowCommand): WindowAnswer {
		switch (command.name) {
			case "info":
				return { ok: true, result: { pinned: this.#prefs.pinned } };
			case "hello": {
				// Its page can take messages now. The window's own "ready" may come before the page listens, and a state
				// sent then is lost: the latest of each channel is sent again, which a mirror that has it drops.
				const window = this.#window;
				if (window) {
					this.#deps.relay.remove(window.id);
					this.#deps.relay.add(window.id, (message) => window.send(message), mediaWindowMirrors);
				}
				return { ok: true, result: { pinned: this.#prefs.pinned } };
			}
			case "pin": {
				if (typeof command.args !== "boolean") return { ok: false, error: "pin takes on or off" };
				try {
					this.#window?.setAlwaysOnTop(command.args);
				} catch (err) {
					// The window stays as it was, and so does what is kept and what its page shows.
					const why = err instanceof Error ? err.message : String(err);
					this.#log(`the pin wasn't taken: ${why}`);
					return { ok: false, error: `The window's level couldn't be set: ${why}` };
				}
				this.#prefs = { ...this.#prefs, pinned: command.args };
				this.#keep();
				this.#log(command.args ? "pinned above other windows" : "no longer pinned");
				return { ok: true, result: { pinned: command.args } };
			}
			case "putBack": {
				// Closed as its own button closes it: the main page is told, and docks the controls.
				const window = this.#window;
				if (!window) return { ok: true, result: null };
				// Its frame while it has one, then the close: a closed window's is not read (#closed).
				this.#frameOf(window);
				try {
					window.close();
				} finally {
					if (this.#window === window) this.#closed(window);
				}
				return { ok: true, result: null };
			}
			default:
				return { ok: false, error: `No command ${command.channel}.${command.name}` };
		}
	}

	#open() {
		const frame = placeMediaWindow(this.#prefs.frame, this.#deps.displays(), this.#deps.mainFrame());
		const started = this.#now();
		let window: MediaWindowHandle;
		try {
			window = this.#deps.create(frame, this.#prefs.pinned);
		} catch (err) {
			// No window was made: the main page, whose sidebar already shows the controls as out, is told it is gone,
			// and docks them again.
			this.#log(`couldn't open: ${err instanceof Error ? err.message : String(err)}`);
			void this.#tellMain("closed");
			return;
		}
		this.#window = window;
		this.#log(
			`opened (window ${window.id}) in ${(this.#now() - started).toFixed(1)} ms at ${JSON.stringify(frame)}` +
				(this.#prefs.pinned ? ", pinned" : ""),
		);
		// Its page mirrors the main window's states from here on: the latest of each at once, then every new one.
		window.on("ready", () => {
			if (this.#window !== window) return;
			this.#deps.relay.add(window.id, (message) => window.send(message), mediaWindowMirrors);
			this.#log(`its page mirrors the main window (window ${window.id})`);
		});
		// Its frame is read as it moves, while the window is there to ask: once it has closed there may be nothing
		// behind the handle (a destroyed HWND or GTK window), so the frame kept is the last one read here.
		const moved = () => {
			if (this.#window !== window) return;
			this.#frameOf(window);
			this.#keepSoon();
		};
		window.on("move", moved);
		window.on("resize", moved);
		window.on("close", () => this.#closed(window));
		void this.#tellMain("opened");
	}

	#close(why: string) {
		const window = this.#window;
		if (!window) return;
		this.#log(`closing: ${why}`);
		this.#closing = true;
		this.#frameOf(window);
		try {
			window.close();
		} finally {
			// A window whose close event doesn't come while it closes is still gone for this.
			if (this.#window === window) this.#closed(window);
			this.#closing = false;
		}
	}

	// The window is gone, however it went: its own close button, Put back, the main window's wish, or the app quitting.
	#closed(window: MediaWindowHandle) {
		if (this.#window !== window) return;
		this.#stopKeeping?.();
		this.#stopKeeping = null;
		// Its frame is not read here: the window is gone. What is kept is the frame read as it last moved, or just
		// before this closed it.
		this.#window = null;
		this.#deps.relay.remove(window.id);
		this.#keep();
		this.#log(`closed (window ${window.id})`);
		if (!this.#closing) void this.#tellMain("closed");
	}

	// The main page's commands are the relay's to carry, as another window's are.
	async #tellMain(name: "opened" | "closed") {
		const answer = await this.#deps.relay.commandFromWindow({ channel: MEDIA_WINDOW_CHANNEL, name });
		if (!answer.ok) this.#log(`the main window wasn't told the pop-out ${name}: ${answer.error}`);
	}

	#frameOf(window: MediaWindowHandle) {
		try {
			const frame = rectOf(window.getFrame());
			if (frame) this.#prefs = { ...this.#prefs, frame };
		} catch {
			// A window that can't say where it is: the last frame read stands.
		}
	}

	#keepSoon() {
		this.#stopKeeping?.();
		const later = this.#deps.later ?? laterByTimeout;
		this.#stopKeeping = later(() => {
			this.#stopKeeping = null;
			this.#keep();
		}, KEEP_AFTER_MS);
	}

	#keep() {
		try {
			this.#deps.writePrefs(JSON.stringify(this.#prefs));
		} catch (err) {
			// The app's data folder may not be there yet: an uncaught error here would end the app.
			this.#log(`couldn't keep the window's place: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

export { isAppPage };
