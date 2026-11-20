import { currentShell, type Os } from "$lib/platform";

/** How a chat draws its messages (#357): bubbles on Apple's systems, flat rows elsewhere, which fit more on screen.
 * Saved on this device, under a key of its own: the shell's layout prefs (lib/layout-prefs.ts) are another value, which
 * older builds read. */
export const MESSAGE_LAYOUT_KEY = "duvet.messages.layout.v1";

export type MessageLayout = "bubbles" | "flat";

/** Bubbles on macOS and iOS; flat rows on everything else: Windows, Linux, the web. */
export function defaultMessageLayout(os: Os = currentShell().os): MessageLayout {
	return os === "mac" || os === "ios" ? "bubbles" : "flat";
}

/** The layout a saved value holds; the platform's default for none, or for anything else. */
export function parseMessageLayout(raw: string | null, os: Os = currentShell().os): MessageLayout {
	return raw === "flat" || raw === "bubbles" ? raw : defaultMessageLayout(os);
}
