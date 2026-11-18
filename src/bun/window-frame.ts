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
}

const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

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

	/** The frame a press gives a window whose frame is frame, or null without displays. */
	press(frame: Rect, displays: DisplayArea[]): Rect | null {
		const display = displayOf(displays, frame);
		if (!display) return null;
		const area = display.workArea;
		if (this.before && same(frame, area)) {
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
