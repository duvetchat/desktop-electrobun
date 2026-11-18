// Values the app's windows share (#357). The Settings windows have none of the app's stores: the main window owns
// each value (the user, their buckets, a Space, the preferences) and publishes it; a window mirrors it into a store of
// its own, and what a window changes there is written back to the main window, which publishes the result to all.
// The main window is the one authority, so the windows end up agreeing with it whatever order the messages cross in.
// What carries the values is the callers': lib/window-link.ts's numbered states out, and a command in.

/** A value as both sides hold it: something JSON carries. */
export interface Shared<Value = unknown> {
	get(): Value;
	set(value: Value): void;
	/** Calls back after each change of the value; returns what stops it. */
	watch(changed: () => void): () => void;
}

/**
 * Watches one Space in a store of Spaces, for a `Shared`'s `watch`: calls back when that Space's object is another
 * one, comes or goes, and not when any other Space changes. The stores give a Space a new object with each change to
 * it and keep the others', so a busy Space elsewhere costs the watched one nothing (no copy, no comparison).
 */
export function watchSpace<Space extends { id: string }>(
	spaces: { subscribe(run: (value: Space[]) => void): () => void },
	spaceId: string,
	changed: () => void,
): () => void {
	let last: Space | null | undefined;
	return spaces.subscribe((all) => {
		const space = all.find((one) => one.id === spaceId) ?? null;
		if (space === last) return;
		last = space;
		changed();
	});
}

const jsonOf = (value: unknown) => JSON.stringify(value ?? null);
// The value as it crosses: a plain copy, never a store's own object or a proxy of one.
const plain = (json: string): unknown => JSON.parse(json);

/** The main window's side: publishes each shared value as it changes, and takes the windows' writes. */
export class SyncHost {
	readonly #publish: (key: string, value: unknown) => void;
	readonly #shared = new Map<string, { shared: Shared; published: string | null; stop: () => void }>();

	constructor(publish: (key: string, value: unknown) => void) {
		this.#publish = publish;
	}

	/** Shares a value under a key: published now, then each time it changes to something else. `throttleMs` gathers
	 * the changes of that long into one, for a value that changes often and is long to copy. Returns what stops it,
	 * which publishes null in its place: nothing keeps the last value for a window that opens later. */
	share<Value>(key: string, shared: Shared<Value>, { throttleMs = 0 }: { throttleMs?: number } = {}): () => void {
		this.#shared.get(key)?.stop();
		let timer: ReturnType<typeof setTimeout> | null = null;
		const entry = { shared: shared as Shared, published: null as string | null, stop: () => {} };
		const publish = () => {
			timer = null;
			const json = jsonOf(shared.get());
			if (json === entry.published) return;
			entry.published = json;
			this.#publish(key, plain(json));
		};
		const unwatch = shared.watch(() => {
			if (throttleMs <= 0) publish();
			else timer ??= setTimeout(publish, throttleMs);
		});
		entry.stop = () => {
			unwatch();
			if (timer !== null) clearTimeout(timer);
			if (this.#shared.get(key) === entry) {
				this.#shared.delete(key);
				this.#publish(key, null);
			}
		};
		this.#shared.set(key, entry);
		publish();
		return entry.stop;
	}

	/** Whether a key is shared now. */
	shares(key: string): boolean {
		return this.#shared.has(key);
	}

	/** A window's write of a value: set here, and published to every window as it then is (what set made of it). False
	 * for a key nothing shares. */
	write(key: string, value: unknown): boolean {
		const entry = this.#shared.get(key);
		if (!entry) return false;
		entry.shared.set(value);
		// Published even if the watch didn't see a change: the writer waits for the main window's word.
		const json = jsonOf(entry.shared.get());
		if (json !== entry.published) {
			entry.published = json;
			this.#publish(key, plain(json));
		}
		return true;
	}
}

/** A window's side: mirrors the main window's values into its own, and sends back what the window changes. */
export class SyncGuest {
	readonly #send: (key: string, value: unknown) => Promise<unknown>;
	readonly #mirrored = new Map<
		string,
		{
			shared: Shared;
			readOnly: boolean;
			/** The value both sides last agreed on, or the one this window last sent. */
			known: string | null;
			/** Writes sent and not yet answered. */
			pending: number;
			/** The main window's latest word, kept while a write is on its way. */
			latest: { json: string } | null;
		}
	>();
	/** The main window's values that arrived for a key nothing mirrors yet. */
	readonly #early = new Map<string, string>();

	constructor(send: (key: string, value: unknown) => Promise<unknown>) {
		this.#send = send;
	}

	/** Mirrors a key into a value of this window. A `readOnly` one is never written back: what the window does to it
	 * lasts until the main window's next word. Returns what stops it. */
	mirror<Value>(key: string, shared: Shared<Value>, { readOnly = false }: { readOnly?: boolean } = {}): () => void {
		const entry = { shared: shared as Shared, readOnly, known: null as string | null, pending: 0, latest: null };
		this.#mirrored.set(key, entry);
		const early = this.#early.get(key);
		if (early !== undefined) {
			this.#early.delete(key);
			this.#apply(entry, early);
		}
		const unwatch = shared.watch(() => this.#changedHere(key));
		return () => {
			unwatch();
			if (this.#mirrored.get(key) === entry) this.#mirrored.delete(key);
		};
	}

	/** Whether the main window's value of a key has arrived. */
	has(key: string): boolean {
		return (this.#mirrored.get(key)?.known ?? null) !== null;
	}

	/** The main window's word on a key. While a write of this window's is on its way, it waits: the answer to the write
	 * comes after it, and what counts is the main window's last word then. */
	accept(key: string, value: unknown): void {
		const json = jsonOf(value);
		const entry = this.#mirrored.get(key);
		if (!entry) {
			this.#early.set(key, json);
			return;
		}
		if (entry.pending > 0) entry.latest = { json };
		else this.#apply(entry, json);
	}

	#apply(entry: { shared: Shared; known: string | null }, json: string) {
		entry.known = json;
		if (jsonOf(entry.shared.get()) !== json) entry.shared.set(plain(json));
	}

	#changedHere(key: string) {
		const entry = this.#mirrored.get(key);
		if (!entry || entry.readOnly) return;
		const json = jsonOf(entry.shared.get());
		if (json === entry.known) return;
		entry.known = json;
		entry.pending++;
		const settle = () => {
			entry.pending--;
			if (entry.pending > 0 || !entry.latest) return;
			const { json: latest } = entry.latest;
			entry.latest = null;
			this.#apply(entry, latest);
		};
		this.#send(key, plain(json)).then(settle, settle);
	}
}
