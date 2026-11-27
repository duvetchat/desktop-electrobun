// A message's edit box (InlineMessageEditor.svelte, #357): its own text, edited where it is. Since #577 a save answers
// once the engine took or refused the change, which waits for the engine's turn (T-M1), and until that word comes the
// box takes nothing more (#578): a second Save would make the edit twice, a Discard would close a box whose edit goes
// all the same, and what was typed meanwhile would be lost as the answer lands. The text stays as it was saved.

/** What a save answers: nothing once the change is taken, or a refusal's words, said at the message. */
type Saved = void | string;

export class EditBox {
	/** The text in the box: what the person typed, or, while a save waits, what it saves. */
	text = $state("");
	/** A save waits for the engine's word. */
	saving = $state(false);
	/** The words the last save was refused with, said at the message: null when it wasn't. */
	refused = $state<string | null>(null);
	readonly #save: (text: string) => Saved | Promise<Saved>;
	readonly #discard: () => void;

	/** `save` makes the change and answers once it's taken or refused; `discard` closes the box. */
	constructor(content: string, save: (text: string) => Saved | Promise<Saved>, discard: () => void) {
		this.text = content;
		this.#save = save;
		this.#discard = discard;
	}

	/** The person's typing: the box's text, unless a save waits, whose text stays as it was saved. */
	type(text: string) {
		if (!this.saving) this.text = text;
	}

	/** The person's Save: one at a time, and nothing more until its answer, whatever it is. */
	async save(): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		try {
			const said = await this.#save(this.text);
			this.refused = typeof said === "string" ? said : null;
		} finally {
			this.saving = false;
		}
	}

	/** The person's Discard or Esc: none while a save waits for its word, as the edit may still be refused there. */
	discard() {
		if (!this.saving) this.#discard();
	}
}
