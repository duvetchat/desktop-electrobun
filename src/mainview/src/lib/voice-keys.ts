// The mute and deafen shortcuts (#357, COPY.md §6): ⇧⌘M and ⇧⌘D on macOS, Ctrl Shift M and Ctrl Shift D elsewhere. They
// work in the desktop app, in the main window and in the media controls' pop-out, whichever has the keyboard. On the
// web they aren't taken: browsers keep them (Chrome's profile menu, bookmark all tabs).

export type VoiceKey = "mute" | "deafen";

type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** The shortcut a key press is, or null. The primary modifier alone with Shift: ⌘ on macOS, Ctrl elsewhere. */
export function voiceKey(e: KeyLike, isMac: boolean): VoiceKey | null {
	const primary = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
	if (!primary || !e.shiftKey || e.altKey) return null;
	const key = e.key.toLowerCase();
	if (key === "m") return "mute";
	if (key === "d") return "deafen";
	return null;
}

/** A shortcut as the app writes it: "⇧⌘M" on macOS, "Ctrl Shift M" elsewhere. */
export function voiceKeyLabel(key: VoiceKey, isMac: boolean): string {
	const letter = key === "mute" ? "M" : "D";
	return isMac ? `⇧⌘${letter}` : `Ctrl Shift ${letter}`;
}

/** Both labels, for the controls' tooltips. */
export function voiceKeyLabels(isMac: boolean): { mute: string; deafen: string } {
	return { mute: voiceKeyLabel("mute", isMac), deafen: voiceKeyLabel("deafen", isMac) };
}
