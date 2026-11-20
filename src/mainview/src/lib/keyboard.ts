/**
 * The app's keyboard: shortcuts with a modifier, which always work, and single keys, which move around once the user
 * turned keyboard navigation on and left the message box (Esc). Typing stays the default: a key that isn't one of
 * these goes to the message box, as before.
 */
export type KeyCommand =
	| { kind: "message"; step: 1 | -1 }
	| { kind: "newest" }
	| { kind: "chat"; step: 1 | -1 }
	| { kind: "tab"; index: number }
	| { kind: "unread" }
	| { kind: "reply" }
	| { kind: "edit" }
	| { kind: "write" }
	| { kind: "marks" }
	| { kind: "help" }
	| { kind: "clear" };

export type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** A digit key's tab: 1 is the first open chat, 9 the last, as browsers have it. */
function tabOf(key: string): KeyCommand | null {
	if (!/^[1-9]$/.test(key)) return null;
	return { kind: "tab", index: key === "9" ? -1 : Number(key) - 1 };
}

/**
 * A shortcut with a modifier: ⌘ on macOS, Ctrl elsewhere, with 1–9 for the open chats and / for the shortcuts; Alt
 * with ↑ or ↓ for the chat before or after, and Alt+Shift+↓ for the next one with unread messages.
 */
export function shortcutCommand(e: KeyLike, isMac: boolean): KeyCommand | null {
	const primary = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
	if (primary && !e.altKey && !e.shiftKey) {
		if (e.key === "/") return { kind: "help" };
		return tabOf(e.key);
	}
	if (e.altKey && !e.metaKey && !e.ctrlKey) {
		if (e.key === "ArrowDown") return e.shiftKey ? { kind: "unread" } : { kind: "chat", step: 1 };
		if (e.key === "ArrowUp" && !e.shiftKey) return { kind: "chat", step: -1 };
	}
	return null;
}

/**
 * A single key while navigating: j and k (or ↓ and ↑) for the next and previous message, G for the newest, J and K
 * for the next and previous chat, 1–9 for an open chat, u for the next unread one, r to reply, e to edit, i or Enter
 * to write, f for the jump marks, ? for the shortcuts, Esc to stop.
 */
export function navigationCommand(e: KeyLike): KeyCommand | null {
	if (e.metaKey || e.ctrlKey || e.altKey) return null;
	switch (e.key) {
		case "j":
		case "ArrowDown":
			return { kind: "message", step: 1 };
		case "k":
		case "ArrowUp":
			return { kind: "message", step: -1 };
		case "G":
			return { kind: "newest" };
		case "J":
			return { kind: "chat", step: 1 };
		case "K":
			return { kind: "chat", step: -1 };
		case "u":
			return { kind: "unread" };
		case "r":
			return { kind: "reply" };
		case "e":
			return { kind: "edit" };
		case "i":
		case "Enter":
			return { kind: "write" };
		case "f":
			return { kind: "marks" };
		case "?":
			return { kind: "help" };
		case "Escape":
			return { kind: "clear" };
		default:
			return tabOf(e.key);
	}
}

/** An index `step` places from `current` in a list of `length`, going round at either end; the first or the last
 * when nothing is current. */
export function stepIndex(length: number, current: number, step: 1 | -1): number {
	if (length <= 0) return -1;
	if (current < 0) return step > 0 ? 0 : length - 1;
	return (current + step + length) % length;
}

/** The tab a tab command picks: by its index, -1 being the last. */
export function tabAt<T>(tabs: readonly T[], index: number): T | null {
	return (index < 0 ? tabs[tabs.length - 1] : tabs[index]) ?? null;
}

/**
 * The digit that, with ⌘ or Ctrl, picks the tab at `index` of `count` open ones, as tabOf reads the keys: 1 to 8 for
 * the first eight, and 9 for the last one after them. None for a tab between the eighth and the last, which no digit
 * picks.
 */
export function tabDigit(index: number, count: number): number | null {
	if (index < 0 || index >= count) return null;
	if (index < 8) return index + 1;
	return index === count - 1 ? 9 : null;
}

/** The first chat with unread messages after the one shown, in the column's order and going round; none when the
 * only ones are the one shown. */
export function nextUnread(
	order: readonly string[],
	unread: ReadonlySet<string>,
	shownId: string | null,
): string | null {
	const start = shownId ? order.indexOf(shownId) : -1;
	for (let i = 1; i <= order.length; i++) {
		const id = order[(start + i + order.length) % order.length]!;
		if (id !== shownId && unread.has(id)) return id;
	}
	return null;
}

const MARK_KEYS = "asdfghjklqwertyuiopzxcvbnm";

/** The labels of `count` jump marks: one letter each while they fit, else two, all the same length so no label starts
 * another. */
export function markLabels(count: number): string[] {
	if (count <= 0) return [];
	if (count <= MARK_KEYS.length) return [...MARK_KEYS.slice(0, count)];
	const labels: string[] = [];
	for (const a of MARK_KEYS) {
		for (const b of MARK_KEYS) {
			labels.push(a + b);
			if (labels.length === count) return labels;
		}
	}
	return labels;
}

/** What isTyping reads of an element: its tag, an input's type, and whether its text is editable. */
export type TypingTarget = { tagName: string; type?: string; isContentEditable?: boolean };

/** Whether keys pressed in an element are typing: a text field, a text area, a select or editable text. */
export function isTyping(el: TypingTarget | null): boolean {
	if (!el) return false;
	if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
	if (el.tagName === "INPUT") {
		return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(el.type ?? "text");
	}
	return el.isContentEditable === true;
}

/**
 * Whether a chat takes a key it shares with the other panes' chats, which all hear it on window: Ctrl+↑ and Ctrl+↓,
 * which pick a message to reply to, or with Shift one of the user's to edit. The chat the focus is in takes it (its
 * message box, an edit's box); with the focus in no chat, the focused pane's. focused is the focused element, and chat
 * the chat's root, which a chat marks data-chat.
 */
export function takesChatShortcut(
	focused: { closest(selectors: string): unknown } | null,
	chat: unknown,
	paneFocused: boolean,
): boolean {
	const holder = focused?.closest("[data-chat]");
	return holder ? holder === chat : paneFocused;
}
