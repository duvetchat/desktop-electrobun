// The end-to-end encryption core in a Bun worker of its own (PLAN-E2E-CLIENTES.md, Task 7 and Ruling 5). Task 7 measured
// it on Bun 1.3.9, Electrobun's: a 16 MiB history_share took 2.1 s and its history_import 5.0 s, and in the app's own
// worker either would have held every window drag, toast and message of Bun's that long. Electrobun bundles the Bun side
// into one file, from which no other module can start a worker, so the worker runs coreWorker from its own source, as
// notification-forwarder.ts's script runs: it uses only globals and what it imports itself.
//
// What the worker answers is the core's own reply, each one the library hands back freed (duvet_e2e_free); nothing of a
// command or its reply is logged. Rpc.ts, Bun's half of the desktop's boundary, is what asks it anything.

/** How the worker opens a user's database. */
export interface CoreSetup {
	/** The core's library (library.ts). */
	library: string;
	/** Each user's database is <folder>/<user_id>/core.db. */
	folder: string;
	/** The app's: each database's key in the system's keyring, under this service, the user's ID its account. */
	keyring?: { service: string };
	/** A test's, in place of the keyring: the key (32 bytes, base64) every database here opens with. */
	key?: string;
}

/** The core's error, as its reply gives it: its code, its message and the fields it names. */
export type CoreFailure = { code: string; message?: string } & Record<string, unknown>;
/** What the worker answers an op, in the core's own form. */
export type WorkerReply = { ok: unknown } | { error: CoreFailure };

/** The core's worker as Bun's half of the boundary uses it (rpc.ts). */
export interface CoreWorker {
	/** One op, in turn after those before it; rejects with CoreStopped once the worker is gone. */
	run(op: string, params?: unknown): Promise<WorkerReply>;
	/** Ends the worker. What it had open stays open in the library, the process's, until a worker's `forget` closes it. */
	stop(): void;
}

/** The worker is gone: what it was running is lost, and what it had open is the library's alone. */
export class CoreStopped extends Error {
	constructor() {
		super("the core's worker stopped");
	}
}

/** Starts the core's worker. */
export function startCore(setup: CoreSetup): CoreWorker {
	const url = URL.createObjectURL(
		new Blob([`(${coreWorker.toString()})(${JSON.stringify(setup)});`], { type: "application/javascript" }),
	);
	const worker = new Worker(url);
	const waiting = new Map<number, { resolve: (reply: WorkerReply) => void; reject: (error: CoreStopped) => void }>();
	let next = 1;
	let gone = false;
	const stopped = () => {
		if (gone) return;
		gone = true;
		for (const { reject } of waiting.values()) reject(new CoreStopped());
		waiting.clear();
		URL.revokeObjectURL(url);
	};
	worker.addEventListener("message", (event: MessageEvent<{ id: number; reply: WorkerReply }>) => {
		const { id, reply } = event.data;
		waiting.get(id)?.resolve(reply);
		waiting.delete(id);
	});
	worker.addEventListener("error", stopped);
	worker.addEventListener("close", stopped);
	return {
		run: (op, params) =>
			new Promise((resolve, reject) => {
				if (gone) return reject(new CoreStopped());
				const id = next++;
				waiting.set(id, { resolve, reject });
				worker.postMessage({ id, op, params });
			}),
		stop: () => {
			stopped();
			worker.terminate();
		},
	};
}

/**
 * The worker's code, run from its own source (startCore): every name it uses is in it, or a global. It takes the
 * boundary's ops one at a time, in the order they come, and keeps what a package's parts need between them: those of
 * the packages its core made, until they're dropped, and those handed in, until they're imported.
 */
