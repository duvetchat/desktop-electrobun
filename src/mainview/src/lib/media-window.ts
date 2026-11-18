// The media controls' pop-out window, as its two pages agree on it (#357, BRIEF.md "Media controls"). The window is
// the Bun process's to make and close (src/bun/media-window.ts); the main window only says whether it wants it, as a
// state of its own channel, and Bun tells the main window when the window opened or closed. The call never moves: the
// pop-out mirrors the media controls' state (lib/media-state.ts) and sends its commands back.
// Nothing here imports the app: the pop-out's page uses it, and must never reach lib/api/ws/connection.ts.

/** The channel of the window itself: the main window's wish for it, and the commands about it. */
export const MEDIA_WINDOW_CHANNEL = "media-window";

/** What the main window wants of the pop-out: open or not, and how many times it asked to see it (each new ask
 * brings the window to the front). Published as a state, so Bun always acts on the latest. */
export interface MediaWindowWish {
	open: boolean;
	shown: number;
}

/** The commands about the window. From the pop-out, answered by Bun: hello says its page listens now (Bun sends the
 * latest states again, and answers how it is pinned), pin keeps it above other windows or stops, putBack closes it,
 * info says whether it is pinned. From Bun, answered by the main window: opened and closed. */
export type MediaWindowCommand = "hello" | "pin" | "putBack" | "info" | "opened" | "closed";

/** A wish as it crossed the RPC, or null for anything else. */
export function parseWish(value: unknown): MediaWindowWish | null {
	if (typeof value !== "object" || value === null || !("open" in value) || !("shown" in value)) return null;
	const { open, shown } = value;
	return typeof open === "boolean" && typeof shown === "number" && Number.isFinite(shown) ? { open, shown } : null;
}

/** Where the controls are, as the sidebar draws it: in it, or in their own window. `wish` is what Bun is told. */
export interface PopOutState {
	/** The controls are in their own window: the sidebar shows the slim row. */
	out: boolean;
	wish: MediaWindowWish;
}

export const DOCKED: PopOutState = { out: false, wish: { open: false, shown: 0 } };

export type PopOutStep =
	/** Pop out, from the controls' button. */
	| "popOut"
	/** Put back, from the slim row. */
	| "putBack"
	/** The slim row itself: bring the window to the front. */
	| "show"
	/** Bun says the window is gone: closed by its own button, by Put back in it, or it never opened. */
	| "closed";

/** The state after a step. Putting back and a window that closed both dock the controls again; showing a window that
 * isn't out does nothing. */
export function popOutStep(state: PopOutState, step: PopOutStep): PopOutState {
	switch (step) {
		case "popOut":
			// Asked again while it is out, it comes to the front.
			return { out: true, wish: { open: true, shown: state.wish.shown + (state.out ? 1 : 0) } };
		case "show":
			return state.out ? { out: true, wish: { open: true, shown: state.wish.shown + 1 } } : state;
		case "putBack":
		case "closed":
			return state.out || state.wish.open ? { out: false, wish: { open: false, shown: state.wish.shown } } : state;
	}
}

/** Whether a page's address is the app's own page, the only one whose controls can be out: Bun closes the pop-out
 * when the main window goes anywhere else (signing out takes it to the sign-in page). */
export function isAppPage(url: string): boolean {
	try {
		const { pathname } = new URL(url);
		return /(^|\/)app(\.html)?\/?$/.test(pathname);
	} catch {
		return false;
	}
}
