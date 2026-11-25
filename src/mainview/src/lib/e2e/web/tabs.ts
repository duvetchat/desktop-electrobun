// One tab at a time (PLAN-E2E-CLIENTES.md, the web's worker, lock and tabs; Ruling 16): of a user's tabs, the one that
// holds the Web Lock `duvet-e2e:<user_id>` leads. It alone has the core's worker, the engine and the database; the
// others wait for the lock, so the next inherits it as the leader's tab closes, and meanwhile ask the leader over the
// BroadcastChannel of the same name, by the engine's public methods, never by the core's commands:
//   - a request `{id, from, method, params}`, which the leader answers `{id, to, ok}` or `{id, to, error}`;
//   - `{event: "leader", tab}` from a tab that starts to lead, and `{event: "changed", conversation_id}` from the leader.
// A request left unanswered goes again when a new leader says so, and the new leader runs its own: so every method
// must bear being run twice (a send carries its nonce). The methods are the caller's: the engine's (Task 12).
import { CoreError, errorFields } from "../errors";

/** What tabs.ts uses of navigator.locks. */
export interface LockManagerLike {
	request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
}

/** What tabs.ts uses of a BroadcastChannel. */
export interface ChannelLike {
	postMessage(message: unknown): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	close(): void;
}

/** The methods the leader serves, by name: each takes its params and gives what the caller gets. */
export type Methods = Record<string, (params: any) => unknown>;

/** The lock a user's tabs take turns on, and the name of their channel. */
export const lockName = (userId: string) => `duvet-e2e:${userId}`;

export interface BrowserTabsOptions {
	userId: string;
	methods: Methods;
	/** Runs once this tab holds the lock, before it serves anyone: opens the core and starts the engine. */
	lead: () => Promise<void>;
	/** A conversation the leader says changed. */
	onChanged?: (conversationId: string) => void;
	/** A tab that says it leads, another or this one. */
	onLeader?: (tab: string) => void;
	channel?: ChannelLike;
	locks?: LockManagerLike;
	/** This tab's ID, which its requests and the leader's word carry. */
	tab?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const closed = () => new CoreError("internal", "this tab left the core's tabs");

export class BrowserTabs {
	readonly tab: string;
	/** Settles once this tab leads: after its `lead` resolved, or with what it threw. */
	readonly leading: Promise<void>;
	#leader = false;
	#closed = false;
	#next = 0;
	#options: BrowserTabsOptions;
	#channel: ChannelLike;
	#stop = new AbortController();
	#release: () => void = () => {};
	/** This tab's requests without an answer, by their ID. */
	#waiting = new Map<
		string,
		{ method: string; params: unknown; resolve: (value: any) => void; reject: (error: unknown) => void }
	>();

