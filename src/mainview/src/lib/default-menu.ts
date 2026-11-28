// Duvet's own right-click menu where nothing of the app draws one (#423): the default menu for what's under the
// pointer, drawn by DefaultContextMenu.svelte with ui/ContextMenu.svelte, as every other menu of the app. A menu of the
// app's own (a message's, a member's, a tab's) takes the right-click first; this one gets what they leave.
//
// A text field keeps the webview's own menu: it holds the spelling suggestions, which no webview hands the page (a page
// can't even tell which words are underlined), and a real Paste, which a page can only make by reading the clipboard:
// behind a permission Electrobun asks for in a dialog at each start on Windows, behind WebKit's own Paste button on
// macOS, or through Bun, which would hand the clipboard to any frame that has Electrobun's preload.

import { resolveExternalHref } from "$lib/external-links";
import { t } from "$lib/i18n";
import { rawOf } from "$lib/message-box";

/** What a right-click is on, as the page reads it from the element under the pointer and the selection. */
export interface MenuTarget {
	/** It's in a text field: one that takes text, or anything editable. */
	textField: boolean;
	/** The selected text the right-click is on, trimmed; "" when it isn't on the selection. */
	selection: string;
	/** The message the selected text is in, all of it, by its ID. */
	messageId: string | null;
	/** The link it's in: an http(s) or mailto address, as the browser opens it. */
	link: string | null;
	/** The picture or the video it's on, from the network, or a conversation's this device decrypted (`decrypted`). */
	media: { type: "image" | "video"; src: string; decrypted?: true } | null;
}

/** What the menu's items can do where it opens. */
export interface MenuAbilities {
	/** Whether a chat's message list takes a quote of this message into its box, as a reply. */
	quote: (messageId: string) => boolean;
	/** Whether there's a search for Search Duvet: the friends view's search everywhere. */
	search: boolean;
	/** Whether the app's Bun side is there to open links and copy pictures: the desktop app's main window. */
	app: boolean;
	/** A development build's main window, where Electrobun opens DevTools. */
	devTools: boolean;
}

export type DefaultItem =
	| { id: "copy-selection" }
	| { id: "quote"; messageId: string; text: string }
	| { id: "search"; text: string }
	| { id: "open-link"; href: string }
	| { id: "copy-link"; href: string }
	| { id: "open-media"; type: "image" | "video"; src: string }
	| { id: "copy-image"; src: string }
	| { id: "copy-media-link"; type: "image" | "video"; src: string }
	| { id: "devtools" };

/**
 * The menu a right-click on `target` opens, in groups: the selected text's (Copy, Quote in reply, Search Duvet), the
 * link's, the picture's or the video's, then DevTools in a development build. "native" over a text field, which keeps
 * the webview's menu; null where there's nothing to act on, which shows no menu at all.
 */
export function defaultMenuOf(target: MenuTarget, can: MenuAbilities): "native" | DefaultItem[][] | null {
	if (target.textField) return "native";
	const groups: DefaultItem[][] = [];
	const text = target.selection;
	if (text) {
		const group: DefaultItem[] = [{ id: "copy-selection" }];
		if (target.messageId && can.quote(target.messageId)) group.push({ id: "quote", messageId: target.messageId, text });
		if (can.search) group.push({ id: "search", text });
		groups.push(group);
	}
	const href = target.link;
	if (href) groups.push([...(can.app ? [{ id: "open-link" as const, href }] : []), { id: "copy-link", href }]);
	const media = target.media;
	// A decrypted file is a blob: of the app's own origin, which nothing opens or hands out (PLAN-E2E-CLIENTES.md,
	// Review Focus 6): a picture can be copied, as bytes, and nothing else.
	if (media?.decrypted) {
		if (can.app && media.type === "image") groups.push([{ id: "copy-image", src: media.src }]);
	} else if (media) {
		const { type, src } = media;
		const group: DefaultItem[] = [];
		if (can.app) group.push({ id: "open-media", type, src });
		if (can.app && type === "image") group.push({ id: "copy-image", src });
		group.push({ id: "copy-media-link", type, src });
		groups.push(group);
	}
	if (can.devTools) groups.push([{ id: "devtools" }]);
	return groups.length > 0 ? groups : null;
}

/** What takes text: an input of a kind that does, a textarea, or anything editable (the message box). */
export const TEXT_FIELD =
	"textarea, input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email], " +
	"input[type=password], input[type=tel], input[type=number], [contenteditable]:not([contenteditable=false])";
export const LINK = "a[href]";
export const MEDIA = "img, video";

/** What readTarget reads of an element: what's around it, and its own attributes. A DOM element is one. */
export interface Pointed {
	closest(selector: string): Pointed | null;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	readonly tagName: string;
	readonly classList: { contains(name: string): boolean };
	/** A picture's or a video's address as the page loaded it. */
	readonly currentSrc?: string;
}

/** The selection a right-click is on, as the menu read it: its text, and the message holding all of it. */
export interface PickedSelection {
	text: string;
	messageId: string | null;
}

const NOTHING: MenuTarget = { textField: false, selection: "", messageId: null, link: null, media: null };

/**
 * What a right-click on `el` is on. `picked` is the selection, when the right-click is on it (onRects); `origin` is
 * the page's, whose own links aren't links to open elsewhere (resolveExternalHref).
 */
export function readTarget(el: Pointed | null, picked: PickedSelection | null, origin: string): MenuTarget {
	if (!el) return NOTHING;
	const anchor = el.closest(LINK);
	const selection = picked?.text.trim() ?? "";
	return {
		textField: el.closest(TEXT_FIELD) !== null,
		selection,
		messageId: selection ? (picked?.messageId ?? null) : null,
		link: anchor ? resolveExternalHref(anchor, origin) : null,
		media: mediaOf(el.closest(MEDIA)),
	};
}

