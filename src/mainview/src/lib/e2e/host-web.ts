// The web's CoreHost (PLAN-E2E-CLIENTES.md, the core's host and the web's worker): the core runs in a dedicated module
// worker (web/worker.ts), which the tab that leads (web/tabs.ts) starts as it opens, never before: the first screen
// loads nothing of it. Each call is a message with its ID, settled by the worker's answer with that ID.
//
// A call cut by the worker (its core trapped, and it says it ends; or it failed outside any call) rejects with
// CoreError("internal"), as does every other call it had. The next call starts a worker again, and opens the same
// user's database, before it runs.
import { isUuid } from "../common/common";
import { CoreError, replyOk } from "./errors";
import { MAX_SHARE_PARTS, ownWay, OWN_WAY, type CoreHost, type HostState, type ShareMade } from "./host";
import { missingInPage } from "./web/support";

/** What the host uses of a Worker; the tests hand one of their own. */
export interface WorkerLike {
	postMessage(message: unknown): void;
	addEventListener(type: "message" | "error" | "messageerror", listener: (event: any) => void): void;
	terminate(): void;
}

/** The core's worker: written out here, so Vite builds it as a chunk of its own, which loads as it's started. */
export const startCoreWorker = (): Worker =>
	new Worker(new URL("./web/worker.ts", import.meta.url), { type: "module" });

/** How long the core may take to close before its worker is ended all the same. */
const CLOSE_WAIT_MS = 2_000;

type Opened = { state: HostState; keyStorage?: "provided" };

/** A worker and the calls it has, by their IDs. */
interface Running {
	worker: WorkerLike;
	calls: Map<
		number,
		{ resolve: (value: any) => void; reject: (error: unknown) => void; progress?: (n: number) => void }
	>;
}

const cut = (why: string) => new CoreError("internal", why);

export class WebCoreHost implements CoreHost {
	/** How long each step of the last open took, in milliseconds: init, install, key, open. */
	openTimes: Record<string, number> | null = null;
	#start: () => WorkerLike;
	#missing: () => string[];
	#next = 0;
	#running: Running | null = null;
	/** The user whose database is open, which a cut reopens. */
	#userId: string | null = null;

	constructor({
		start = startCoreWorker,
		missing = missingInPage,
	}: { start?: () => WorkerLike; missing?: () => string[] } = {}) {
		this.#start = start;
		this.#missing = missing;
	}

	async open(userId: string): Promise<Opened> {
		if (!isUuid(userId) || userId !== userId.toLowerCase()) {
			throw new CoreError("bad_command", "a user's ID is a UUID", { field: "user_id" });
		}
		await this.close();
		if (this.#missing().length) return { state: "unsupported" };
		const running = (this.#running = this.#begin());
		const opened = await this.#openIn(running, userId).catch(() => ({ state: "failed" as const }));
		if (opened.state !== "ready") {
			this.#end(running, cut("the core didn't open"));
			return { state: opened.state };
		}
		this.#userId = userId;
		return { state: "ready", keyStorage: "provided" };
	}

	async handle<T = unknown>(command: { cmd: string } & Record<string, unknown>): Promise<T> {
		if (OWN_WAY.includes(command.cmd)) throw ownWay(command.cmd);
		return this.#call("handle", { command });
	}

	sealFile(key: string, attachmentId: string, plain: Blob, progress?: (done: number) => void): Promise<Blob> {
		return this.#call("seal", { key, attachmentId, file: plain }, progress);
	}

	openFile(key: string, attachmentId: string, sealed: Blob, progress?: (done: number) => void): Promise<Blob> {
		return this.#call("unseal", { key, attachmentId, file: sealed }, progress);
	}

	share(command: { cmd: "history_share" | "catch_up" } & Record<string, unknown>): Promise<ShareMade> {
		return this.#call("share", { command });
	}

	sharePart(shareId: string, n: number): Promise<Uint8Array> {
		return this.#call("sharePart", { shareId, n });
	}

	async dropShare(shareId: string): Promise<void> {
		await this.#call("dropShare", { shareId });
	}

	async importShare(shareId: string, parts: Uint8Array[]): Promise<{ imported: number }> {
		if (parts.length > MAX_SHARE_PARTS)
			throw new CoreError("too_large", `a package has ${MAX_SHARE_PARTS} parts at most`);
		return this.#call("importShare", { shareId, parts });
	}

	/** Closes the core, then ends its worker, which lets go of OPFS: past CLOSE_WAIT_MS, it's ended all the same. */
	async close(): Promise<void> {
		this.#userId = null;
		const running = this.#running;
		if (!running) return;
		const closed = this.#post(running, "close", {});
		const late = new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS));
		await Promise.race([closed.catch(() => {}), late]);
		this.#end(running, cut("the core closed"));
	}

