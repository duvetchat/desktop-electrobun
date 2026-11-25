import { beforeEach, describe, expect, test } from "bun:test";
import { deleteFiles, installPool, NAME_BYTES, POOL, preparePool, SLOTS, slotName } from "./pool";

// The core's OPFS pool (pool.ts): a slot says what it holds in its header's first NAME_BYTES, the name SQLite gave the
// file, NUL-padded UTF-8. A worker readies the pool before it installs it, and destroy frees the user's slots. Here OPFS
// is the one in memory below; the browser's own is e2e-browser/host.cases.ts's.

/** A slot's header holding `name`, as the pool writes one: the name, then NULs. */
function header(name: Uint8Array | string) {
	const bytes = new Uint8Array(NAME_BYTES);
	bytes.set(typeof name === "string" ? new TextEncoder().encode(name) : name);
	return bytes;
}

describe("a slot's name", () => {
	test("is what its header holds before the first NUL", () => {
		const user = "0193a4b2-0000-7000-8000-000000000001";
		expect(slotName(header(`${user}.db`))).toBe(`${user}.db`);
		expect(slotName(header(`${user}.db-journal`))).toBe(`${user}.db-journal`);
	});

	test("is none for a free slot, one cut to nothing, or a name that isn't UTF-8 or never ends", () => {
		expect(slotName(new Uint8Array(NAME_BYTES))).toBeNull();
		expect(slotName(new Uint8Array(0))).toBeNull();
		expect(slotName(header(new Uint8Array([0x61, 0xff, 0x62])))).toBeNull();
		expect(slotName(new Uint8Array(NAME_BYTES).fill(0x61))).toBeNull();
	});
});

/** A file of OPFS as pool.ts uses one, its bytes in memory: a handle another holds refuses it, as a worker's does. */
class FakeFile {
	readonly kind = "file";
	bytes = new Uint8Array(0);
	/** How many more times opening it finds it held, as by a worker that just ended. */
	held = 0;
	/** Whether one of its handles is open. */
	open = false;

	constructor(readonly name: string) {}

	#refuse() {
		if (this.held > 0 || this.open) {
			if (this.held > 0) this.held--;
			throw new DOMException("another handle holds the file", "NoModificationAllowedError");
		}
	}

	async getFile() {
		this.#refuse();
		return new Blob([this.bytes]);
	}

	async createSyncAccessHandle() {
		this.#refuse();
		this.open = true;
		return {
			read: (into: Uint8Array, { at = 0 }: { at?: number } = {}) => {
				const part = this.bytes.subarray(at, at + into.length);
				into.set(part);
				return part.length;
			},
			truncate: (size: number) => {
				this.bytes = this.bytes.slice(0, size);
			},
			flush: () => {},
			close: () => {
				this.open = false;
			},
		};
	}
}

class FakeFolder {
	readonly kind = "directory";
	readonly entries = new Map<string, FakeFile | FakeFolder>();

	constructor(readonly name: string) {}

	async getDirectoryHandle(name: string, { create = false } = {}) {
		const found = this.entries.get(name);
		if (found instanceof FakeFolder) return found;
		if (found || !create) throw new DOMException(`no folder ${name}`, "NotFoundError");
		const folder = new FakeFolder(name);
		this.entries.set(name, folder);
		return folder;
	}

	async getFileHandle(name: string, { create = false } = {}) {
		const found = this.entries.get(name);
		if (found instanceof FakeFile) return found;
		if (found || !create) throw new DOMException(`no file ${name}`, "NotFoundError");
		const file = new FakeFile(name);
		this.entries.set(name, file);
		return file;
	}

	async *values() {
		yield* this.entries.values();
	}

	/** Its files, by name. */
	files() {
		return [...this.entries.values()].filter((entry) => entry instanceof FakeFile);
	}
}

/** A slot as the pool writes one: the header, its name in it, then a database's bytes. */
function slot(name: string) {
	const bytes = new Uint8Array(4096 + 16).fill(7, 4096);
	bytes.set(header(name));
	return bytes;
}

const ana = "0193a4b2-0000-7000-8000-000000000001";
const bo = "0193a4b2-0000-7000-8000-000000000002";
const anaFiles = ["", "-journal", "-wal", "-shm"].map((suffix) => `${ana}.db${suffix}`);

let opfs: FakeFolder;
beforeEach(() => {
	opfs = new FakeFolder("");
	Object.defineProperty(navigator, "storage", { value: { getDirectory: async () => opfs }, configurable: true });
	Object.defineProperty(globalThis, "FileSystemFileHandle", { value: FakeFile, configurable: true });
});

