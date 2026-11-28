// A CoreHost over bun:ffi, for tests alone (PLAN-E2E-CLIENTES.md, Task 6): the core's own library as the desktop's Bun
// loads it, each user's database in a folder of its own, opened with a key the test gives (key_storage "provided"). So
// the engine's tests run on real MLS material. DUVET_E2E_FFI names another build of the library (the API's suites pass
// theirs); without it, the one native/core carries for this platform: Windows' and Linux's on x64, macOS's on arm64.
//
// Every test file under `bun test --isolate` loads the library again, but in one process: its state goes from file to
// file, its handles counted on and a database a file left open still locked. So each host keeps to a folder of its own.
import { CString, dlopen, FFIType } from "bun:ffi";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { CoreError, replyOk } from "../errors";
import { MAX_SHARE_PARTS, OWN_WAY, ownWay, type CoreHost, type HostOpened, type ShareMade } from "../host";
import { throughCore } from "../parts";

const native = join(import.meta.dir, "../../../../../../native/core");

/** The library native/core carries for each system whose build carries one (src/bun/e2e/library.ts). */
const NATIVE: Record<string, string> = {
	"win32-x64": "win-x64/duvet_e2e_ffi.dll",
	"linux-x64": "linux-x64/libduvet_e2e_ffi.so",
	"darwin-arm64": "macos-arm64/libduvet_e2e_ffi.dylib",
};

/** The library native/core carries for a system, or none: no release of the core builds for it (an Intel Mac). */
export function nativeCoreLibrary(platform: string, arch: string): string | null {
	const file = NATIVE[`${platform}-${arch}`];
	return file ? join(native, file) : null;
}

/** The library this platform loads: the one DUVET_E2E_FFI names, else native/core's for it, else none. */
export const coreLibrary: string | null =
	process.env.DUVET_E2E_FFI || nativeCoreLibrary(process.platform, process.arch);

const load = (path: string) =>
	dlopen(path, {
		duvet_e2e_open: { args: [FFIType.ptr], returns: FFIType.ptr },
		duvet_e2e_handle: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
		duvet_e2e_close: { args: [FFIType.u64], returns: FFIType.void },
		duvet_e2e_destroy: { args: [FFIType.ptr], returns: FFIType.ptr },
		duvet_e2e_free: { args: [FFIType.ptr], returns: FFIType.void },
	}).symbols;
type Library = ReturnType<typeof load>;
const library = coreLibrary ? load(coreLibrary) : null;
const core = () => {
	if (!library) throw new CoreError("internal", "there's no core for this platform");
	return library;
};

/** A NUL-terminated UTF-8 string, as the library reads one. */
const cstring = (text: string) => new TextEncoder().encode(`${text}\0`);

/** A reply the library allocated: read, handed back to it, then read as the core's reply (its `ok`). */
function take(pointer: ReturnType<Library["duvet_e2e_open"]>) {
	if (!pointer) throw new CoreError("internal", "the core answered nothing");
	try {
		return replyOk(JSON.parse(new CString(pointer).toString()));
	} finally {
		core().duvet_e2e_free(pointer);
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class BunCoreHost implements CoreHost {
	/** Where this device's databases are, one folder for each user. */
	readonly folder: string;
	/** The key each database here opens with, in base64: the test's, else 32 random bytes. */
	readonly key: string;
	#handle: bigint | null = null;
	/** The parts of each package `share` made, until it's dropped. */
	#shares = new Map<string, Uint8Array[]>();

	/** A device: a folder and a key given again are the same device after a restart. */
	constructor({ folder, key }: { folder?: string; key?: Uint8Array } = {}) {
		this.folder = folder ?? mkdtempSync(join(tmpdir(), "duvet-core-"));
		this.key = bytesBase64(key ?? crypto.getRandomValues(new Uint8Array(32)));
	}

	/** Where a user's database is: a user's ID names a folder, so only a UUID does. */
	#path(userId: string): string {
		if (!UUID.test(userId)) throw new CoreError("bad_command", "a user's ID is a UUID", { field: "user_id" });
		return join(this.folder, userId, "core.db");
	}

	async open(userId: string): Promise<HostOpened & { keyStorage?: "provided" }> {
		if (!coreLibrary) return { state: "unsupported" };
		await this.close();
		const path = this.#path(userId);
		mkdirSync(join(path, ".."), { recursive: true });
		try {
			const { handle }: { handle: number } = take(
				core().duvet_e2e_open(cstring(JSON.stringify({ path, db_key: this.key }))),
			);
			this.#handle = BigInt(handle);
		} catch (error) {
			const code = error instanceof CoreError ? error.code : "internal";
			return code === "locked" ? { state: "locked" } : { state: "failed", reason: code };
		}
		return { state: "ready", keyStorage: "provided" };
	}

	async handle<T = unknown>(command: { cmd: string } & Record<string, unknown>): Promise<T> {
		if (OWN_WAY.includes(command.cmd)) throw ownWay(command.cmd);
		return this.#run(command);
	}

	/** One command's reply, typed by its caller as the core's contract gives it. */
	#run(command: object): any {
		if (this.#handle === null) throw new CoreError("not_found", "no core is open", { what: "handle" });
		return take(core().duvet_e2e_handle(this.#handle, cstring(JSON.stringify(command))));
	}

	async sealFile(key: string, attachmentId: string, plain: Blob, progress?: (done: number) => void) {
		const bytes = new Uint8Array(await plain.arrayBuffer());
		return throughCore((command) => this.#run(command), "attachment_encrypt", key, attachmentId, bytes, progress);
	}

	async openFile(key: string, attachmentId: string, sealed: Blob, progress?: (done: number) => void) {
		const bytes = new Uint8Array(await sealed.arrayBuffer());
		return throughCore((command) => this.#run(command), "attachment_decrypt", key, attachmentId, bytes, progress);
	}

	async share(command: { cmd: "history_share" | "catch_up" } & Record<string, unknown>): Promise<ShareMade> {
		const made: Omit<ShareMade, "parts"> & { parts: string[] } = this.#run(command);
		this.#shares.set(made.share_id, made.parts.map(base64Bytes));
		return { ...made, parts: made.parts.length };
	}

	async sharePart(shareId: string, n: number) {
		const part = this.#shares.get(shareId)?.[n];
		if (!part) throw new CoreError("not_found", "this host keeps no such part", { what: "share" });
		return part;
	}

	async dropShare(shareId: string) {
		this.#shares.delete(shareId);
	}

	async importShare(shareId: string, parts: Uint8Array[]): Promise<{ imported: number }> {
		if (parts.length > MAX_SHARE_PARTS)
			throw new CoreError("too_large", `a package has ${MAX_SHARE_PARTS} parts at most`);
		return this.#run({ cmd: "history_import", share_id: shareId, parts: parts.map(bytesBase64) });
	}

	async close() {
		if (this.#handle !== null) core().duvet_e2e_close(this.#handle);
		this.#handle = null;
		this.#shares.clear();
	}

	async destroy(userId: string) {
		await this.close();
		take(core().duvet_e2e_destroy(cstring(JSON.stringify({ path: this.#path(userId), db_key: this.key }))));
	}
}