	/** Closes, then a worker that never opened a core deletes the database and its key. */
	async destroy(userId: string): Promise<void> {
		if (!isUuid(userId) || userId !== userId.toLowerCase()) {
			throw new CoreError("bad_command", "a user's ID is a UUID", { field: "user_id" });
		}
		await this.close();
		const running = this.#begin();
		try {
			await this.#post(running, "destroy", { userId });
		} finally {
			this.#end(running, cut("the core's database was deleted"));
		}
	}

	/** A worker started, its answers and failures heard. */
	#begin(): Running {
		const running: Running = { worker: this.#start(), calls: new Map() };
		running.worker.addEventListener("message", (event: MessageEvent) => this.#heard(running, event.data));
		const failed = () => this.#end(running, cut("the core's worker failed"));
		running.worker.addEventListener("error", failed);
		running.worker.addEventListener("messageerror", failed);
		return running;
	}

	/** Ends a worker: every call it had gets `error`. */
	#end(running: Running, error: CoreError) {
		running.worker.terminate();
		for (const call of running.calls.values()) call.reject(error);
		running.calls.clear();
		if (this.#running === running) this.#running = null;
	}

	#heard(running: Running, data: unknown) {
		if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "number") return;
		const call = running.calls.get(data.id);
		if (!call) return;
		if ("progress" in data && !("reply" in data)) {
			if (typeof data.progress === "number") call.progress?.(data.progress);
			return;
		}
		running.calls.delete(data.id);
		try {
			call.resolve(replyOk("reply" in data ? data.reply : null));
		} catch (error) {
			call.reject(error);
		}
		// The core trapped: the worker said so as it ended, and what else it had won't be answered.
		if ("ended" in data && data.ended === true) this.#end(running, cut("the core stopped"));
	}

	#post<T>(running: Running, op: string, fields: object, progress?: (n: number) => void): Promise<T> {
		const id = this.#next++;
		return new Promise<T>((resolve, reject) => {
			running.calls.set(id, { resolve, reject, progress });
			running.worker.postMessage({ id, op, ...fields });
		});
	}

	async #openIn(running: Running, userId: string): Promise<{ state: HostState }> {
		const opened = await this.#post<{ state: HostState; times?: Record<string, number> }>(running, "open", { userId });
		this.openTimes = opened.times ?? null;
		return opened;
	}

	/**
	 * Posts a call, in the order calls are made: to the worker running, else to a new one, which opens the user's core
	 * again first. A worker runs its messages in turn, so the call waits for that open, and fails with it.
	 */
	#call<T>(op: string, fields: object, progress?: (n: number) => void): Promise<T> {
		const userId = this.#userId;
		if (!this.#running && userId === null) {
			return Promise.reject(new CoreError("not_found", "no core is open", { what: "handle" }));
		}
		return this.#post(this.#running ?? this.#reopen(String(userId)), op, fields, progress);
	}

	/** A new worker for the user's core after a cut: one that doesn't open is ended, and the calls it had with it. */
	#reopen(userId: string): Running {
		const running = (this.#running = this.#begin());
		this.#openIn(running, userId).then(
			(opened) => opened.state === "ready" || this.#end(running, cut(`the core didn't open again: ${opened.state}`)),
			() => this.#end(running, cut("the core didn't open again")),
		);
		return running;
	}
}
