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

/** Which channels a window mirrors: its page is sent those, and no other. */
export type MirroredChannels = (channel: string) => boolean;

interface Mirror {
	send: (message: WindowStateMessage) => void;
	mirrors: MirroredChannels;
}

export class WindowRelay {
	#askMain: ((command: WindowCommand) => Promise<WindowAnswer>) | null = null;
	readonly #others = new Map<number, Mirror>();
	// Each channel's latest state, all of one page of the main window: the one that started at #epoch.
	readonly #latest = new Map<string, WindowStateMessage>();
	#epoch: number | null = null;

	/** The main window's page answers commands through `ask`; null once the main window is gone. */
	setMain(ask: ((command: WindowCommand) => Promise<WindowAnswer>) | null) {
		this.#askMain = ask;
	}

	/** Another window opened: it gets the latest state of each channel it mirrors at once, then each new one. Call once
	 * its page can take messages. `mirrors` says which channels are its own: a window is sent no other, so the media
	 * controls' pop-out never holds what Settings shows, nor a Space's settings another Space's. */
	add(windowId: number, send: (message: WindowStateMessage) => void, mirrors: MirroredChannels) {
		const mirror = { send, mirrors };
		this.#others.set(windowId, mirror);
		for (const message of this.#latest.values()) this.#deliver(windowId, mirror, message);
	}

	remove(windowId: number) {
		this.#others.delete(windowId);
	}

	/** How many windows mirror the main one. */
	get mirrors(): number {
		return this.#others.size;
	}

	/** How many channels have a state kept for a window that opens later. */
	get kept(): number {
		return this.#latest.size;
	}

	/** A state from the main window's page: kept as its channel's latest, and sent on to each window that mirrors the
	 * channel. One that isn't newer than the latest is dropped: a page never mirrors backwards. A page's states all
	 * carry one epoch, the time its one publisher started (lib/window-hub.ts), so a state of another epoch is another
	 * page's, a reload or the next sign-in: everything the page before it published is let go of, and a window that
	 * opens afterwards is handed nothing of an earlier session. Another epoch, not a later one: the computer's clock
	 * can be set back between two pages. */
	stateFromMain(message: WindowStateMessage) {
		if (message.epoch !== this.#epoch) {
			this.#latest.clear();
			this.#epoch = message.epoch;
		}
		const last = this.#latest.get(message.channel);
		if (last && message.seq <= last.seq) return;
		this.#latest.set(message.channel, message);
		for (const [windowId, mirror] of this.#others) this.#deliver(windowId, mirror, message);
	}

	/** Lets go of every state kept: the main window's page left the app (signed out), or the main window closed. The
	 * page that comes next publishes its own. */
	reset() {
		this.#latest.clear();
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
	#deliver(windowId: number, mirror: Mirror, message: WindowStateMessage) {
		if (!mirror.mirrors(message.channel)) return;
		try {
			mirror.send(message);
		} catch (err) {
			console.error(`[windows] window ${windowId} took no state, and is dropped:`, err);
			this.#others.delete(windowId);
		}
	}
}
