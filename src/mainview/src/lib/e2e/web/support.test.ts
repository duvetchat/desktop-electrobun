import { describe, expect, test } from "bun:test";
import { missingInPage, missingInWorker } from "./support";

// What a browser must have for the web's core (decision 49.6): Web Locks, OPFS and, in its worker, OPFS's synchronous
// access handles. Without one, the DMs show their notice and the rest of the app goes on: nothing here throws.

const fn = () => {};

/** A page that has everything the core needs. */
const page = () => ({
	navigator: { locks: { request: fn }, storage: { getDirectory: fn } },
	Worker: fn,
	BroadcastChannel: fn,
});

/** A dedicated worker that has everything the core needs. */
const worker = () => ({
	navigator: { storage: { getDirectory: fn } },
	FileSystemSyncAccessHandle: fn,
	FileSystemFileHandle: { prototype: { createSyncAccessHandle: fn } },
	indexedDB: { open: fn },
	crypto: { subtle: { encrypt: fn }, getRandomValues: fn },
});

describe("what the browser has", () => {
	test("a page with all of it lacks nothing", () => {
		expect(missingInPage(page())).toEqual([]);
		expect(missingInWorker(worker())).toEqual([]);
	});

	test("a page says which it lacks", () => {
		expect(missingInPage({ ...page(), navigator: { storage: { getDirectory: fn } } })).toEqual(["locks"]);
		expect(missingInPage({ ...page(), navigator: { locks: { request: fn }, storage: {} } })).toEqual(["opfs"]);
		expect(missingInPage({ ...page(), navigator: { locks: { request: fn } } })).toEqual(["opfs"]);
		const { Worker: _worker, BroadcastChannel: _channel, ...rest } = page();
		expect(missingInPage(rest)).toEqual(["workers", "broadcast_channel"]);
		expect(missingInPage({})).toEqual(["locks", "opfs", "workers", "broadcast_channel"]);
	});

	test("a worker says which it lacks: the synchronous access handles are a worker's alone", () => {
		const { FileSystemSyncAccessHandle: _handle, FileSystemFileHandle: _file, ...withoutHandles } = worker();
		expect(missingInWorker(withoutHandles)).toEqual(["sync_access_handles"]);
		expect(missingInWorker({ ...worker(), FileSystemFileHandle: { prototype: {} } })).toEqual(["sync_access_handles"]);
		expect(missingInWorker({ ...worker(), crypto: { getRandomValues: fn } })).toEqual(["web_crypto"]);
		const { indexedDB: _db, ...withoutStorage } = worker();
		expect(missingInWorker({ ...withoutStorage, navigator: {} })).toEqual(["opfs", "indexeddb"]);
	});

	test("what isn't there, or throws as it's read, is missing, and nothing throws", () => {
		const throwing = {
			get navigator(): never {
				throw new Error("a getter that throws, as some do outside a secure context");
			},
		};
		expect(missingInPage(throwing)).toEqual(["locks", "opfs", "workers", "broadcast_channel"]);
		expect(missingInWorker({ navigator: null, crypto: 7 })).toEqual([
			"opfs",
			"sync_access_handles",
			"indexeddb",
			"web_crypto",
		]);
		// This process, which has no Web Locks nor OPFS: said, not thrown.
		expect(missingInPage()).toContain("locks");
	});
});
