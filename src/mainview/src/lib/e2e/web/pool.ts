// The OPFS pool the core keeps its databases in (PLAN-E2E-CLIENTES.md, where the database and its key live): SQLite's
// opfs-sahpool, as the core's install_opfs makes it (sqlite-wasm-vfs 0.3.0 with OpfsSAHPoolCfg::default()). It's the
// folder POOL; the pool, once installed, holds its .lock open, so one worker of an origin has it at a time; and SLOTS
// holds its files, a fixed number (six) that it never adds to. Each file is a slot: a 4096-byte header whose first
// NAME_BYTES are the name of what it holds, NUL-padded UTF-8 (none when it's free), then that file's bytes. SQLite
// deletes a file by emptying its slot's header and cutting it to the header; a slot cut to nothing is free as well.
// Only a dedicated worker opens a file's synchronous access handle, and only one at a time per file.
import { CoreError } from "../errors";

export const POOL = ".opfs-sahpool";
export const SLOTS = ".opaque";
const LEASE = ".lock";
/** How much of a slot's header names its file. */
export const NAME_BYTES = 512;
/** How long a pool still held is waited for: a worker that just ended, or a tab that closed or reloaded, lets go of
 * its handles a moment later. */
const LEASE_WAIT_MS = 5_000;

/** A slot's name, as its header says: null for a free slot, or one whose name isn't UTF-8. */
export function slotName(header: Uint8Array): string | null {
	const end = header.indexOf(0);
	if (end <= 0) return null;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(header.subarray(0, end));
	} catch {
		// Not a name SQLite wrote: no database of ours.
		return null;
	}
}

/** OPFS's synchronous access handle, which lib.dom leaves out (it's a worker's): what this module calls of it. */
interface SyncHandle {
	read(into: Uint8Array, options?: { at?: number }): number;
	truncate(size: number): void;
	flush(): void;
	close(): void;
}
interface SyncFile extends FileSystemFileHandle {
	createSyncAccessHandle(): Promise<SyncHandle>;
}
const canSync = (file: FileSystemFileHandle): file is SyncFile => "createSyncAccessHandle" in file;

/** Whether an error says another handle has the file: the only refusal worth waiting out. */
const held = (error: unknown) => error instanceof DOMException && error.name === "NoModificationAllowedError";

/** The pool's lease, held: else `locked`, as another worker has it past the wait, or `unsupported`, as OPFS refuses. */
async function holdLease(pool: FileSystemDirectoryHandle): Promise<SyncHandle | "locked" | "unsupported"> {
	let lease: FileSystemFileHandle;
	try {
		lease = await pool.getFileHandle(LEASE, { create: true });
	} catch {
		return "unsupported";
	}
	if (!canSync(lease)) return "unsupported";
	const deadline = Date.now() + LEASE_WAIT_MS;
	for (;;) {
		try {
			return await lease.createSyncAccessHandle();
		} catch (error) {
			if (!held(error)) return "unsupported";
			if (Date.now() > deadline) return "locked";
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

/** OPFS's root, or null where OPFS refuses (Firefox's private windows, which have its methods). */
async function root(): Promise<FileSystemDirectoryHandle | null> {
	try {
		return await navigator.storage.getDirectory();
	} catch {
		return null;
	}
}

/**
 * Whether the pool can be installed now: `free` once no other worker holds it (its lease taken and let go, for the
 * pool to take), `locked` while one does past the wait, `unsupported` where OPFS refuses.
 */
export async function poolLease(): Promise<"free" | "locked" | "unsupported"> {
	const opfs = await root();
	if (!opfs) return "unsupported";
	let pool: FileSystemDirectoryHandle;
	try {
		pool = await opfs.getDirectoryHandle(POOL, { create: true });
	} catch {
		return "unsupported";
	}
	const lease = await holdLease(pool);
	if (typeof lease === "string") return lease;
	lease.close();
	return "free";
}

/** A folder's files, which lib.dom's types leave out of a folder's handle. */
export async function filesOf(folder: FileSystemDirectoryHandle): Promise<FileSystemFileHandle[]> {
	const files: FileSystemFileHandle[] = [];
	const values: unknown = Reflect.get(folder, "values");
	if (typeof values !== "function") return files;
	const entries: AsyncIterable<FileSystemHandle> = values.call(folder);
	for await (const entry of entries) if (entry instanceof FileSystemFileHandle) files.push(entry);
	return files;
}

/**
 * Deletes these files of the pool as SQLite deletes one, by freeing their slots, with the pool's lease held so no
 * worker installs the pool meanwhile: `locked` while one has it. Run in a worker that never installed the pool.
 */
export async function deleteFiles(names: string[]): Promise<void> {
	const opfs = await root();
	if (!opfs) throw new CoreError("storage", "OPFS refuses this page");
	let pool: FileSystemDirectoryHandle;
	try {
		pool = await opfs.getDirectoryHandle(POOL);
	} catch {
		// No pool: no database to delete.
		return;
	}
	const lease = await holdLease(pool);
	if (lease === "locked") throw new CoreError("locked", "another tab's core holds the databases");
	if (lease === "unsupported") throw new CoreError("storage", "OPFS refuses the pool's lease");
	try {
		let slots: FileSystemDirectoryHandle;
		try {
			slots = await pool.getDirectoryHandle(SLOTS);
		} catch {
			return;
		}
		for (const file of await filesOf(slots)) {
			if (!canSync(file)) continue;
			const slot = await file.createSyncAccessHandle();
			try {
				const header = new Uint8Array(NAME_BYTES);
				slot.read(header, { at: 0 });
				const name = slotName(header);
				if (name !== null && names.includes(name)) {
					slot.truncate(0);
					slot.flush();
				}
			} finally {
				slot.close();
			}
		}
	} finally {
		lease.close();
	}
}
