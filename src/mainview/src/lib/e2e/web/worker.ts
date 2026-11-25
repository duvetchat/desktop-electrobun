// The web's core (PLAN-E2E-CLIENTES.md, the web's worker, lock and tabs): a dedicated module worker, which host-web.ts
// starts in the tab that leads (tabs.ts). To open, it waits for OPFS's pool to be free (pool.ts), loads the core's
// WebAssembly, installs OPFS, unwraps the database key (keys.ts) and opens `<user_id>.db`. The key lives here alone:
// the page never gets a byte of it. Messages run one at a time, in the order they came.
//
// What throws out of the core's WebAssembly (a panic traps, a stack overflow throws) leaves the instance and its OPFS
// handles unusable, as the core's contract says: the worker answers that call internal, says it ends, and closes; the
// host starts another before its next call.
import { base64Bytes } from "../../activity-thumbnail";
import { isUuid } from "../../common/common";
import { bytesBase64 } from "../../staged-images";
import { CoreError, errorFields, replyOk } from "../errors";
import { throughCore } from "../parts";
import init, { install_opfs, WasmCore, type InitOutput } from "../wasm/duvet_e2e_wasm.js";
import wasm from "../wasm/duvet_e2e_wasm_bg.wasm?url";
import { databaseKey, keyStore } from "./keys";
import { deleteFiles, poolLease } from "./pool";
import { missingInWorker } from "./support";

/** Thrown out of the core's WebAssembly: the instance can't be trusted from here on. */
class Cut extends Error {}

let exports: InitOutput | null = null;
let installed = false;
let core: WasmCore | null = null;
/** The parts of each package `share` made, until it's dropped. */
const shares = new Map<string, Uint8Array<ArrayBuffer>[]>();

/** The core's error reply, a JSON string, as a CoreError. */
function coreError(text: string): CoreError {
	try {
		replyOk(JSON.parse(text));
	} catch (error) {
		if (error instanceof CoreError) return error;
	}
	return new CoreError("internal", "the core's error reply isn't one");
}

