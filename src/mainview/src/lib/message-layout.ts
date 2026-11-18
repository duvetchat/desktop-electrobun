/** How a chat draws its messages (#357): bubbles, the default, or flat rows, which fit more on screen. Saved on this
 * device, under a key of its own: the shell's layout prefs (lib/layout-prefs.ts) are another value, which older builds
 * read. */
export const MESSAGE_LAYOUT_KEY = "duvet.messages.layout.v1";

export type MessageLayout = "bubbles" | "flat";

export const defaultMessageLayout: MessageLayout = "bubbles";

/** The layout a saved value holds; the default for none, or for anything else. */
export function parseMessageLayout(raw: string | null): MessageLayout {
	return raw === "flat" || raw === "bubbles" ? raw : defaultMessageLayout;
}
