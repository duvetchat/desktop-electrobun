// The OPFS pool the core keeps its databases in (PLAN-E2E-CLIENTES.md, where the database and its key live): SQLite's
// opfs-sahpool, as the core's install_opfs makes it (sqlite-wasm-vfs 0.3.0 with OpfsSAHPoolCfg::default()). It's the
// folder POOL; the pool, once installed, holds its .lock open, so one worker of an origin has it at a time; and SLOTS
// holds its files, six at install, to which it never adds one: preparePool does. Each file is a slot: a 4096-byte
// header whose first NAME_BYTES are the name of what it holds, NUL-padded UTF-8 (none when it's free), then that
// file's bytes. SQLite frees a slot by emptying its header and cutting it to the header; a slot cut to nothing, or an
// empty file, is free as well. Only a dedicated worker opens a file's synchronous access handle, one at a time a file.
import { CoreError } from "../errors";

export const POOL = ".opfs-sahpool";
export const SLOTS = ".opaque";
const LEASE = ".lock";
/** How much of a slot's header names its file. */
export const NAME_BYTES = 512;
/** How long a pool still held is waited for: a worker that just ended, or a tab that closed or reloaded, lets go of
 * its handles a moment later. */
const LEASE_WAIT_MS = 5_000;
/** How many of the pool's slots are kept free: a new database takes one for good, and its journal one as it writes. */
const FREE_SLOTS = 2;

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

/**
 * `use` of a file another worker may still hold, as one that just ended lets go of its handles a moment later: tried
 * again while it's held, LEASE_WAIT_MS at most, then `locked`.
 */
async function waitOut<T>(use: () => Promise<T>): Promise<T | "locked"> {
	const deadline = Date.now() + LEASE_WAIT_MS;
	for (;;) {
		try {
			return await use();
		} catch (error) {
			if (!held(error)) throw error;
			if (Date.now() > deadline) return "locked";
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

/** The pool's lease, held: else `locked`, as another worker has it past the wait, or `unsupported`, as OPFS refuses. */
async function holdLease(pool: FileSystemDirectoryHandle): Promise<SyncHandle | "locked" | "unsupported"> {
	try {
		const lease = await pool.getFileHandle(LEASE, { create: true });
		return canSync(lease) ? await waitOut(() => lease.createSyncAccessHandle()) : "unsupported";
	} catch {
		return "unsupported";
	}
}

/** The pool's folder, made if `create`: null where OPFS refuses (Firefox's private windows, which have its methods). */
async function poolFolder(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	try {
		return await (await navigator.storage.getDirectory()).getDirectoryHandle(POOL, { create });
	} catch {
		return null;
	}
}

/**
 * Whether the pool can be installed now: `free` once no other worker holds it (its lease taken and let go, for the
 * pool to take), `locked` while one does past the wait, `unsupported` where OPFS refuses.
 */
export async function poolLease(): Promise<"free" | "locked" | "unsupported"> {
	const pool = await poolFolder(true);
	if (!pool) return "unsupported";
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
 * A slot's synchronous handle, open, and the name its header holds (null when it's free): `locked` while another worker
 * holds it past the wait. Not getFile(), which in Firefox 145 could stay unsettled on a slot a worker that had just
 * ended still held.
 */
async function openSlot(file: FileSystemFileHandle): Promise<{ handle: SyncHandle; name: string | null } | "locked"> {
	if (!canSync(file)) throw new CoreError("storage", "OPFS opens no file here");
	const handle = await waitOut(() => file.createSyncAccessHandle());
	if (handle === "locked") return handle;
	const header = new Uint8Array(NAME_BYTES);
	handle.read(header, { at: 0 });
	return { handle, name: slotName(header) };
}

/**
 * Readies the pool for this worker to install, its lease held meanwhile: says which files its slots hold, and adds
 * empty slots until FREE_SLOTS are free, as the pool never adds one itself. `locked` while another worker holds the
 * pool past the wait, `unsupported` where OPFS refuses.
 */
export async function preparePool(): Promise<{ state: "free"; names: string[] } | { state: "locked" | "unsupported" }> {
	const pool = await poolFolder(true);
	if (!pool) return { state: "unsupported" };
	const lease = await holdLease(pool);
	if (typeof lease === "string") return { state: lease };
	try {
		const slots = await pool.getDirectoryHandle(SLOTS, { create: true });
		const names: string[] = [];
		let free = 0;
		for (const file of await filesOf(slots)) {
			const slot = await openSlot(file);
			if (slot === "locked") return { state: "locked" };
			slot.handle.close();
			if (slot.name === null) free++;
			else names.push(slot.name);
		}
		for (; free < FREE_SLOTS; free++) await slots.getFileHandle(crypto.randomUUID(), { create: true });
		return { state: "free", names: names.sort() };
	} finally {
		lease.close();
	}
}

/**
 * Installs the pool (`install`, the core's install_opfs, takes the lease itself). A refusal while another worker holds
 * the pool is that worker's doing, `locked`, not a browser without OPFS: the lease is asked again to tell them apart.
 * What `install` throws that isn't the core's error reply (a trap) is thrown on.
 */
export async function installPool(
	install: () => Promise<void>,
	lease: () => Promise<"free" | "locked" | "unsupported"> = poolLease,
): Promise<"installed" | "locked" | "unsupported"> {
	try {
		await install();
		return "installed";
	} catch (error) {
		if (typeof error !== "string") throw error;
		return (await lease()) === "locked" ? "locked" : "unsupported";
	}
}

const lockedSlot = () => new CoreError("locked", "another tab's core holds the databases");

/**
 * Removes these files from the pool as SQLite does, freeing their slots, then runs `whileHeld` (destroy forgets the
 * key there), all with the pool's lease held, so no worker installs the pool in between: `locked` while one holds it,
 * or one of these slots, past the wait. With no pool there's nothing to remove. Run in a worker that never installed
 * the pool.
 */
export async function deleteFiles(names: string[], whileHeld: () => Promise<void>): Promise<void> {
	const pool = await poolFolder(false);
	if (!pool) return whileHeld();
	const lease = await holdLease(pool);
	if (lease === "locked") throw lockedSlot();
	if (lease === "unsupported") throw new CoreError("storage", "OPFS refuses the pool's lease");
	try {
		const slots = await pool.getDirectoryHandle(SLOTS).catch(() => null);
		for (const file of slots ? await filesOf(slots) : []) {
			const slot = await openSlot(file);
			if (slot === "locked") throw lockedSlot();
			try {
				if (slot.name !== null && names.includes(slot.name)) {
					slot.handle.truncate(0);
					slot.handle.flush();
				}
			} finally {
				slot.handle.close();
			}
		}
		await whileHeld();
	} finally {
		lease.close();
	}
}
