// The main window's frame (#419): where it opens the first time, what is kept of it on this device, and where it opens
// after that.
//
// The first time, it is sized to the display under the cursor and centred in its work area. After that it opens where
// it was left, at the size it was left, maximized or full screen if it was, and back on a display that is there when
// its own is gone. Its frame goes into `new BrowserWindow`, which Electrobun 1.15.1 makes at that frame and only then
// shows: it never opens at one frame and jumps to another.
//
// Electrobun is handed in (src/bun/index.ts makes the window and listens to it), so this runs in tests.
import {
	displayAt,
	displayOf,
	fitted,
	nearestDisplay,
	rectOf,
	same,
	wholeOn,
	type DisplayArea,
	type Rect,
} from "./window-frame";

export interface Size {
	width: number;
	height: number;
}

/** The smallest the window gets, in logical pixels: wide enough for the sidebar at its narrowest beside a pane with the
 * members column (lib/shell-layout.ts: SIDEBAR_MIN, lib/members.ts: MEMBERS_COLUMN_MIN_PANE), which
 * lib/shell-layout.test.ts holds it to. */
export const MIN_SIZE: Size = { width: 940, height: 600 };

/** The first launch's size, in logical pixels: this share of the display's work area, no smaller than `min` and no
 * larger than `max`. On a large or an ultrawide display the window stays at `max`, with space all round. */
export const FIRST_SIZE = {
	share: { width: 0.7, height: 0.75 },
	min: { width: 1100, height: 700 },
	max: { width: 1440, height: 920 },
};

/** What the window leaves free on each side of a work area too small for the size it would take. */
export const MARGIN = 16;

/** A move or a resize is kept once the window has rested this long. */
export const KEEP_AFTER_MS = 300;

/** The work area taken for a system that names no display: the window still opens, at the first size. */
const UNKNOWN_AREA: Rect = { x: 0, y: 0, width: 1440, height: 900 };

/** How many of a frame's units a logical pixel is, on a display. Windows' frames and displays are in device pixels
 * (GetWindowRect, GetMonitorInfo), so it's the display's scale there: 1.5 at 150%. macOS's are in points and Linux's
 * in GDK's logical pixels, whatever the display's scale. */
export function frameScale(platform: string, display: DisplayArea | undefined): number {
	const scale = platform === "win32" ? display?.scaleFactor : 1;
	return typeof scale === "number" && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** The smallest the window may be made on a display, in logical pixels: MIN_SIZE, or what a smaller work area has
 * room for. */
export function minimumSize(area: Rect, scale = 1): Size {
	const side = (key: "width" | "height") =>
		Math.min(MIN_SIZE[key], Math.max(Math.floor(area[key] / scale) - 2 * MARGIN, 1));
	return { width: side("width"), height: side("height") };
}

/**
 * The window's frame the first time it opens on a display whose work area is `area`: a share of the area, held between
 * the first size's least and most, less a margin where the area is smaller than that, centred. `scale` is the area's
 * (frameScale).
 */
export function firstFrame(area: Rect, scale = 1): Rect {
	const side = (key: "width" | "height") => {
		const room = area[key] / scale;
		const wanted = Math.min(Math.max(room * FIRST_SIZE.share[key], FIRST_SIZE.min[key]), FIRST_SIZE.max[key]);
		return Math.round(Math.min(wanted, Math.max(room - 2 * MARGIN, 1)) * scale);
	};
	const width = side("width");
	const height = side("height");
	return {
		x: Math.round(area.x + (area.width - width) / 2),
		y: Math.round(area.y + (area.height - height) / 2),
		width,
		height,
	};
}

/** What is kept of the window on this device. */
export interface MainWindowPrefs {
	/** Its frame while it neither filled a display nor was full screen; null before any was kept. */
	frame: Rect | null;
	/** That frame's scale (frameScale), on the display it was on. */
	scale: number;
	maximized: boolean;
	fullScreen: boolean;
}

/** The kept prefs as their file has them; anything unreadable is no prefs, never an error. */
export function parsePrefs(text: string | null): MainWindowPrefs {
	const none: MainWindowPrefs = { frame: null, scale: 1, maximized: false, fullScreen: false };
	if (!text) return none;
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null) return none;
		const frame = "frame" in value ? rectOf(value.frame) : null;
		if (!frame) return none;
		const scale = "scale" in value && typeof value.scale === "number" ? value.scale : 1;
		return {
			frame,
			scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
			maximized: "maximized" in value && value.maximized === true,
			fullScreen: "fullScreen" in value && value.fullScreen === true,
		};
	} catch {
		return none;
	}
}

