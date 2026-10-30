/** Where keyboard navigation is: the message its cursor is on, in the focused pane, none while the user types; and
 * whether a chat it just opened should leave the user navigating instead of in its message box. */
export const keyboard: { cursor: string | null; keepNavigating: boolean } = $state({
	cursor: null,
	keepNavigating: false,
});

let keepTimer: ReturnType<typeof setTimeout> | undefined;

/** Opens a chat from navigation: the chat that shows doesn't take the keys to its message box, as it does when opened
 * otherwise. */
export function openNavigating(open: () => void) {
	keyboard.cursor = null;
	keyboard.keepNavigating = true;
	clearTimeout(keepTimer);
	// Long enough for the chat to show; a chat that was showing already leaves it set, so it's dropped either way.
	keepTimer = setTimeout(() => (keyboard.keepNavigating = false), 600);
	open();
}

/** Something the focused pane's chat is asked to do from the keyboard: reply to or edit the message under the cursor,
 * or go back to its message box. The chat in `pane` takes it. */
export type ChatRequest = { kind: "reply" | "edit" | "write"; messageId: string | null; pane: Element; seq: number };

export const chatRequest: { current: ChatRequest | null } = $state({ current: null });

let seq = 0;

export function requestChat(kind: ChatRequest["kind"], messageId: string | null, pane: Element) {
	chatRequest.current = { kind, messageId, pane, seq: ++seq };
}

/** The focused pane, while it's on screen (the friends view hides the panes). */
export function shownPane(): HTMLElement | null {
	const pane = document.querySelector<HTMLElement>('[data-pane-focused="true"]');
	return pane && pane.offsetParent !== null ? pane : null;
}

/** A pane's messages from the top of its list to the bottom, as they're laid out. */
export function messagesIn(pane: Element): HTMLElement[] {
	return [...pane.querySelectorAll<HTMLElement>("[data-message-id]")]
		.map((el) => ({ el, top: el.getBoundingClientRect().top }))
		.sort((a, b) => a.top - b.top)
		.map((m) => m.el);
}

/** Puts the cursor on a message, scrolled into view. */
export function placeCursor(el: HTMLElement | undefined) {
	if (!el?.dataset.messageId) return;
	keyboard.cursor = el.dataset.messageId;
	el.scrollIntoView({ block: "nearest" });
}

/** Leaves the message box for navigation, the cursor on the newest message of the pane it's in. */
export function leaveMessageBox(from: Element | null) {
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	const pane = from?.closest('[data-pane-focused="true"]') ?? shownPane();
	if (pane) placeCursor(messagesIn(pane).at(-1));
}
