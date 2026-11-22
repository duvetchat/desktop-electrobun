import { describe, expect, test } from "bun:test";
import {
	isNewerVersion,
	manifestBytes,
	manifestVerifies,
	parseManifest,
	signManifest,
	type UpdateFacts,
} from "./update-manifest";

async function keyPair() {
	const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
	return {
		privateKey: new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
		publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
	};
}

const FACTS: UpdateFacts = { version: "1.2.0", hash: "360ga31val07", tarSha256: "a".repeat(64) };

describe("the signed update manifest (#456)", () => {
	test("a manifest signed with the private key verifies under its public key", async () => {
		const { privateKey, publicKey } = await keyPair();
		const manifest = await signManifest(privateKey, FACTS);
		expect(await manifestVerifies(publicKey, manifest)).toBe(true);
	});

	test("changing any field, or verifying under another key, fails", async () => {
		const { privateKey, publicKey } = await keyPair();
		const manifest = await signManifest(privateKey, FACTS);
		expect(await manifestVerifies(publicKey, { ...manifest, version: "9.9.9" })).toBe(false);
		expect(await manifestVerifies(publicKey, { ...manifest, hash: "otherbuild" })).toBe(false);
		expect(await manifestVerifies(publicKey, { ...manifest, tarSha256: "b".repeat(64) })).toBe(false);
		const other = await keyPair();
		expect(await manifestVerifies(other.publicKey, manifest)).toBe(false);
	});

	test("each field is one line of its own shape, so none can pass for another", async () => {
		const { privateKey } = await keyPair();
		expect(new TextDecoder().decode(manifestBytes(FACTS))).toBe(
			`duvet desktop update v1\n1.2.0\n360ga31val07\n${"a".repeat(64)}`,
		);
		expect(signManifest(privateKey, { ...FACTS, version: "1.2.0\nx" })).rejects.toThrow();
		expect(signManifest(privateKey, { ...FACTS, hash: "UPPER" })).rejects.toThrow();
		expect(signManifest(privateKey, { ...FACTS, tarSha256: "a".repeat(63) })).rejects.toThrow();
	});

	test("parseManifest takes a manifest's shape alone", async () => {
		const { privateKey } = await keyPair();
		const manifest = await signManifest(privateKey, FACTS);
		expect(parseManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
		expect(parseManifest(null)).toBeNull();
		expect(parseManifest("manifest")).toBeNull();
		expect(parseManifest({ ...manifest, signature: "short" })).toBeNull();
		expect(parseManifest({ ...manifest, version: "v1.2.0" })).toBeNull();
		expect(parseManifest({ ...manifest, tarSha256: 12 })).toBeNull();
	});

	test("a version is newer only when it is, compared number by number", () => {
		expect(isNewerVersion("1.1.0", "1.0.0")).toBe(true);
		expect(isNewerVersion("1.10.0", "1.9.9")).toBe(true);
		expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
		expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
		expect(isNewerVersion("1.0.0", "1.0.1")).toBe(false);
		expect(isNewerVersion("1.1", "1.0.0")).toBe(false);
		expect(isNewerVersion("1.1.0", "dev")).toBe(false);
	});
});
