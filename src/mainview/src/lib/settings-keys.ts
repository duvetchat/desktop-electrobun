// The keys that close a Settings window (#357, DESIGN-MAP.md S-47): Esc, when nothing in it is being typed in and no
// dialog, menu or popover is open over it (Esc is theirs then), and ⌘W, or Ctrl W on Windows and Linux.

/** A key press, with what the page was doing when it came. */
export interface WindowPress {
	key: string;
	meta: boolean;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	/** Whether the focus is in something typed in: a field, a text area, a select. */
	typing: boolean;
	/** Whether a dialog, a menu or a popover is open over the screen. */
	overlay: boolean;
}

export function closesSettingsWindow(press: WindowPress, mac: boolean): boolean {
	if (press.alt || press.shift) return false;
	if (press.key === "Escape") return !press.meta && !press.ctrl && !press.typing && !press.overlay;
	if (press.key.toLowerCase() !== "w") return false;
	return mac ? press.meta && !press.ctrl : press.ctrl && !press.meta;
}

const TYPED_IN = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const OVERLAYS = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-popover-content]";

/** A keyboard event as a press, read against the page it came to. */
export function pressIn(
	event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
	page: Pick<Document, "activeElement" | "querySelector">,
): WindowPress {
	return {
		key: event.key,
		meta: event.metaKey,
		ctrl: event.ctrlKey,
		alt: event.altKey,
		shift: event.shiftKey,
		typing: page.activeElement?.matches(TYPED_IN) ?? false,
		overlay: page.querySelector(OVERLAYS) !== null,
	};
}
