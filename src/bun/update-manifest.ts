// The manifest the release workflow signs for each desktop update (desktop#456): the platform it's for, the version, the
// build's hash and the SHA-256 of the tar Electrobun applies, signed with Ed25519. Electrobun's Updater checks only the
// hash, which it reads from the update itself; the app applies an update only once this manifest verifies under the
// public key it ships (updates.ts, update-key.ts). The workflow signs it with the private one (scripts/sign-update.ts).

export interface UpdateFacts {
	/** Electrobun's prefix of the release's files: the channel, the system and the architecture (stable-win-x64). */
	platform: string;
	/** The version, x.y.z. */
	version: string;
	/** Electrobun's hash of the build, as its update.json names it. */
	hash: string;
	/** The SHA-256 of the build's tar before zstd, in hex: the bytes Electrobun extracts. */
	tarSha256: string;
}

export interface UpdateManifest extends UpdateFacts {
	/** The Ed25519 signature of manifestBytes(the facts), in base64. */
	signature: string;
}

const HEADER = "duvet desktop update v1";
const PLATFORM = /^[a-z]{1,16}-(win|macos|linux)-(x64|arm64)$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Electrobun names files after the hash (self-extraction/<hash>.tar), so a signed one is also a safe file name.
const HASH = /^[0-9a-z]{1,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;

/** Whether facts are shaped as a signature may cover them: one line each, so no field can pass for another. */
export function wellFormed(facts: UpdateFacts): boolean {
	return (
		PLATFORM.test(facts.platform) &&
		VERSION.test(facts.version) &&
		HASH.test(facts.hash) &&
		SHA256.test(facts.tarSha256)
	);
}

/** The bytes a signature covers. */
export function manifestBytes(facts: UpdateFacts): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode([HEADER, facts.platform, facts.version, facts.hash, facts.tarSha256].join("\n"));
}

/** A manifest as fetched, or null when it isn't one: any JSON goes in. */
export function parseManifest(json: unknown): UpdateManifest | null {
	if (typeof json !== "object" || json === null) return null;
	const platform: unknown = Reflect.get(json, "platform");
	const version: unknown = Reflect.get(json, "version");
	const hash: unknown = Reflect.get(json, "hash");
	const tarSha256: unknown = Reflect.get(json, "tarSha256");
	const signature: unknown = Reflect.get(json, "signature");
	if (typeof platform !== "string" || typeof version !== "string") return null;
	if (typeof hash !== "string" || typeof tarSha256 !== "string") return null;
	if (typeof signature !== "string" || !SIGNATURE.test(signature)) return null;
	const manifest = { platform, version, hash, tarSha256, signature };
	return wellFormed(manifest) ? manifest : null;
}

/** Signs facts with an Ed25519 private key (PKCS #8). */
export async function signManifest(
	privateKeyPkcs8: Uint8Array<ArrayBuffer>,
	facts: UpdateFacts,
): Promise<UpdateManifest> {
	if (!wellFormed(facts)) throw new Error("the update's facts aren't well formed");
	const key = await crypto.subtle.importKey("pkcs8", privateKeyPkcs8, { name: "Ed25519" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("Ed25519", key, manifestBytes(facts));
	return { ...facts, signature: Buffer.from(signature).toString("base64") };
}

/** Whether a manifest's signature verifies under an Ed25519 public key (its 32 raw bytes). */
export async function manifestVerifies(
	publicKeyRaw: Uint8Array<ArrayBuffer>,
	manifest: UpdateManifest,
): Promise<boolean> {
	if (!wellFormed(manifest) || !SIGNATURE.test(manifest.signature)) return false;
	try {
		const key = await crypto.subtle.importKey("raw", publicKeyRaw, { name: "Ed25519" }, false, ["verify"]);
		return await crypto.subtle.verify(
			"Ed25519",
			key,
			new Uint8Array(Buffer.from(manifest.signature, "base64")),
			manifestBytes(manifest),
		);
	} catch {
		return false;
	}
}

/** Whether a version x.y.z is newer than another; anything that isn't one is never newer. */
export function isNewerVersion(candidate: string, current: string): boolean {
	const a = VERSION.exec(candidate);
	const b = VERSION.exec(current);
	if (!a || !b) return false;
	for (let i = 1; i <= 3; i++) {
		const step = Number(a[i]) - Number(b[i]);
		if (step !== 0) return step > 0;
	}
	return false;
}