/** The pool's folders as the core's install leaves them, with a slot for each of `named`, then `free` free ones. */
async function poolOf(named: string[], free: number) {
	const pool = await opfs.getDirectoryHandle(POOL, { create: true });
	const slots = await pool.getDirectoryHandle(SLOTS, { create: true });
	const lease = await pool.getFileHandle(".lock", { create: true });
	for (const [index, name] of named.entries())
		(await slots.getFileHandle(`named-${index}`, { create: true })).bytes = slot(name);
	for (let index = 0; index < free; index++) {
		(await slots.getFileHandle(`free-${index}`, { create: true })).bytes = new Uint8Array(4096);
	}
	return { slots, lease };
}

/** What a pool's slots hold: their names, and how many are free. */
async function held(slots: FakeFolder) {
	const names = slots.files().map((file) => slotName(file.bytes.subarray(0, NAME_BYTES)));
	return { names: names.filter((name) => name !== null).sort(), free: names.filter((name) => name === null).length };
}

describe("readying the pool", () => {
	test("leaves two slots free, whatever its slots hold, and says what they hold", async () => {
		const five = ["a.db", "b.db", "c.db", "d.db", "e.db"];
		for (const [named, free, added] of [
			[[], 0, 2],
			[five.slice(0, 4), 2, 0],
			[five, 1, 1],
			[[...five, "f.db"], 0, 2],
		] as const) {
			opfs = new FakeFolder("");
			const { slots, lease } = await poolOf([...named], free);
			const before = slots.files().length;
			expect(await preparePool()).toEqual({ state: "free", names: [...named].sort() });
			expect(slots.files().length - before).toBe(added);
			expect(await held(slots)).toEqual({ names: [...named].sort(), free: Math.max(2, free) });
			expect(lease.open).toBe(false);
		}
	});

	test("makes the pool's folders on a first run", async () => {
		expect(await preparePool()).toEqual({ state: "free", names: [] });
		const slots = await (await opfs.getDirectoryHandle(POOL)).getDirectoryHandle(SLOTS);
		expect(await held(slots)).toEqual({ names: [], free: 2 });
	});

	test("waits out a lease or a slot another worker lets go of a moment later", async () => {
		const { slots, lease } = await poolOf(["a.db"], 1);
		lease.held = 2;
		const first = slots.files()[0];
		if (first) first.held = 2;
		expect(await preparePool()).toEqual({ state: "free", names: ["a.db"] });
		expect(lease.open).toBe(false);
	});
});

describe("installing the pool", () => {
	test("says whether it installed, and a refusal while another worker holds the pool is locked", async () => {
		const refused = async () => {
			throw '{"error":{"code":"storage","message":"OPFS: the lease is held"}}';
		};
		expect(await installPool(async () => {})).toBe("installed");
		expect(await installPool(refused, async () => "locked")).toBe("locked");
		expect(await installPool(refused, async () => "free")).toBe("unsupported");
		expect(await installPool(refused, async () => "unsupported")).toBe("unsupported");
		const trapped = new Error("unreachable");
		expect(
			await installPool(async () => {
				throw trapped;
			}).catch((error: unknown) => error),
		).toBe(trapped);
	});
});

describe("deleting a user's database", () => {
	test("frees the user's slots alone, and forgets the key with the pool's lease still held", async () => {
		const { slots, lease } = await poolOf([`${ana}.db`, `${ana}.db-journal`, `${bo}.db`, `${ana}.db.bak`], 1);
		const leaseWhileForgetting: boolean[] = [];
		await deleteFiles(anaFiles, async () => {
			leaseWhileForgetting.push(lease.open);
		});
		expect(leaseWhileForgetting).toEqual([true]);
		expect(lease.open).toBe(false);
		expect(await held(slots)).toEqual({ names: [`${ana}.db.bak`, `${bo}.db`], free: 3 });
		const bos = slots.files().find((file) => slotName(file.bytes.subarray(0, NAME_BYTES)) === `${bo}.db`);
		expect(bos?.bytes.length).toBe(4096 + 16);
	});

	test("waits out a slot another worker lets go of a moment later", async () => {
		const { slots } = await poolOf([`${ana}.db`], 0);
		const file = slots.files()[0];
		if (file) file.held = 2;
		await deleteFiles(anaFiles, async () => {});
		expect(await held(slots)).toEqual({ names: [], free: 1 });
	});

	test("with no pool, forgets the key and makes nothing", async () => {
		let forgot = false;
		await deleteFiles(anaFiles, async () => {
			forgot = true;
		});
		expect(forgot).toBe(true);
		expect(opfs.entries.size).toBe(0);
	});
});