/** How the window opens. */
export interface Opening {
	/** The frame it is made with: `normal`, or the work area it fills where it opens filling one. */
	frame: Rect;
	/** Its frame while it fills nothing, which a restore from maximized or full screen gives back. */
	normal: Rect;
	/** The work area of the display it opens on. */
	area: Rect;
	/** That display's scale (frameScale). */
	scale: number;
	maximized: boolean;
	fullScreen: boolean;
	/** The smallest it may be made there, in logical pixels. */
	minimum: Size;
}

/**
 * A frame kept from another run, as it opens now. On the displays there are, it opens as it was. One that no longer
 * fits them (a monitor unplugged, another resolution) is moved into the work area of the nearest display and made to
 * fit it. It keeps its size in logical pixels on a display of another scale, and is never smaller than the window may
 * be made.
 */
function restored(kept: Rect, keptScale: number, display: DisplayArea, displays: DisplayArea[], scale: number): Rect {
	const least = minimumSize(display.workArea, scale);
	const sized = {
		x: Math.round(kept.x),
		y: Math.round(kept.y),
		width: Math.max(Math.round((kept.width / keptScale) * scale), Math.round(least.width * scale)),
		height: Math.max(Math.round((kept.height / keptScale) * scale), Math.round(least.height * scale)),
	};
	return wholeOn(displays, sized) ? sized : fitted(sized, display.workArea);
}

/**
 * How the window opens: as it was kept, on the displays there are now, or, with nothing kept, at the first frame on
 * the display under the cursor (the primary one without a cursor). A window kept maximized opens filling its
 * display's work area, except on Windows, whose own maximize is asked once the window is made (index.ts).
 */
export function openingOf(
	prefs: MainWindowPrefs,
	displays: DisplayArea[],
	cursor: { x: number; y: number } | null,
	platform: string,
): Opening {
	const keptOn = prefs.frame ? nearestDisplay(displays, prefs.frame) : undefined;
	if (prefs.frame && keptOn) {
		const scale = frameScale(platform, keptOn);
		const area = keptOn.workArea;
		const normal = restored(prefs.frame, prefs.scale, keptOn, displays, scale);
		const fills = prefs.maximized && platform !== "win32";
		return {
			frame: fills ? area : normal,
			normal,
			area,
			scale,
			maximized: prefs.maximized,
			fullScreen: prefs.fullScreen,
			minimum: minimumSize(area, scale),
		};
	}
	const display = cursor ? displayAt(displays, cursor) : displayOf(displays, { x: 0, y: 0, width: 0, height: 0 });
	const scale = frameScale(platform, display);
	const area = display?.workArea ?? UNKNOWN_AREA;
	const frame = firstFrame(area, scale);
	return { frame, normal: frame, area, scale, maximized: false, fullScreen: false, minimum: minimumSize(area, scale) };
}

/** A window's frame as a move or a resize event of its says it (Electrobun's event.data), over the frame it had: a
 * move says where the window is, not how large. Null for anything else. */
export function frameFromEvent(event: unknown, had: Rect): Rect | null {
	const data = typeof event === "object" && event !== null && "data" in event ? event.data : null;
	if (typeof data !== "object" || data === null || !("x" in data) || !("y" in data)) return null;
	const size = "width" in data && "height" in data ? { width: data.width, height: data.height } : had;
	return rectOf({ x: data.x, y: data.y, width: size.width, height: size.height });
}

/** What the window says of itself. */
export interface MainWindowState {
	minimized: boolean;
	maximized: boolean;
	fullScreen: boolean;
}

