// A message's edit box (InlineMessageEditor.svelte, #357): its own text, edited where it is. Since #577 a save answers
// once the engine took or refused the change, which waits for the engine's turn (T-M1), and until that word comes the
// box takes nothing more (#578): a second Save would make the edit twice, a Discard would close a box whose edit goes
// all the same, and what was typed meanwhile would be lost as the answer lands. The text stays as it was saved.
// From its first save, the chat keeps the edit (#584): whatever unmounts its box (another chat, a READY's remount, its
// row leaving the list) finds it again by its message, and nothing but its save's answer closes it while it waits. An
// answer that leaves the edit open (a refusal, the person's no) keeps it the chat's, with what was typed, until the
// person closes it.
import { SvelteMap } from "svelte/reactivity";

/** What a save answers: nothing once the change is taken or there was nothing to save, a refusal's words, said at the
 * message, or false for the person's no to the question its conversation asked first. */
type Saved = void | string | false;

/** The boxes kept from their first save, by message, until it's taken or the person closes them. */
const kept = new SvelteMap<string, EditBox>();

/** The edit a chat keeps open, from its first save on: none while it keeps none. */
export function keptIn(chat: string): EditBox | undefined {
	for (const box of kept.values()) if (box.chat === chat) return box;
}

/** The box of an edit of the message: the one kept, as it was, or a new one with its text. */
export const editBoxOf = (chat: string, message: string, content: string) =>
	kept.get(message) ?? new EditBox(chat, message, content);

export class EditBox {
	readonly chat: string;
	readonly message: string;
	/** The text in the box: what the person typed, or, while a save waits, what it saves. */
	text = $state("");
	/** A save waits for the engine's word. */
	saving = $state(false);
	/** The words the last save was refused with, said at the message: null when it wasn't. */
	refused = $state<string | null>(null);

	constructor(chat: string, message: string, content: string) {
		this.chat = chat;
		this.message = message;
		this.text = content;
	}

	/** The person's typing: the box's text, unless a save waits, whose text stays as it was saved. */
	type(text: string) {
		if (!this.saving) this.text = text;
	}

	/** The person's Save: one at a time, and nothing more until its answer, whatever it is. Kept from now on. */
	async save(save: (text: string) => Saved | Promise<Saved>): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		kept.set(this.message, this);
		try {
			const said = await save(this.text);
			this.refused = typeof said === "string" ? said : null;
			if (said === undefined) this.#letGo();
		} finally {
			this.saving = false;
		}
	}

	/** The person's Discard or Esc: none while a save waits for its word, as the edit may still be refused there. */
	discard(close: () => void) {
		if (this.close()) close();
	}

	/** The chat closes the edit (another edit, a reply, a mention): whether it could, which it can't while a save waits. */
	close(): boolean {
		if (this.saving) return false;
		this.#letGo();
		return true;
	}

	#letGo() {
		if (kept.get(this.message) === this) kept.delete(this.message);
	}
}
