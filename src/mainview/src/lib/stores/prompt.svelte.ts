interface PromptState {
	message: string;
	placeholder?: string;
	resolve: (value: string | null) => void;
}

class PromptStore {
	pending = $state<PromptState | null>(null);
	value = $state("");

	prompt(message: string, placeholder = "", initial = ""): Promise<string | null> {
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
export function promptDialog(message: string, placeholder = "", initial = ""): Promise<string | null> {
	return promptStore.prompt(message, placeholder, initial);
}
