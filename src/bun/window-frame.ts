/** A window's frame or a display's area, in the screen coordinates Electrobun's window frames and displays share. On
 * Windows both are Win32's: GetWindowRect and SetWindowPos, and GetMonitorInfo's rcMonitor and rcWork. */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** What a maximize needs of a display, which Electrobun's Display has. */
export interface DisplayArea {
	bounds: Rect;
	workArea: Rect;
	isPrimary: boolean;
	/** Device pixels per logical one, as Electrobun's Display says (macOS's backing scale, Windows' DPI over 96). A
	 * frame is in device pixels on Windows alone (main-window.ts: frameScale). */
	scaleFactor?: number;
}

/** A frame out of a value that crossed a file or Electrobun, or null. */
export function rectOf(value: unknown): Rect | null {
	if (typeof value !== "object" || value === null) return null;
	if (!("x" in value) || !("y" in value) || !("width" in value) || !("height" in value)) return null;
	const { x, y, width, height } = value;
	if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number")
		return null;
	return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0 ? { x, y, width, height } : null;
}

export const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function overlap(a: Rect, b: Rect): number {
	const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return width > 0 && height > 0 ? width * height : 0;
}

/** The display a frame is on, as Windows picks a window's: the one it overlaps most, else the primary. */
export function displayOf<D extends DisplayArea>(displays: D[], frame: Rect): D | undefined {
	let best: D | undefined;
	let most = 0;
	for (const display of displays) {
		const area = overlap(display.bounds, frame);
		if (area > most) [best, most] = [display, area];
	}
	return best ?? displays.find((display) => display.isPrimary) ?? displays[0];
}

/** How far apart two rectangles are: 0 when they touch or overlap. */
function gap(a: Rect, b: Rect): number {
	const across = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
	const down = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
	return Math.hypot(across, down);
}

/** The display for a frame kept from another run (main-window.ts): the one it overlaps most, as displayOf, else the
 * one nearest to it, for a frame whose own display is gone. */
export function nearestDisplay<D extends DisplayArea>(displays: D[], frame: Rect): D | undefined {
	if (displays.some((display) => overlap(display.bounds, frame) > 0)) return displayOf(displays, frame);
	let best: D | undefined;
	let least = Infinity;
	for (const display of displays) {
		const away = gap(display.bounds, frame);
		if (away < least) [best, least] = [display, away];
	}
	return best;
}

/** The display a point is on, the cursor's, else the primary. */
export function displayAt<D extends DisplayArea>(displays: D[], point: { x: number; y: number }): D | undefined {
	const holds = ({ x, y, width, height }: Rect) =>
		point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
	return (
		displays.find((display) => holds(display.bounds)) ?? displays.find((display) => display.isPrimary) ?? displays[0]
	);
}

/** Whether all of a frame is in the displays' work areas: none of it past a display's edge, or behind a menu bar, a
 * Dock or a taskbar. Across two displays, it still is. */
export function wholeOn(displays: DisplayArea[], frame: Rect): boolean {
	// Mirrored displays have the same work area: counted once.
	const areas = new Map(displays.map(({ workArea }) => [JSON.stringify(workArea), workArea]));
	let shown = 0;
	for (const area of areas.values()) shown += overlap(area, frame);
	return shown >= frame.width * frame.height;
}

/** rect moved into area and made to fit it. */
export const fitted = (rect: Rect, area: Rect): Rect => onto(rect, area, area);

/** rect, at the place it had in from, moved into to and made to fit it, from === to included: a frame whose display
 * is gone (a dock unplugged) comes back on the one it fills. */
function onto(rect: Rect, from: Rect, to: Rect): Rect {
	const width = Math.min(rect.width, to.width);
	const height = Math.min(rect.height, to.height);
	return {
		x: Math.min(Math.max(to.x + rect.x - from.x, to.x), to.x + to.width - width),
		y: Math.min(Math.max(to.y + rect.y - from.y, to.y), to.y + to.height - height),
		width,
		height,
	};
}

/** The title bar's maximize. A press fills the work area of the display the window is on, and the next one puts back
 * the frame it had before, on that display. The window is a popup (titleBarStyle "hidden"), which Windows' own
 * maximize would let cover the taskbar: on Windows the title bar uses that maximize once window-snap.ts keeps it to the
 * work area, and this is for macOS, Linux and a Windows window that couldn't take window-snap's procedure. The display
 * is found from the window's own frame, never from the webview's window.screen: WebView2 doesn't update that when the
 * window is only moved, as a drag moves it (#187). */
export class Maximizer {
	private before: Rect | null = null;
	private filled: Rect | null = null;

	/** For a window that opens filling a display's work area, `filled`, as it was left (main-window.ts): the next press
	 * puts back `before`, the frame it had before it filled it. */
	resume(before: Rect, filled: Rect) {
		this.before = before;
		this.filled = filled;
	}

	/** Whether a window whose frame is `frame` still has the frame it was given to fill a work area, by a press or as
	 * it opened. The area itself may have changed since: the Dock is a pixel taller or shorter once an app's icon joins
	 * it, as Duvet's own does a moment after the window opens. */
	fills(frame: Rect): boolean {
		return this.before !== null && this.filled !== null && same(frame, this.filled);
	}

	/** The frame a press gives a window whose frame is frame, or null without displays. */
	press(frame: Rect, displays: DisplayArea[]): Rect | null {
		const display = displayOf(displays, frame);
		if (!display) return null;
		const area = display.workArea;
		if (this.before && (same(frame, area) || this.fills(frame))) {
			const back = onto(this.before, displayOf(displays, this.before)?.workArea ?? area, area);
			this.before = this.filled = null;
			return back;
		}
		// A window moved while it filled a display keeps the frame it had before; one given another size has a new one.
		const moved =
			this.before && this.filled && frame.width === this.filled.width && frame.height === this.filled.height;
		if (!moved) this.before = frame;
		this.filled = area;
		return area;
	}
}