export interface MainWindowKeeperDeps {
	platform: string;
	/** The window's frame as it is asked for it, in the displays' coordinates; null where it can't say it in those
	 * (macOS, whose events say it instead: index.ts), and for a window that can't be asked. */
	frame(): Rect | null;
	/** The window's own states. Asked only while the window is there. */
	state(): MainWindowState;
	/** Whether a window at this frame still has the frame the title bar's maximize gave it (window-frame.ts:
	 * Maximizer.fills), whatever its display's work area is now. */
	filled?(frame: Rect): boolean;
	displays(): DisplayArea[];
	writePrefs(text: string): void;
	log?: (line: string) => void;
	/** A timer's start and its stop, for tests: setTimeout and clearTimeout otherwise. */
	later?: (run: () => void, ms: number) => () => void;
}

const laterByTimeout = (run: () => void, ms: number) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

/**
 * Keeps the window's frame and state on this device as it moves, is resized and closes. What is kept is the frame it
 * has while it fills nothing (the one a restore gives back), and whether it is maximized or full screen: a window
 * that fills its display's work area counts as maximized however it came to (the title bar's maximize, the system's).
 */
export class MainWindowKeeper {
	readonly #deps: MainWindowKeeperDeps;
	readonly #log: (line: string) => void;
	#prefs: MainWindowPrefs;
	/** The window's frame as last known, whatever its state. */
	#frame: Rect;
	#stopKeeping: (() => void) | null = null;
	#gone = false;

	constructor(deps: MainWindowKeeperDeps, opening: Opening) {
		this.#deps = deps;
		this.#log = deps.log ?? (() => {});
		this.#frame = opening.frame;
		this.#prefs = {
			frame: opening.normal,
			scale: opening.scale,
			maximized: opening.maximized,
			fullScreen: opening.fullScreen,
		};
	}

	/** The window's frame as last known, in the displays' coordinates. */
	get frame(): Rect {
		return this.#frame;
	}

	/** What would be kept now. */
	get prefs(): MainWindowPrefs {
		return this.#prefs;
	}

	/** The window moved or was resized. `frame` is where an event says it is now, where events say (frameFromEvent);
	 * elsewhere the window is asked once it rests. */
	moved(frame: Rect | null = null) {
		if (this.#gone) return;
		if (frame) this.#frame = frame;
		this.#stopKeeping?.();
		const later = this.#deps.later ?? laterByTimeout;
		this.#stopKeeping = later(() => {
			this.#stopKeeping = null;
			this.keepNow();
		}, KEEP_AFTER_MS);
	}

	/** Looks at the window and keeps what it finds, at once: before the window is asked to close, and as the app
	 * quits, while it is still there to ask. */
	keepNow() {
		if (this.#gone) return;
		this.#stopKeeping?.();
		this.#stopKeeping = null;
		this.#look();
		this.#keep();
	}

	/** The window closed. It isn't asked anything: once closed there may be nothing behind its handle (a destroyed
	 * HWND or X11 window). What is kept is what it was when it last rested. */
	closed() {
		if (this.#gone) return;
		this.#gone = true;
		this.#stopKeeping?.();
		this.#stopKeeping = null;
		this.#keep();
	}

	#look() {
		let state: MainWindowState;
		let asked: Rect | null;
		try {
			state = this.#deps.state();
			asked = this.#deps.frame();
		} catch {
			// A window that can't be asked: what was kept stands.
			return;
		}
		// Windows moves a minimized window off every display: nothing of it is a frame to open at.
		if (state.minimized) return;
		if (asked) this.#frame = asked;
		// Full screen, what it comes back to is what it was before: its frame, maximized or not.
		if (state.fullScreen) {
			this.#prefs = { ...this.#prefs, fullScreen: true };
			return;
		}
		const display = displayOf(this.#deps.displays(), this.#frame);
		const maximized =
			state.maximized ||
			(display !== undefined && same(this.#frame, display.workArea)) ||
			(this.#deps.filled?.(this.#frame) ?? false);
		this.#prefs = maximized
			? { ...this.#prefs, maximized: true, fullScreen: false }
			: {
					frame: this.#frame,
					scale: frameScale(this.#deps.platform, display),
					maximized: false,
					fullScreen: false,
				};
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
