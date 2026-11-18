// A closed spoiler's specks drift (message-styles.ts, --animate-specks): a background that moves for as long as the
// spoiler is closed, which the browser works out on the main thread, frame after frame, for every spoiler in every
// chat that is drawn, in view or not. This keeps them drifting on screen only: a spoiler tells of itself when its
// animation starts, one observer watches those, and one out of view holds still (`data-still`, which pauses it).
// Nothing runs for a page with no spoiler, and nothing per message.

/** The keyframes' name in app.css. */
export const SPECKS = "specks";
/** The attribute a spoiler out of view carries. */
export const STILL = "data-still";

/** What this needs of a spoiler's element, of the observer and of the page. */
export interface Speck {
	readonly isConnected: boolean;
	toggleAttribute(name: string, force?: boolean): unknown;
}
export interface Watcher {
	observe(target: Speck): void;
	unobserve(target: Speck): void;
	disconnect(): void;
}
type Seen = (entries: { target: Speck; isIntersecting: boolean }[]) => void;
interface Listens {
	addEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
	removeEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
}

const isSpeck = (target: unknown): target is Speck =>
	typeof target === "object" && target !== null && "toggleAttribute" in target && "isConnected" in target;

// The browser's observer takes elements only, which is what an animation starts on.
const browserWatcher = (seen: Seen): Watcher => {
	const observer = new IntersectionObserver(seen);
	return {
		observe: (target) => {
			if (target instanceof Element) observer.observe(target);
		},
		unobserve: (target) => {
			if (target instanceof Element) observer.unobserve(target);
		},
		disconnect: () => observer.disconnect(),
	};
};

/**
 * Starts it for a document; returns what stops it. `watch` makes the observer (the browser's, unless a test gives
 * its own).
 */
export function driftSpecksOnScreen(
	page: Listens,
	watch: ((seen: Seen) => Watcher) | null = typeof IntersectionObserver === "undefined" ? null : browserWatcher,
): () => void {
	if (!watch) return () => {};
	const watcher = watch((entries) => {
		for (const { target, isIntersecting } of entries) {
			// A spoiler that left the page (its message, or its chat) is let go.
			if (!target.isConnected) watcher.unobserve(target);
			else target.toggleAttribute(STILL, !isIntersecting);
		}
	});
	const started = (event: Event) => {
		if (!("animationName" in event) || event.animationName !== SPECKS) return;
		// Watching one twice changes nothing, so a spoiler that starts again (the pointer left it) costs nothing.
		if (isSpeck(event.target)) watcher.observe(event.target);
	};
	page.addEventListener("animationstart", started, true);
	return () => {
		page.removeEventListener("animationstart", started, true);
		watcher.disconnect();
	};
}