// A picture or a video loaded from the network, or a conversation's file this device decrypted, which it marks
// (data-decrypted, on its blob: URL). An emoji is a character drawn as a picture (twemoji): its menu is its message's,
// or none.
function mediaOf(el: Pointed | null): MenuTarget["media"] {
	if (!el) return null;
	const type = el.tagName === "VIDEO" ? "video" : el.tagName === "IMG" ? "image" : null;
	if (!type || (type === "image" && el.classList.contains("emoji-img"))) return null;
	const src = el.currentSrc || el.getAttribute("src") || "";
	if (el.hasAttribute("data-decrypted") && src.startsWith("blob:")) return { type, src, decrypted: true };
	return /^https?:\/\//i.test(src) ? { type, src } : null;
}

// bits-ui's long press on a ContextMenu's trigger, which opens its menu without the menu event.
const LONG_PRESS = ["onpointerdown", "onpointermove", "onpointercancel", "onpointerup"];

/**
 * A ContextMenu trigger's props for a list's one menu, whose row the menu event picks: without bits-ui's long press,
 * which would open the menu for the row picked before (a touch's long press sends the menu event itself). What bits-ui
 * keeps under a symbol (the trigger's reference) stays.
 */
export function withoutLongPress(props: Record<PropertyKey, unknown>): Record<PropertyKey, unknown> {
	const kept = { ...props };
	for (const key of LONG_PRESS) delete kept[key];
	return kept;
}

/** Whether a point is on one of a selection's rectangles (Range.getClientRects), edges included. */
export function onRects(
	rects: Iterable<{ left: number; top: number; right: number; bottom: number }>,
	x: number,
	y: number,
): boolean {
	for (const r of rects) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
	return false;
}

// The selection the right button found as it went down, and when: on macOS, WebKit selects the word under the pointer
// before it sends the menu event, which would make every right-click on text one on a selection.
let pressed: { range: Range | null; at: number } | null = null;
// How long after its press a right-click's menu event comes: at once on macOS, as the button goes up elsewhere.
const PRESS_TO_MENU_MS = 1000;

/** Keeps the selection each right press finds, for menuSelection. Returns what stops it. */
export function trackRightPresses(win: Window): () => void {
	const onPress = (e: PointerEvent) => {
		if (e.button !== 2) return;
		const selection = win.getSelection();
		const range = selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		pressed = { range: range?.cloneRange() ?? null, at: performance.now() };
	};
	win.addEventListener("pointerdown", onPress, true);
	return () => win.removeEventListener("pointerdown", onPress, true);
}

/**
 * The selection a menu event is on, or null: the one the user made, as their right press found it (the keyboard's has
 * none: the selection as it is), when the event's point is on its text.
 */
export function menuSelection(e: Pick<MouseEvent, "clientX" | "clientY">): Range | null {
	const press = pressed && performance.now() - pressed.at < PRESS_TO_MENU_MS ? pressed : null;
	const selection = window.getSelection();
	const live = selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	const range = press ? press.range : live;
	if (!range || range.collapsed) return null;
	return onRects(range.getClientRects(), e.clientX, e.clientY) ? range : null;
}

/** A selection as the menu reads it: its text, an emoji as its character and a custom one as :name:, as a copy of
 * it reads (rawOf), and the message holding all of it. */
export function pickSelection(range: Range): PickedSelection {
	const ancestor = range.commonAncestorContainer;
	const holder = ancestor instanceof Element ? ancestor : ancestor.parentElement;
	return {
		text: rawOf(range.cloneContents()),
		messageId: holder?.closest("[data-message-id]")?.getAttribute("data-message-id") ?? null,
	};
}

/** How much of the selection Search Duvet's item shows, in characters. */
const SEARCH_SHOWN = 28;

/** Search Duvet's item, with the selection on one line, cut short. */
export function searchLabel(text: string): string {
	const line = [...text.replace(/\s+/g, " ").trim()];
	const shown = line.length > SEARCH_SHOWN ? `${line.slice(0, SEARCH_SHOWN).join("")}…` : line.join("");
	return t("shell_menu_search", { text: shown });
}

type Key = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">;

/** The keys that open a menu for what has the focus: the context-menu key, and Shift+F10 where a keyboard has none. */
export function isMenuKey(e: Key): boolean {
	if (e.altKey || e.ctrlKey || e.metaKey) return false;
	return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}

/** Where a menu the keyboard opens for an element goes: at its bottom left, kept inside the window. */
export function keyMenuPoint(
	rect: { left: number; bottom: number },
	view: { width: number; height: number },
): { x: number; y: number } {
	const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0));
	return { x: clamp(rect.left, view.width - 1), y: clamp(rect.bottom, view.height - 1) };
}

/**
 * The webview's own menu event that follows a menu key the page has answered: Windows sends one, as the key goes up,
 * and that isn't a second menu. Taken once, within WITHIN_MS of the key; a right press since is a right-click of the
 * user's own.
 */
export class KeyMenuEcho {
	static readonly WITHIN_MS = 1500;
	#until = -Infinity;

	/** The page opened a menu for the key, at `now` (ms). */
	opened(now: number) {
		this.#until = now + KeyMenuEcho.WITHIN_MS;
	}

	/** A right press of the pointer. */
	pressed() {
		this.#until = -Infinity;
	}

	/** Whether the webview's menu event at `now` is the key's echo, which the page drops. */
	takes(now: number): boolean {
		if (now > this.#until) return false;
		this.#until = -Infinity;
		return true;
	}
}
