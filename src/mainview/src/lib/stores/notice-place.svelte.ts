import { noticePlace, type NoticePlace } from "$lib/notice-place";
import { currentShell } from "$lib/platform";

/** Where the notices sit now (lib/notice-place.ts), or null until the title line was first measured; and how tall the
 * call's notice is while it is up, 0 otherwise, so the mentions' notices start under it. */
export const noticeArea: { place: NoticePlace | null; callHeight: number } = $state({ place: null, callHeight: 0 });

// The title line on screen: the shell's, else the pages' own bar. Both say so themselves.
const TITLE_LINE = "[data-title-line], [data-title-bar]";

let watchers = 0;
let stop: (() => void) | null = null;

function start(): () => void {
	let observed: Element | null = null;
	const observer = new ResizeObserver(() => measure());
	function measure() {
		const line = document.querySelector(TITLE_LINE);
		// The line may be another element than last time (the app's UI is built anew on a new gateway session).
		if (line !== observed) {
			if (observed) observer.unobserve(observed);
			observed = line;
			if (line) observer.observe(line);
		}
		const box = line?.getBoundingClientRect() ?? null;
		const next = noticePlace(box, window.innerWidth, currentShell());
		const now = noticeArea.place;
		if (!now || now.top !== next.top || now.left !== next.left || now.width !== next.width) noticeArea.place = next;
	}
	measure();
	window.addEventListener("resize", measure);
	return () => {
		window.removeEventListener("resize", measure);
		observer.disconnect();
	};
}

/**
 * Keeps `noticeArea.place` under the title line while a notice is on screen: measured now, then whenever the line or
 * the window changes size (the sidebar dragged wider, docked or folded). Returns what ends the watch; the measuring
 * stops with the last notice, so nothing observes the page while none shows.
 */
export function watchNoticePlace(): () => void {
	if (watchers++ === 0) stop = start();
	let ended = false;
	return () => {
		if (ended) return;
		ended = true;
		if (--watchers === 0) {
			stop?.();
			stop = null;
		}
	};
}
