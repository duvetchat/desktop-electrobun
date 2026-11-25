import { describe, expect, test } from "bun:test";
import { CoreError } from "../errors";
import { databaseKey, unwrapKey, wrapKey, type KeyStore, type WrappedKey } from "./keys";

// The web's database key (PLAN-E2E-CLIENTES.md, where the database and its key live): 32 random bytes, wrapped with
// AES-GCM by a CryptoKey that can't be exported, the two kept together. The browser's IndexedDB store is
// e2e-browser/host.cases.ts's; here, a Map does what it does.

const ana = "0193a4b2-0000-7000-8000-000000000001";
const bo = "0193a4b2-0000-7000-8000-000000000002";

/** The store as keyStore keeps IndexedDB's: a user's key kept once, the first one taken. */
class MapStore implements KeyStore {
	readonly kept = new Map<string, WrappedKey>();
	async take(userId: string, candidate: WrappedKey) {
		const kept = this.kept.get(userId);
		if (kept) return kept;
		this.kept.set(userId, candidate);
		return candidate;
	}
	async forget(userId: string) {
		this.kept.delete(userId);
	}
}

/** Whether `needle` appears in `haystack`, byte for byte. */
function contains(haystack: Uint8Array, needle: Uint8Array) {
	for (let at = 0; at + needle.length <= haystack.length; at++) {
		if (needle.every((byte, index) => haystack[at + index] === byte)) return true;
	}
	return false;
}

const refusal = (promise: Promise<unknown>) =>
	promise.then(
		() => null,
		(error: unknown) => error,
	);

describe("the database key", () => {
	test("a key wrapped for a user unwraps for that user", async () => {
		const key = crypto.getRandomValues(new Uint8Array(32));
		const wrapped = await wrapKey(ana, key);
		expect(await unwrapKey(ana, wrapped)).toEqual(key);
		// What's kept: the wrapping key, which can't leave the browser, and the key sealed: its IV, its 32 bytes, its tag.
		expect(Object.keys(wrapped).sort()).toEqual(["wrapped", "wrapping"]);
		expect(wrapped.wrapping.extractable).toBe(false);
		expect(wrapped.wrapping.algorithm.name).toBe("AES-GCM");
		expect(await refusal(crypto.subtle.exportKey("raw", wrapped.wrapping))).toBeTruthy();
		expect(wrapped.wrapped.byteLength).toBe(12 + 32 + 16);
		expect(contains(new Uint8Array(wrapped.wrapped), key)).toBe(false);
	});

	test("another key doesn't open it", async () => {
		const key = crypto.getRandomValues(new Uint8Array(32));
		const wrapped = await wrapKey(ana, key);
		const other = await wrapKey(ana, key);
		// Another wrapping key, the same sealed bytes.
		const swapped = await refusal(unwrapKey(ana, { wrapping: other.wrapping, wrapped: wrapped.wrapped }));
		expect(swapped).toBeInstanceOf(CoreError);
		expect(swapped).toMatchObject({ code: "bad_key" });
		// Another user's: the key is bound to whose database it opens.
		expect(await refusal(unwrapKey(bo, wrapped))).toMatchObject({ code: "bad_key" });
		// A byte changed, or the bytes cut short.
		const flipped = new Uint8Array(wrapped.wrapped.slice(0));
		flipped[20] = (flipped[20] ?? 0) ^ 1;
		expect(await refusal(unwrapKey(ana, { wrapping: wrapped.wrapping, wrapped: flipped.buffer }))).toMatchObject({
			code: "bad_key",
		});
		expect(
			await refusal(unwrapKey(ana, { wrapping: wrapped.wrapping, wrapped: wrapped.wrapped.slice(0, 40) })),
		).toMatchObject({ code: "bad_key" });
	});

	test("a key that can be exported, or isn't AES-GCM's, isn't taken", async () => {
		const key = crypto.getRandomValues(new Uint8Array(32));
		const wrapped = await wrapKey(ana, key);
		// Sealed as wrapKey seals, but by a key that can be exported: it would open, and isn't taken.
		const exportable = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const additionalData = new TextEncoder().encode(`duvet-e2e database key ${ana}`);
		const sealed = new Uint8Array(
			await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, exportable, key),
		);
		const opens = new Uint8Array([...iv, ...sealed]).buffer;
		expect(
			new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData }, exportable, sealed)),
		).toEqual(key);
		expect(await refusal(unwrapKey(ana, { wrapping: exportable, wrapped: opens }))).toMatchObject({
			code: "bad_key",
		});
		const hmac = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
		expect(await refusal(unwrapKey(ana, { wrapping: hmac, wrapped: wrapped.wrapped }))).toMatchObject({
			code: "bad_key",
		});
	});

	test("the key is made once and kept, one for each user", async () => {
		const store = new MapStore();
		const first = await databaseKey(ana, store);
		expect(first.length).toBe(32);
		expect(await databaseKey(ana, store)).toEqual(first);
		const other = await databaseKey(bo, store);
		expect(other).not.toEqual(first);
		expect([...store.kept.keys()].sort()).toEqual([ana, bo]);
		// Nothing kept holds a key's bytes as they are.
		for (const kept of store.kept.values()) {
			expect(contains(new Uint8Array(kept.wrapped), first)).toBe(false);
			expect(contains(new Uint8Array(kept.wrapped), other)).toBe(false);
		}
	});

	test("a key two opens make at once is one", async () => {
		const store = new MapStore();
		const [one, two] = await Promise.all([databaseKey(ana, store), databaseKey(ana, store)]);
		expect(two).toEqual(one);
		expect(store.kept.size).toBe(1);
	});

	test("a key forgotten is made anew", async () => {
		const store = new MapStore();
		const first = await databaseKey(ana, store);
		await store.forget(ana);
		expect(await databaseKey(ana, store)).not.toEqual(first);
	});
});