/** Runs `call` in the core's instance: a string it throws is the core's error reply; anything else cuts the worker. */
function inCore<T>(call: () => T): T {
	try {
		return call();
	} catch (error) {
		if (typeof error === "string") throw coreError(error);
		throw new Cut(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
	}
}

/** One command's reply, as the core gives it. */
function reply(command: object): unknown {
	const opened = core;
	if (!opened) throw new CoreError("not_found", "no core is open", { what: "handle" });
	return JSON.parse(inCore(() => opened.handle(JSON.stringify(command))));
}

/** One command's `ok`, typed by its caller; its error thrown as a CoreError. */
const run = (command: object): any => replyOk(reply(command));

/** The user's database, and the files SQLite keeps beside it. */
function databaseFiles(userId: unknown): string[] {
	if (!isUuid(userId) || userId !== userId.toLowerCase()) {
		throw new CoreError("bad_command", "a user's ID is a UUID", { field: "user_id" });
	}
	return ["", "-journal", "-wal", "-shm"].map((suffix) => `${userId}.db${suffix}`);
}

type OpenState = { state: "ready"; keyStorage: "provided"; times: Record<string, number> } | { state: string };

async function open(userId: unknown): Promise<OpenState> {
	const [database = ""] = databaseFiles(userId);
	if (core) close();
	if (missingInWorker().length) return { state: "unsupported" };
	const times = { init: 0, install: 0, key: 0, open: 0 };
	let mark = performance.now();
	const lap = (step: keyof typeof times) => {
		const now = performance.now();
		times[step] = Math.round(now - mark);
		mark = now;
	};
	if (!installed) {
		const lease = await poolLease();
		if (lease !== "free") return { state: lease };
		try {
			exports ??= await init({ module_or_path: wasm });
		} catch {
			// The module didn't load (the network, or a page that changed under it): another open tries again.
			return { state: "failed" };
		}
		lap("init");
		try {
			await install_opfs();
		} catch (error) {
			if (typeof error === "string") return { state: "unsupported" };
			throw new Cut(String(error));
		}
		installed = true;
		lap("install");
	}
	let key: Uint8Array;
	try {
		key = await databaseKey(String(userId), keyStore);
	} catch {
		// The key kept doesn't open (bad_key), or IndexedDB refused: nothing opens without it.
		return { state: "failed" };
	}
	lap("key");
	try {
		core = inCore(() => WasmCore.open(JSON.stringify({ path: database }), key));
	} catch (error) {
		if (error instanceof CoreError) return { state: "failed" };
		throw error;
	} finally {
		key.fill(0);
	}
	lap("open");
	return { state: "ready", keyStorage: "provided", times };
}

function close() {
	const opened = core;
	core = null;
	shares.clear();
	if (opened) inCore(() => opened.close());
}

/** The commands of the harness's build alone (e2e-browser): they cut the worker, as a trap and a failure would. */
function harnessCut(command: object): Promise<never> | null {
	if (import.meta.env.MODE !== "e2e-harness") return null;
	const cmd: unknown = Reflect.get(command, "cmd");
	// An alignment that isn't a power of two: the core's allocator aborts, which traps.
	if (cmd === "__trap") inCore(() => exports?.__wbindgen_malloc(1, 3));
	if (cmd === "__die") {
		setTimeout(() => {
			throw new Error("the harness fails the worker");
		});
		return new Promise(() => {});
	}
	return null;
}

function objectOf(value: unknown, field: string): object {
	if (typeof value !== "object" || value === null)
		throw new CoreError("bad_command", `${field} is an object`, { field });
	return value;
}

/** What each message asks, answered as the core replies: `{ok}` or `{error}`. */
async function answer(message: Record<string, unknown>, progress: (done: number) => void): Promise<unknown> {
	switch (message.op) {
		case "open":
			return { ok: await open(message.userId) };
		case "handle": {
			const command = objectOf(message.command, "command");
			return harnessCut(command) ?? reply(command);
		}
		case "seal":
		case "unseal": {
			if (!(message.file instanceof Blob)) throw new CoreError("bad_command", "a file is a Blob", { field: "file" });
			const bytes = new Uint8Array(await message.file.arrayBuffer());
			const cmd = message.op === "seal" ? "attachment_encrypt" : "attachment_decrypt";
			return { ok: throughCore(run, cmd, String(message.key), String(message.attachmentId), bytes, progress) };
		}
		case "share": {
			const made: { share_id: string; parts: string[] } = run(objectOf(message.command, "command"));
			shares.set(made.share_id, made.parts.map(base64Bytes));
			return { ok: { ...made, parts: made.parts.length } };
		}
		case "sharePart": {
			const part = shares.get(String(message.shareId))?.[Number(message.n)];
			if (!part) throw new CoreError("not_found", "this host keeps no such part", { what: "share" });
			return { ok: part };
		}
		case "dropShare":
			shares.delete(String(message.shareId));
			return { ok: {} };
		case "importShare": {
			const parts = Array.isArray(message.parts) ? message.parts : [];
			if (!parts.every((part) => part instanceof Uint8Array)) throw new CoreError("bad_command", "parts are bytes");
			return { ok: run({ cmd: "history_import", share_id: message.shareId, parts: parts.map(bytesBase64) }) };
		}
		case "close":
			close();
			return { ok: {} };
		case "destroy": {
			// The pool's files are deleted by a worker that never installed the pool: one that did holds them.
			if (installed) throw new CoreError("internal", "this worker holds the databases: another one deletes");
			await deleteFiles(databaseFiles(message.userId));
			await keyStore.forget(String(message.userId));
			return { ok: {} };
		}
	}
	throw new CoreError("bad_command", `no operation ${String(message.op)}`, { field: "op" });
}

async function respond(data: unknown) {
	if (typeof data !== "object" || data === null) return;
	const message: Record<string, unknown> = { ...data };
	const { id } = message;
	if (typeof id !== "number") return;
	try {
		postMessage({ id, reply: await answer(message, (done) => postMessage({ id, progress: done })) });
	} catch (error) {
		if (!(error instanceof Cut)) {
			postMessage({ id, reply: { error: errorFields(error) } });
			return;
		}
		core = null;
		postMessage({
			id,
			reply: { error: { code: "internal", message: `the core stopped: ${error.message}` } },
			ended: true,
		});
		self.close();
	}
}

let queue = Promise.resolve();
self.addEventListener("message", (event: MessageEvent) => {
	queue = queue.then(() => respond(event.data));
});