	constructor(options: BrowserTabsOptions) {
		this.#options = options;
		this.tab = options.tab ?? crypto.randomUUID();
		this.#channel = options.channel ?? new BroadcastChannel(lockName(options.userId));
		this.#channel.addEventListener("message", (event) => this.#heard(event.data));
		const locks = options.locks ?? navigator.locks;
		this.leading = new Promise((resolve, reject) => {
			locks
				.request(lockName(options.userId), { signal: this.#stop.signal }, async () => {
					// Held until this tab closes: then the browser, or close(), lets the next one in.
					const held = new Promise<void>((release) => (this.#release = release));
					if (this.#closed) return reject(closed());
					try {
						await options.lead();
					} catch (error) {
						reject(error);
					}
					if (this.#closed) return reject(closed());
					this.#leader = true;
					this.#post({ event: "leader", tab: this.tab });
					options.onLeader?.(this.tab);
					for (const [id, waiting] of this.#waiting)
						this.#settle(id, () => this.#serve(waiting.method, waiting.params));
					resolve();
					await held;
				})
				// A request close() aborted never held the lock: the tab closed. Any other refusal, as it is.
				.catch((error: unknown) => reject(this.#closed ? closed() : error));
		});
		// Nobody has to wait for it: a tab that closes before it leads says so to whoever does.
		this.leading.catch(() => {});
	}

	/** Whether this tab leads now. */
	get leader() {
		return this.#leader;
	}

	/** Runs a method on the leader: in place in this tab when it leads, else asked over the channel. */
	call<T = unknown>(method: string, params?: unknown): Promise<T> {
		if (this.#closed) return Promise.reject(closed());
		if (this.#leader) return this.#serve(method, params);
		const id = `${this.tab}:${this.#next++}`;
		return new Promise<T>((resolve, reject) => {
			// Posted before it's kept: one the channel can't clone is refused, and nothing waits for it.
			const refused = this.#ask(id, method, params);
			if (refused) reject(refused);
			else this.#waiting.set(id, { method, params, resolve, reject });
		});
	}

	/** The leader tells the other tabs a conversation changed. */
	changed(conversationId: string) {
		if (this.#leader) this.#post({ event: "changed", conversation_id: conversationId });
	}

	/**
	 * Leaves the user's tabs: lets go of the lock, or of its place in line, and fails what it was still asking. The engine
	 * closes its host first: the next tab takes the lock at once, and a core still open here would hold the pool.
	 */
	close() {
		if (this.#closed) return;
		this.#closed = true;
		this.#leader = false;
		this.#stop.abort();
		this.#release();
		this.#channel.close();
		for (const waiting of this.#waiting.values()) waiting.reject(closed());
		this.#waiting.clear();
	}

	async #serve(method: string, params: unknown): Promise<any> {
		const run = Object.hasOwn(this.#options.methods, method) ? this.#options.methods[method] : undefined;
		if (!run) throw new CoreError("bad_command", `the tabs serve no method ${method}`, { field: "method" });
		return run(params);
	}

	/** One of this tab's requests, taken out of those waiting: it's settled once, by whichever answer comes first. */
	#take(id: string) {
		const waiting = this.#waiting.get(id);
		this.#waiting.delete(id);
		return waiting;
	}

	/** Settles one of this tab's requests with what `run` gives. */
	#settle(id: string, run: () => Promise<unknown>) {
		run().then(
			(value) => this.#take(id)?.resolve(value),
			(error: unknown) => this.#take(id)?.reject(error),
		);
	}

	#post(message: unknown) {
		if (!this.#closed) this.#channel.postMessage(message);
	}

	/** Posts one of this tab's requests: the refusal, when the channel can't clone it, else null. */
	#ask(id: string, method: string, params: unknown): CoreError | null {
		try {
			this.#post({ id, from: this.tab, method, params });
			return null;
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			return new CoreError("bad_command", `the request can't cross to the other tabs: ${why}`, { field: "params" });
		}
	}

	#heard(data: unknown) {
		if (this.#closed || !isObject(data)) return;
		if (data.event === "leader" && typeof data.tab === "string") {
			// A new leader: what this tab still asks goes to it. One that can't be cloned any more is refused, alone.
			if (!this.#leader) {
				for (const [id, { method, params }] of this.#waiting) {
					const refused = this.#ask(id, method, params);
					if (refused) this.#take(id)?.reject(refused);
				}
			}
			this.#options.onLeader?.(data.tab);
		} else if (data.event === "changed" && typeof data.conversation_id === "string") {
			if (!this.#leader) this.#options.onChanged?.(data.conversation_id);
		} else if (typeof data.id === "string" && typeof data.from === "string" && typeof data.method === "string") {
			if (this.#leader) this.#answer(data.id, data.from, data.method, data.params);
		} else if (typeof data.id === "string" && data.to === this.tab) {
			const waiting = this.#take(data.id);
			if (!waiting) return;
			if ("error" in data && isObject(data.error) && typeof data.error.code === "string") {
				waiting.reject(CoreError.of({ ...data.error, code: data.error.code }));
			} else waiting.resolve(data.ok);
		}
	}

	#answer(id: string, from: string, method: string, params: unknown) {
		const reply = (answer: { ok: unknown } | { error: unknown }) => {
			try {
				this.#post({ id, to: from, ...answer });
			} catch (error) {
				// An answer the channel can't clone: the asking tab hears that it failed, rather than nothing.
				const why = error instanceof Error ? error.message : String(error);
				this.#post({
					id,
					to: from,
					error: { code: "internal", message: `the answer can't cross to the other tabs: ${why}` },
				});
			}
		};
		this.#serve(method, params).then(
			(ok: unknown) => reply({ ok }),
			(error: unknown) => reply({ error: errorFields(error) }),
		);
	}
}
