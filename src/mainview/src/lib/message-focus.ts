/** The keyboard's way to a message's actions (#357): one message of a list is a tab stop (the one last focused, or
 * the newest), the arrows move the focus between messages, and the focused message shows its bar, which Tab enters.
 * Enter opens its menu. One stop for the whole list, however long: the rest are focusable only from here. */

/** What a key does while a message has the focus. */
export type RowKey = "older" | "newer" | "oldest" | "newest" | "menu";

type Key = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">;

export function rowKey(e: Key): RowKey | null {
	// Shift+F10 is the menu key where a keyboard has none.
	if (e.key === "F10" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) return "menu";
	if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return null;
	switch (e.key) {
		case "ArrowUp":
			return "older";
		case "ArrowDown":
			return "newer";
		case "Home":
			return "oldest";
		case "End":
			return "newest";
		case "Enter":
		case "ContextMenu":
			return "menu";
		default:
			return null;
	}
}

/** The message the focus goes to from `from`, in a list given newest first; null where there is none that way. */
export function rowToward(ids: readonly string[], from: string, key: Exclude<RowKey, "menu">): string | null {
	const at = ids.indexOf(from);
	if (at < 0) return null;
	const to = key === "older" ? at + 1 : key === "newer" ? at - 1 : key === "oldest" ? ids.length - 1 : 0;
	return to === at ? null : (ids[to] ?? null);
}

/** The list's one tab stop: the message that had the focus last while it's still there, else the newest. */
export function tabStop(ids: readonly string[], last: string | null): string | null {
	return last !== null && ids.includes(last) ? last : (ids[0] ?? null);
}

/** Whether the focus, leaving a message for `to`, stays with that message: in one of its own layers (its menu, its
 * emoji picker, which are drawn outside the list), or nowhere for a moment while such a layer is open or closing.
 * `inList` says whether `to` is in the message list. */
export function staysWithRow(
	to: { closest(selectors: string): unknown } | null,
	inList: boolean,
	layerOpen: boolean,
): boolean {
	if (!to) return layerOpen;
	if (inList) return false;
	return to.closest('[role="menu"], [role="dialog"], [data-bits-floating-content-wrapper]') !== null;
}
