import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signManifest, type UpdateFacts } from "./update-manifest";
import {
	fileSha256,
	platformPrefix,
	updateBatCanName,
	UpdateChecker,
	type UpdateOffer,
	type UpdaterLike,
} from "./updates";

const INSTALLED = "installed01";
const BUILD = new TextEncoder().encode("the new build's tar");
const RESTART: UpdateOffer = { version: "1.2.0", how: "restart" };

async function keyPair() {
	const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
	return {
		privateKey: new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
		publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
	};
}

type Release = { hashes: string[]; bytes: Uint8Array; manifest: unknown };

// Electrobun 1.15.1's Updater as it behaves (node_modules/electrobun/dist/api/bun/core/Updater.ts): checkForUpdate reads
// update.json into one module-level updateInfo, replacing the one before; downloadUpdate and applyUpdate ask
// Updater.checkForUpdate again and take its hash as it comes; downloadUpdate patches from self-extraction's tar of the
// running build when it's there, else downloads the whole build, into <hash>.tar, then keeps only that; applyUpdate does
// nothing unless updateInfo is ready. update.json names release.hashes[0], then the next one at each later read.
function electrobun(release: Release, appData: string) {
	const extraction = join(appData, "self-extraction");
	mkdirSync(extraction, { recursive: true });
	writeFileSync(join(extraction, `${INSTALLED}.tar`), "the running build's tar, as its install left it");
	let updateInfo: { hash: string; updateAvailable: boolean; updateReady: boolean; error: string } | undefined;
	const did: string[] = [];
	const updater: UpdaterLike = {
		checkForUpdate: async () => {
			const hash = (release.hashes.length > 1 ? release.hashes.shift() : release.hashes[0]) ?? "";
			did.push(`check ${hash}`);
			updateInfo = { hash, updateAvailable: hash !== INSTALLED, updateReady: false, error: "" };
			return updateInfo;
		},
		downloadUpdate: async () => {
			const latest = (await updater.checkForUpdate()).hash;
			const tar = join(extraction, `${latest}.tar`);
			if (!existsSync(tar)) {
				did.push(`${existsSync(join(extraction, `${INSTALLED}.tar`)) ? "patch to" : "download"} ${latest}`);
				writeFileSync(tar, release.bytes);
			}
			if (updateInfo) updateInfo.updateReady = true;
			for (const name of readdirSync(extraction)) if (name !== `${latest}.tar`) rmSync(join(extraction, name));
		},
		updateInfo: () => updateInfo,
		applyUpdate: async () => {
			if (!updateInfo?.updateReady) return;
			did.push(`apply ${(await updater.checkForUpdate()).hash}`);
		},
		appDataFolder: async () => appData,
		localInfo: {
			version: async () => "1.1.0",
			hash: async () => INSTALLED,
			channel: async () => "stable",
			baseUrl: async () => "https://releases.example/desktop-stable/",
		},
	};
	return { updater, did, extraction };
}

type SetUp = {
	facts?: Partial<UpdateFacts>;
	otherKey?: boolean;
	bytes?: Uint8Array;
	hashes?: string[];
	folder?: string;
	windows?: boolean;
};

/** A checker over a release of the build BUILD at newbuild01, 1.2.0, signed for this platform, on a stable 1.1.0. */
async function setUp(opts: SetUp = {}) {
	const { privateKey, publicKey } = await keyPair();
	const facts: UpdateFacts = {
		platform: platformPrefix("stable"),
		version: "1.2.0",
		hash: "newbuild01",
		tarSha256: new Bun.CryptoHasher("sha256").update(BUILD).digest("hex"),
		...opts.facts,
	};
	const release: Release = {
		hashes: opts.hashes ?? ["newbuild01"],
		bytes: opts.bytes ?? BUILD,
		manifest: await signManifest(opts.otherKey ? (await keyPair()).privateKey : privateKey, facts),
	};
	const appData = mkdtempSync(join(tmpdir(), opts.folder ?? "duvet-update-"));
	const { updater, did, extraction } = electrobun(release, appData);
	const offers: (UpdateOffer | null)[] = [];
	const fetched: string[] = [];
	const checker = new UpdateChecker(
		updater,
		publicKey,
		(offer) => offers.push(offer),
		async (url) => {
			fetched.push(url);
			return Response.json(release.manifest);
		},
		opts.windows ?? false,
	);
	return { checker, updater, did, extraction, offers, fetched };
}