export function coreWorker(setup: CoreSetup): void {
	// The core's replies are JSON, read as the core's contract gives them.
	type Reply = { ok: any } | { error: { code: string; message: string } & Record<string, unknown> };
	/** The packages kept at once, made or being handed in: a page can't fill Bun's memory with them. */
	const KEPT = 4;
	const loading = (async () => {
		const ffi = await import("bun:ffi");
		const fs = await import("node:fs");
		const path = await import("node:path");
		const { FFIType } = ffi;
		const lib = ffi.dlopen(setup.library, {
			duvet_e2e_open: { args: [FFIType.ptr], returns: FFIType.ptr },
			duvet_e2e_handle: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
			duvet_e2e_close: { args: [FFIType.u64], returns: FFIType.void },
			duvet_e2e_destroy: { args: [FFIType.ptr], returns: FFIType.ptr },
			duvet_e2e_free: { args: [FFIType.ptr], returns: FFIType.void },
		}).symbols;
		return { ffi, fs, path, lib };
	})();
	// A library that doesn't load fails each op (below), not the worker, which an unhandled rejection would end.
	loading.catch(() => {});
	type Core = Awaited<typeof loading>;

	let handle: bigint | null = null;
	const shares = new Map<string, string[]>();
	const stashes = new Map<string, string[]>();

	const failure = (code: string, message: string, extra: object = {}): Reply => ({
		error: { code, message, ...extra },
	});
	/** A NUL-terminated JSON string, as the library reads one: JSON writes any NUL of a text as an escape. */
	const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\0`);
	/** A reply the library allocated: read, handed back to it, parsed. */
	const take = ({ ffi, lib }: Core, pointer: ReturnType<Core["lib"]["duvet_e2e_open"]>): Reply => {
		if (!pointer) return failure("internal", "the core answered nothing");
		try {
			return JSON.parse(new ffi.CString(pointer).toString());
		} finally {
			lib.duvet_e2e_free(pointer);
		}
	};
	// With none open, internal: the core's own not_found would read to the engine as a group or a message missing.
	const command = (core: Core, cmd: object): Reply =>
		handle === null ? failure("internal", "no core is open") : take(core, core.lib.duvet_e2e_handle(handle, json(cmd)));
	/** The config a user's database opens and is deleted with: its key in the keyring, or the test's. */
	const config = ({ path }: Core, userId: string) => {
		const file = path.join(setup.folder, userId, "core.db");
		return setup.key
			? { path: file, db_key: setup.key }
			: { path: file, keyring: { service: setup.keyring?.service, account: userId } };
	};
	const close = ({ lib }: Core) => {
		if (handle !== null) lib.duvet_e2e_close(handle);
		handle = null;
		shares.clear();
		stashes.clear();
	};

	const run = (core: Core, op: string, params: any): Reply => {
		switch (op) {
			case "open": {
				close(core);
				core.fs.mkdirSync(core.path.join(setup.folder, params.userId), { recursive: true });
				const opened = take(core, core.lib.duvet_e2e_open(json(config(core, params.userId))));
				if ("error" in opened) {
					// The code alone: it's what tells a locked database from one that failed.
					if (opened.error.code !== "locked") console.error("[e2e] the core didn't open:", opened.error.code);
					return { ok: { state: opened.error.code === "locked" ? "locked" : "failed" } };
				}
				handle = BigInt(opened.ok.handle);
				const status = command(core, { cmd: "status" });
				const keyStorage = "ok" in status ? status.ok.key_storage : undefined;
				return { ok: { state: "ready", keyStorage, handle: opened.ok.handle } };
			}
			case "handle":
				return command(core, params.command);
			case "sealParts":
			case "openParts": {
				const cmd = op === "sealParts" ? "attachment_encrypt" : "attachment_decrypt";
				const parts: string[] = [];
				for (const [n, data] of params.parts.entries()) {
					const last = params.last && n === params.parts.length - 1;
					const done = command(core, {
						cmd,
						key: params.key,
						attachment_id: params.attachmentId,
						index: params.index + n,
						last,
						data,
					});
					if ("error" in done) return done;
					parts.push(done.ok.data);
				}
				return { ok: { parts } };
			}
			case "share": {
				if (shares.size >= KEPT) return failure("too_large", `${KEPT} packages are kept at most`, { limit: KEPT });
				const made = command(core, params.command);
				if ("error" in made) return made;
				const { parts, ...rest } = made.ok;
				shares.set(rest.share_id, parts);
				return { ok: { ...rest, parts: parts.length } };
			}
			case "sharePart": {
				const part = shares.get(params.shareId)?.[params.n];
				return part === undefined ? failure("not_found", "no such part", { what: "share" }) : { ok: { part } };
			}
			case "dropShare":
				shares.delete(params.shareId);
				return { ok: {} };
			case "stash": {
				const kept = stashes.get(params.shareId);
				if (!kept && stashes.size >= KEPT)
					return failure("too_large", `${KEPT} packages are kept at most`, { limit: KEPT });
				const parts = kept ?? [];
				if (params.n !== parts.length)
					return failure("bad_command", "a package's parts go in in their order", { field: "n" });
				parts.push(params.part);
				stashes.set(params.shareId, parts);
				return { ok: {} };
			}
			case "importShare": {
				const parts = stashes.get(params.shareId) ?? [];
				stashes.delete(params.shareId);
				return command(core, { cmd: "history_import", share_id: params.shareId, parts });
			}
			case "close":
				close(core);
				return { ok: {} };
			case "destroy":
				close(core);
				return take(core, core.lib.duvet_e2e_destroy(json(config(core, params.userId))));
			case "forget":
				// A stopped worker's: the library is the process's, so its database stays locked until it's closed.
				core.lib.duvet_e2e_close(BigInt(params.handle));
				return { ok: {} };
			default:
				return failure("bad_command", "no such op", { field: "op" });
		}
	};

	let turn = Promise.resolve();
	globalThis.onmessage = (event: MessageEvent<{ id: number; op: string; params?: any }>) => {
		const { id, op, params } = event.data;
		const answer = (reply: Reply) => postMessage({ id, reply });
		turn = turn
			.then(async () => {
				let reply: Reply;
				try {
					reply = run(await loading, op, params);
				} catch {
					reply = failure("internal", "the core's worker failed");
				}
				answer(reply);
			})
			.catch(() => answer(failure("internal", "the core's worker failed")));
	};
}
