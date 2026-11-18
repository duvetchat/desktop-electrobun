// The relay between the app's windows (#357, docs/redesign/PLATFORM.md §4). Only the main window's page holds the
// gateway connection and the call; the media controls' pop-out and the Settings windows mirror state it owns and ask
// it to act. Their pages can't reach each other, so both cross the Bun process: the main page's numbered states go out
// to every other window, and another window's command goes to the main page, whose answer comes back. The page-side
// halves are src/mainview/src/lib/window-link.ts (the shapes below are its own) and lib/electrobun-rpc.ts.
//
// Each window has its own RPC instance (an instance has one transport), so the relay holds one function per window:
// what sends that window a state, and what asks the main page a command.

export interface WindowStateMessage {
	channel: string;
	/** When the main window's page started: its numbers start over with a reload. */
	epoch: number;
	seq: number;
	sentAt: number;
	value: unknown;
}

export interface WindowCommand {
	channel: string;
	name: string;
	args?: unknown;
}

export type WindowAnswer = { ok: true; result: unknown } | { ok: false; error: string };

const newer = (message: WindowStateMessage, last: WindowStateMessage | undefined) =>
	!last || (message.epoch !== last.epoch ? message.epoch > last.epoch : message.seq > last.seq);

export class WindowRelay {
	#askMain: ((command: WindowCommand) => Promise<WindowAnswer>) | null = null;
	readonly #others = new Map<number, (message: WindowStateMessage) => void>();
	readonly #latest = new Map<string, WindowStateMessage>();

	/** The main window's page answers commands through `ask`; null once the main window is gone. */
	setMain(ask: ((command: WindowCommand) => Promise<WindowAnswer>) | null) {
		this.#askMain = ask;
	}

	/** Another window opened: it gets every channel's latest state at once, then each new one. Call once its page can
	 * take messages (its dom-ready). */
	add(windowId: number, send: (message: WindowStateMessage) => void) {
		this.#others.set(windowId, send);
		for (const message of this.#latest.values()) this.#deliver(windowId, send, message);
	}

	remove(windowId: number) {
		this.#others.delete(windowId);
	}

	/** How many windows mirror the main one. */
	get mirrors(): number {
		return this.#others.size;
	}

	/** A state from the main window's page: kept as its channel's latest, and sent on to every other window. One that
	 * isn't newer than the latest is dropped: a page never mirrors backwards. */
	stateFromMain(message: WindowStateMessage) {
		if (!newer(message, this.#latest.get(message.channel))) return;
		this.#latest.set(message.channel, message);
		for (const [windowId, send] of this.#others) this.#deliver(windowId, send, message);
	}

	/** A command from another window, for the main window's page: its answer, or why there is none. */
	async commandFromWindow(command: WindowCommand): Promise<WindowAnswer> {
		if (!this.#askMain) return { ok: false, error: "The main window is closed" };
		try {
			return await this.#askMain(command);
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	}

	// A window that can't be sent to (closed without telling) stops being one: its failure isn't the others'.
	#deliver(windowId: number, send: (message: WindowStateMessage) => void, message: WindowStateMessage) {
		try {
			send(message);
		} catch (err) {
			console.error(`[windows] window ${windowId} took no state, and is dropped:`, err);
			this.#others.delete(windowId);
		}
	}
}
