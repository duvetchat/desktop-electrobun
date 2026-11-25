// The web's database key (PLAN-E2E-CLIENTES.md, where the database and its key live): 32 random bytes, which only the
// core's worker (worker.ts) ever holds as they are. IndexedDB (KEYS_DATABASE, store KEYS_STORE, by user) keeps them
// wrapped with AES-GCM by a CryptoKey made with `extractable: false`, beside it: no byte of the key is kept in clear,
// and the wrapping key can't be taken out of the browser. A script of the same origin could still use that CryptoKey
// as the worker does: the web has nowhere a page can't reach to keep a key in.
import { CoreError } from "../errors";

export const KEYS_DATABASE = "duvet-e2e";
export const KEYS_STORE = "keys";

/** A database key as it's kept: the wrapping key, and the key it seals, `wrapped`: a 12-byte IV, then the sealed key. */
export interface WrappedKey {
	wrapping: CryptoKey;
	wrapped: ArrayBuffer;
}

/** Where wrapped keys are kept, by user: IndexedDB in the worker (keyStore), a Map in tests. */
export interface KeyStore {
	/** The key kept for this user, else `candidate`, kept in the same step: a user never has two. */
	take(userId: string, candidate: WrappedKey): Promise<unknown>;
	/** Forgets this user's key. */
	forget(userId: string): Promise<void>;
}

const IV_BYTES = 12;
const KEY_BYTES = 32;

/** What the sealed key is bound to: whose database it opens, so a record moved to another user doesn't open. */
const boundTo = (userId: string) => new TextEncoder().encode(`duvet-e2e database key ${userId}`);

/** `key`, wrapped for `userId` by a new wrapping key that can't be exported. */
export async function wrapKey(userId: string, key: Uint8Array<ArrayBuffer>): Promise<WrappedKey> {
	const wrapping = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: boundTo(userId) }, wrapping, key);
	const wrapped = new Uint8Array(IV_BYTES + sealed.byteLength);
	wrapped.set(iv);
	wrapped.set(new Uint8Array(sealed), IV_BYTES);
	return { wrapping, wrapped: wrapped.buffer };
}

const badKey = () => new CoreError("bad_key", "the database's key doesn't open");

/** The key `kept` holds for `userId`; bad_key for anything that isn't one, or doesn't open for this user. */
export async function unwrapKey(userId: string, kept: unknown): Promise<Uint8Array<ArrayBuffer>> {
	if (typeof kept !== "object" || kept === null) throw badKey();
	const wrapping: unknown = Reflect.get(kept, "wrapping");
	const wrapped: unknown = Reflect.get(kept, "wrapped");
	if (!(wrapping instanceof CryptoKey) || wrapping.extractable || wrapping.algorithm.name !== "AES-GCM") throw badKey();
	if (!(wrapped instanceof ArrayBuffer) || wrapped.byteLength !== IV_BYTES + KEY_BYTES + 16) throw badKey();
	try {
		const iv = wrapped.slice(0, IV_BYTES);
		const sealed = wrapped.slice(IV_BYTES);
		return new Uint8Array(
			await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: boundTo(userId) }, wrapping, sealed),
		);
	} catch {
		// Another wrapping key, another user's record, or bytes changed: AES-GCM's tag doesn't hold.
		throw badKey();
	}
}

/**
 * This user's database key: the one the store keeps, else a new one, kept before it's handed out, so a database is
 * never made with a key that isn't kept. What's handed out is always what the store holds, unwrapped.
 */
export async function databaseKey(userId: string, store: KeyStore): Promise<Uint8Array<ArrayBuffer>> {
	const fresh = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
	try {
		return await unwrapKey(userId, await store.take(userId, await wrapKey(userId, fresh)));
	} finally {
		fresh.fill(0);
	}
}

/** One request of IndexedDB's, as a promise. */
function done<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** One transaction of IndexedDB's, settled once it's on disk (`strict`): a key is kept before its database is made. */
function committed(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error ?? new Error("the key's transaction was aborted"));
	});
}

async function keysDatabase(): Promise<IDBDatabase> {
	const request = indexedDB.open(KEYS_DATABASE, 1);
	request.onupgradeneeded = () => request.result.createObjectStore(KEYS_STORE);
	return done(request);
}

/** IndexedDB's store of wrapped keys, where taking a key is one transaction. */
export const keyStore: KeyStore = {
	async take(userId, candidate) {
		const database = await keysDatabase();
		try {
			const transaction = database.transaction(KEYS_STORE, "readwrite", { durability: "strict" });
			const store = transaction.objectStore(KEYS_STORE);
			const kept: unknown = await done(store.get(userId));
			if (kept === undefined) store.put(candidate, userId);
			await committed(transaction);
			return kept ?? candidate;
		} finally {
			database.close();
		}
	},
	async forget(userId) {
		const database = await keysDatabase();
		try {
			const transaction = database.transaction(KEYS_STORE, "readwrite", { durability: "strict" });
			transaction.objectStore(KEYS_STORE).delete(userId);
			await committed(transaction);
		} finally {
			database.close();
		}
	},
};
