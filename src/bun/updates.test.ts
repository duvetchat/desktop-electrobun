import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signManifest, type UpdateFacts } from "./update-manifest";
import { fileSha256, platformPrefix, UpdateChecker, type UpdaterLike } from "./updates";

const TAR_SHA = "c".repeat(64);
const FACTS: UpdateFacts = { version: "1.2.0", hash: "newbuild01", tarSha256: TAR_SHA };

async function keyPair() {
	const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
	return {
		privateKey: new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
		publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
	};
}

// An Updater that has a newer build at `hash` on stable, at 1.1.0, recording what was asked of it.
function fakeUpdater(hash = FACTS.hash) {
	const asked: string[] = [];
	const updater: UpdaterLike & { hash: string } = {
		hash,
		checkForUpdate: async () => {
			asked.push("check");
			return { updateAvailable: updater.hash !== "installed", hash: updater.hash };
		},
		downloadUpdate: async () => void asked.push("download"),
		updateInfo: () => ({ updateReady: true, error: "" }),
		applyUpdate: async () => void asked.push("apply"),
		appDataFolder: async () => "/data",
		localInfo: {
			version: async () => "1.1.0",
			channel: async () => "stable",
			baseUrl: async () => "https://releases.example/desktop-stable/",
		},
	};
	return { updater, asked };
}

async function checkerFor(manifest: unknown, opts: { publicKey?: Uint8Array<ArrayBuffer>; tarSha?: string } = {}) {
	const { updater, asked } = fakeUpdater();
	const fetched: string[] = [];
	const readied: string[] = [];
	const hashed: string[] = [];
	const checker = new UpdateChecker(
		updater,
		opts.publicKey ?? (await keyPair()).publicKey,
		(version) => readied.push(version),
		async (url) => {
			fetched.push(url);
			return Response.json(manifest);
		},
		async (path) => {
			hashed.push(path);
			return opts.tarSha ?? TAR_SHA;
		},
	);
	return { checker, updater, asked, fetched, readied, hashed };
}

describe("the app's own updates (#456)", () => {
	test("a newer build whose signed manifest and tar check out is ready, and nothing restarts by itself", async () => {
		const { privateKey, publicKey } = await keyPair();
		const manifest = await signManifest(privateKey, FACTS);
		const { checker, asked, fetched, readied, hashed } = await checkerFor(manifest, { publicKey });
		await checker.check();
		expect(readied).toEqual(["1.2.0"]);
		expect(checker.readyVersion).toBe("1.2.0");
		expect(asked).toEqual(["check", "download"]);
		expect(fetched).toEqual([
			`https://releases.example/desktop-stable/${platformPrefix("stable")}-update-signature.json`,
		]);
		expect(hashed).toEqual([join("/data", "self-extraction", "newbuild01.tar")]);
	});

	test("a manifest under another key, for another build, older, or for other bytes is refused", async () => {
		const { privateKey, publicKey } = await keyPair();
		const other = await keyPair();
		const cases = [
			{ manifest: await signManifest(other.privateKey, FACTS), publicKey },
			{ manifest: await signManifest(privateKey, { ...FACTS, hash: "otherbuild" }), publicKey },
			{ manifest: await signManifest(privateKey, { ...FACTS, version: "1.1.0" }), publicKey },
			{ manifest: await signManifest(privateKey, FACTS), publicKey, tarSha: "d".repeat(64) },
			{ manifest: { not: "a manifest" }, publicKey },
		];
		for (const { manifest, publicKey: key, tarSha } of cases) {
			const { checker, readied } = await checkerFor(manifest, { publicKey: key, tarSha });
			await checker.check();
			expect(readied).toEqual([]);
			expect(checker.readyVersion).toBeNull();
		}
	});

	test("no newer build downloads nothing", async () => {
		const { checker, updater, asked, readied } = await checkerFor({});
		updater.hash = "installed";
		await checker.check();
		expect(asked).toEqual(["check"]);
		expect(readied).toEqual([]);
	});

	test("Restart to update applies the build verified, and only while the release still names it", async () => {
		const { privateKey, publicKey } = await keyPair();
		const manifest = await signManifest(privateKey, FACTS);
		const { checker, asked } = await checkerFor(manifest, { publicKey });
		await checker.apply();
		expect(asked).toEqual([]);
		await checker.check();
		await checker.apply();
		expect(asked).toEqual(["check", "download", "check", "apply"]);

		const moved = await checkerFor(manifest, { publicKey });
		await moved.checker.check();
		moved.updater.hash = "movedbuild";
		await moved.checker.apply();
		expect(moved.asked).not.toContain("apply");
		expect(moved.checker.readyVersion).toBeNull();
	});

	test("release file names use Electrobun's platform prefix", () => {
		expect(platformPrefix("stable", "win32", "x64")).toBe("stable-win-x64");
		expect(platformPrefix("stable", "darwin", "arm64")).toBe("stable-macos-arm64");
		expect(platformPrefix("canary", "linux", "x64")).toBe("canary-linux-x64");
	});

	test("a file's SHA-256 is read as it's stored", async () => {
		const dir = mkdtempSync(join(tmpdir(), "duvet-update-"));
		const path = join(dir, "build.tar");
		writeFileSync(path, "duvet");
		expect(await fileSha256(path)).toBe(new Bun.CryptoHasher("sha256").update("duvet").digest("hex"));
	});
});
