import type { Shell } from "$lib/platform";

// Where the notices sit (#357, DESIGN-MAP.md S-29): at the top centre of the main column, the same distance under the
// window's title line on every system and on the web. The title line is the shell's (52 px: the sidebar's header and
// the tab strip, TitleStrip.svelte), so the place is read from the line itself, not from a number per system: it
// follows the sidebar's width, and a notice never sits over the line's tabs or the window's buttons. Outside the
// shell there is the pages' slim title bar (Header.svelte) in the desktop app, and nothing on the web.

/** The room between the title line and the first notice. */
export const NOTICE_GAP = 10;
/** A notice's width, when the column has room for it. */
export const NOTICE_WIDTH = 420;
/** The room a notice keeps from the column's sides. */
export const NOTICE_MARGIN = 16;
/** The room between a call's notice and the mentions' under it. */
export const NOTICE_STACK_GAP = 8;
/** The pages' own title bar in the desktop app, outside the shell (Header.svelte's h-10). */
export const PAGE_TITLE_BAR = 40;

/** A title line on screen: where it starts, how wide it is, and where it ends, in px of the window. */
export interface LineBox {
	left: number;
	width: number;
	bottom: number;
}

export interface NoticePlace {
	top: number;
	left: number;
	width: number;
}

/**
 * The notices' place under a title line: centred on it, as wide as a notice is or as the line leaves room for. Without
 * a line on screen, under what the platform switch says the page has: the pages' title bar in the desktop app, the
 * window's own top on the web.
 */
export function noticePlace(line: LineBox | null, viewportWidth: number, shell: Pick<Shell, "chrome">): NoticePlace {
	const box = line ?? { left: 0, width: viewportWidth, bottom: shell.chrome === "web" ? 0 : PAGE_TITLE_BAR };
	const width = Math.max(0, Math.min(NOTICE_WIDTH, box.width - 2 * NOTICE_MARGIN));
	return {
		top: Math.round(box.bottom) + NOTICE_GAP,
		left: Math.round(box.left + (box.width - width) / 2),
		width: Math.round(width),
	};
}

/** Where the mentions' notices start while a call's notice of this height is up: under it, not behind it. */
export function underCall(place: NoticePlace, callHeight: number): NoticePlace {
	return callHeight > 0 ? { ...place, top: place.top + Math.round(callHeight) + NOTICE_STACK_GAP } : place;
}

/** A place as an inline style, over the classes that centre a notice in the window before its place is known. */
export function placeStyle(place: NoticePlace): string {
	return `top: ${place.top}px; left: ${place.left}px; right: auto; width: ${place.width}px; margin-inline: 0;`;
}
