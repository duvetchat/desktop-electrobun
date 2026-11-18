// What the app's windows say to each other (#357, docs/redesign/PLATFORM.md §4). Only the main window holds the
// gateway connection and the call; another window (the media controls' pop-out, Settings) shows state the main window
// owns, and asks it to act. Both go through the Bun process, which relays them (src/bun/window-relay.ts), over the
// app's RPC (lib/electrobun-rpc.ts):
//   - state: the main window publishes each change of a channel as a numbered message, and the others mirror it. The
//     spike measured the relay in order with nothing missing (5,000 messages in a burst); the numbers are what lets
//     a mirror say so, and drop a message that arrives behind a newer one;
//   - commands: another window asks the main one to do something by name, and gets its answer.
// The session and the theme don't travel this way: the windows share localStorage, and its storage event.

/** One state of a channel, as the main window published it. */
export interface WindowStateMessage {
	/** What the state is of: "media" for the media controls'. */
	channel: string;
	/** When the publishing page started: its numbers start over with it, after a reload of the main window. */
	epoch: number;
	/** 1, 2, 3… within the epoch and the channel. */
	seq: number;
	sentAt: number;
	/** The state itself: anything JSON carries. */
	value: unknown;
}

/** What another window asks the main one to do. */
export interface WindowCommand {
	channel: string;
	name: string;
	args?: unknown;
}

/** The main window's answer, or why there is none. */
export type WindowAnswer = { ok: true; result: unknown } | { ok: false; error: string };

/** Whether a state is newer than the last one taken: a later page's, or a later number of the same page. */
export function isNewer(message: WindowStateMessage, last: WindowStateMessage | null | undefined): boolean {
	if (!last) return true;
	if (message.epoch !== last.epoch) return message.epoch > last.epoch;
	return message.seq > last.seq;
}

/** The main window's side: numbers each state of each channel and sends it on. */
export class StatePublisher {
	readonly #send: (message: WindowStateMessage) => void;
	readonly #now: () => number;
	readonly #epoch: number;
	readonly #seqs = new Map<string, number>();

	constructor(send: (message: WindowStateMessage) => void, now: () => number = Date.now) {
		this.#send = send;
		this.#now = now;
		this.#epoch = now();
	}

	publish(channel: string, value: unknown): WindowStateMessage {
		const seq = (this.#seqs.get(channel) ?? 0) + 1;
		this.#seqs.set(channel, seq);
		const message = { channel, epoch: this.#epoch, seq, sentAt: this.#now(), value };
		this.#send(message);
		return message;
	}
}

/** Another window's side: the latest state of one channel, for whoever listens. */
export class StateMirror<Value> {
	readonly #channel: string;
	readonly #listeners = new Set<(value: Value) => void>();
	#last: WindowStateMessage | null = null;
	/** How many messages arrived behind a newer one and were dropped: 0 unless the relay reorders. */
	dropped = 0;

	constructor(channel: string) {
		this.#channel = channel;
	}

	/** Takes a message off the RPC; false when it's another channel's, or not newer than the last. */
	accept(message: WindowStateMessage): boolean {
		if (message.channel !== this.#channel) return false;
		if (!isNewer(message, this.#last)) {
			this.dropped++;
			return false;
		}
		this.#last = message;
		// The value is the main window's own, of this channel: its shape is the two pages' agreement.
		for (const listener of [...this.#listeners]) listener(this.latest!);
		return true;
	}

	/** The latest state, or undefined before the first arrives. */
	get latest(): Value | undefined {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what crossed the RPC is untyped; see accept
		return this.#last ? (this.#last.value as Value) : undefined;
	}

	/** Calls back with each new state, and at once with the latest if there is one; returns what stops it. */
	subscribe(listener: (value: Value) => void): () => void {
		this.#listeners.add(listener);
		const latest = this.latest;
		if (this.#last && latest !== undefined) listener(latest);
		return () => this.#listeners.delete(listener);
	}
}

/** What the main window can be asked to do, by channel and name. */
export type CommandHandlers = Record<string, Record<string, (args: unknown) => unknown>>;

/** The main window's answer to a command: its handler's result, or why not (no such command, or it threw). */
export async function answerCommand(handlers: CommandHandlers, command: WindowCommand): Promise<WindowAnswer> {
	const handler = Object.hasOwn(handlers, command.channel) ? handlers[command.channel] : undefined;
	const run = handler && Object.hasOwn(handler, command.name) ? handler[command.name] : undefined;
	if (!run) return { ok: false, error: `No command ${command.channel}.${command.name}` };
	try {
		return { ok: true, result: (await run(command.args)) ?? null };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
