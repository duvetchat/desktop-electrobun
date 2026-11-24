/** A prompt's words: as they are (a name), or what says them (() => t(…)), asked as the dialog draws, so a language
 * switched while it's open (in Settings, its own window, or the system's under Match system) reaches them. */
export type PromptWords = string | (() => string);

interface PromptState {
	message: PromptWords;
	placeholder?: PromptWords;
	resolve: (value: string | null) => void;
}

/** A prompt's words, said now. */
export function say(words: PromptWords): string;
export function say(words: PromptWords | undefined): string | undefined;
export function say(words: PromptWords | undefined): string | undefined {
	return typeof words === "function" ? words() : words;
}

class PromptStore {
	pending = $state<PromptState | null>(null);
	value = $state("");

	prompt(message: PromptWords, placeholder: PromptWords = "", initial = ""): Promise<string | null> {
		return new Promise((resolve) => {
			this.value = initial;
			this.pending = { message, placeholder, resolve };
		});
	}

	resolve(value: string | null) {
		this.pending?.resolve(value);
		this.pending = null;
	}
}

export const promptStore = new PromptStore();

/** Asks for a line of text, starting from `initial` when there's something to change. */
export function promptDialog(
	message: PromptWords,
	placeholder: PromptWords = "",
	initial = "",
): Promise<string | null> {
	return promptStore.prompt(message, placeholder, initial);
}
