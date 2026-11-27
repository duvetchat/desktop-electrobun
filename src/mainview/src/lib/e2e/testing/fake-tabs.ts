// What tabs.ts's tests and the app engine's give it for navigator.locks and a BroadcastChannel (PLAN-E2E-CLIENTES.md,
// the web's worker, lock and tabs): fakes that do what the browser's do, as tabs.ts uses them.
import type { ChannelLike, LockManagerLike } from "../web/tabs";

/**
 * navigator.locks for one name at a time: whoever asked first holds it until its callback settles. An abort takes a
 * request out of the line, and does nothing to one that holds the lock, as the API's does.
 */
export class FakeLocks implements LockManagerLike {
	#queues = new Map<string, { callback: () => Promise<void>; resolve: (value: unknown) => void; granted?: true }[]>();
	#held = new Set<string>();

	request(name: string, { signal }: { signal: AbortSignal }, callback: () => Promise<void>): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const queue = this.#queues.get(name) ?? [];
			this.#queues.set(name, queue);
			const entry: { callback: () => Promise<void>; resolve: (value: unknown) => void; granted?: true } = {
				callback,
				resolve,
			};
			queue.push(entry);
			signal.addEventListener("abort", () => {
				const at = queue.indexOf(entry);
				if (at === -1 || entry.granted) return;
				queue.splice(at, 1);
				reject(new DOMException("aborted", "AbortError"));
			});
			this.#grant(name);
		});
	}

	#grant(name: string) {
		const next = this.#queues.get(name)?.[0];
		if (!next || this.#held.has(name)) return;
		this.#held.add(name);
		next.granted = true;
		void next
			.callback()
			.finally(() => {
				this.#queues.get(name)?.shift();
				this.#held.delete(name);
				this.#grant(name);
			})
			.then(next.resolve, next.resolve);
	}
}

/**
 * BroadcastChannel among the tabs of one test: each message, cloned as it's posted, reaches every other channel of its
 * name. What can't be cloned throws as it's posted, listeners or not; what a listener throws is kept, as an EventTarget
 * reports it and goes on.
 */
export class FakeHub {
	#channels = new Set<{ name: string; listeners: Set<(event: { data: unknown }) => void> }>();
	/** Every message posted, in order. */
	readonly posted: unknown[] = [];
	/** What the listeners threw. */
	readonly thrown: unknown[] = [];
	#pending = 0;

	channel(name: string): ChannelLike {
		const self = { name, listeners: new Set<(event: { data: unknown }) => void>() };
		this.#channels.add(self);
		return {
			postMessage: (message) => {
				const data = structuredClone(message);
				this.posted.push(message);
				for (const other of this.#channels) {
					if (other === self || other.name !== name) continue;
					this.#pending++;
					setTimeout(() => {
						this.#pending--;
						for (const listener of other.listeners) {
							try {
								listener({ data: structuredClone(data) });
							} catch (error) {
								this.thrown.push(error);
							}
						}
					}, 0);
				}
			},
			addEventListener: (_type, listener) => self.listeners.add(listener),
			close: () => this.#channels.delete(self),
		};
	}

	/**
	 * Settles once every message posted so far has reached its listeners, and those they posted meanwhile: what a test
	 * waits for before a tab goes, as a browser delivers a message that was posted before it (desktop-electrobun#568).
	 */
	async delivered(): Promise<void> {
		while (this.#pending > 0) await new Promise((resolve) => setTimeout(resolve, 0));
	}
}
