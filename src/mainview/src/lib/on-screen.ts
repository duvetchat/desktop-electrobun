import { writable, type Readable } from "svelte/store";

/**
 * The chats on screen: the active room or conversation of each pane while the panes show (not under the Friends view).
 * A chat on screen in a focused window notifies nothing (lib/notifications.ts). Two panes can show one chat, so each
 * showing counts, and the chat leaves the set when the last of them lets it go.
 */
const counts = new Map<string, number>();
const shown = writable<ReadonlySet<string>>(new Set());
export const chatsOnScreen: Readable<ReadonlySet<string>> = { subscribe: shown.subscribe };

/** Shows a chat until the function it returns is called; calling that again changes nothing. */
export function showChat(id: string): () => void {
	counts.set(id, (counts.get(id) ?? 0) + 1);
	shown.set(new Set(counts.keys()));
	let showing = true;
	return () => {
		if (!showing) return;
		showing = false;
		const left = (counts.get(id) ?? 1) - 1;
		if (left > 0) counts.set(id, left);
		else counts.delete(id);
		shown.set(new Set(counts.keys()));
	};
}