describe("the app's own updates (#456)", () => {
	test("a newer build whose signed manifest and tar check out is offered, downloaded whole, and nothing restarts by itself", async () => {
		const { checker, did, extraction, offers, fetched } = await setUp();
		await checker.check();
		expect(offers).toEqual([RESTART]);
		expect(checker.offer).toEqual(RESTART);
		// No patch path: Electrobun patches from the running build's tar, which is gone first.
		expect(did).toEqual(["check newbuild01", "download newbuild01"]);
		expect(readdirSync(extraction)).toEqual(["newbuild01.tar"]);
		expect(fetched).toEqual([
			`https://releases.example/desktop-stable/${platformPrefix("stable")}-update-signature.json`,
		]);
		await checker.check();
		expect(did).toHaveLength(2);
	});

	test("Restart to update applies the build verified, whatever update.json names by then", async () => {
		const { checker, did } = await setUp({ hashes: ["newbuild01", "../../evil"] });
		await checker.apply();
		expect(did).toEqual([]);
		await checker.check();
		await checker.apply();
		expect(did).toEqual(["check newbuild01", "download newbuild01", "apply newbuild01"]);
	});

	test("a manifest under another key, for another build or platform, or not newer, is refused before any download", async () => {
		const cases: SetUp[] = [
			{ otherKey: true },
			{ facts: { hash: "otherbuild" } },
			// Another system than the one the test runs on: on a Mac, stable-macos-<arch> is its own.
			{ facts: { platform: platformPrefix("stable", process.platform === "darwin" ? "linux" : "darwin") } },
			{ facts: { platform: "canary-win-x64" } },
			{ facts: { version: "1.1.0" } },
			{ hashes: ["../../evil"], facts: { hash: "newbuild01" } },
		];
		for (const opts of cases) {
			const { checker, did, extraction, offers } = await setUp(opts);
			await checker.check();
			expect(offers).toEqual([]);
			expect(checker.offer).toBeNull();
			expect(did).toEqual([`check ${opts.hashes?.[0] ?? "newbuild01"}`]);
			expect(readdirSync(extraction)).toEqual([`${INSTALLED}.tar`]);
		}
	});

	test("a downloaded tar that isn't the one signed is refused and deleted, so the next check downloads it again", async () => {
		const { checker, did, extraction, offers } = await setUp({ bytes: new TextEncoder().encode("other bytes") });
		await checker.check();
		expect(offers).toEqual([]);
		expect(readdirSync(extraction)).toEqual([]);
		await checker.check();
		expect(did).toEqual(["check newbuild01", "download newbuild01", "check newbuild01", "download newbuild01"]);
	});

	test("no newer build downloads nothing", async () => {
		const { checker, did, offers, fetched } = await setUp({ hashes: [INSTALLED] });
		await checker.check();
		expect(did).toEqual([`check ${INSTALLED}`]);
		expect(offers).toEqual([]);
		expect(fetched).toEqual([]);
	});

	test("on Windows, an app folder update.bat can't name gets Download update, and nothing downloads", async () => {
		const { checker, did, offers } = await setUp({ folder: "duvet-José-", windows: true });
		await checker.check();
		expect(offers).toEqual([{ version: "1.2.0", how: "download" }]);
		expect(did).toEqual(["check newbuild01"]);
		await checker.apply();
		expect(did).toEqual(["check newbuild01"]);

		expect(updateBatCanName("C:/Users/Admin/AppData/Local/com.duvet.desktop/stable")).toBe(true);
		expect(updateBatCanName("C:/Users/John Smith (x) !/AppData/Local/com.duvet.desktop/stable")).toBe(true);
		expect(updateBatCanName("C:/Users/José/AppData/Local/com.duvet.desktop/stable")).toBe(false);
		expect(updateBatCanName("C:/Users/100%/AppData/Local/com.duvet.desktop/stable")).toBe(false);
		// Electrobun hands the folder to schtasks through cmd, outside cmd's quotes.
		expect(updateBatCanName("C:/Users/a&b/AppData/Local/com.duvet.desktop/stable")).toBe(false);
		expect(updateBatCanName("C:/Users/a^b/AppData/Local/com.duvet.desktop/stable")).toBe(false);
	});

	test("applying runs once at a time, and one that fails hands the offer back for another try", async () => {
		const { checker, updater, offers } = await setUp();
		await checker.check();
		let applied = 0;
		updater.applyUpdate = async () => {
			applied++;
			throw new Error("disk full");
		};
		await Promise.all([checker.apply(), checker.apply()]);
		expect(applied).toBe(1);
		expect(offers).toEqual([RESTART, RESTART]);
		await checker.apply();
		expect(applied).toBe(2);
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
