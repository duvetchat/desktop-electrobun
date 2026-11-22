// The app's own updates, on the stable channel (desktop#456). Electrobun's Updater finds a new version at the release's
// base URL (the rolling desktop-stable release of duvetchat/releases) and downloads it into self-extraction/<hash>.tar.
// Before Duvet applies it, it verifies the manifest the release workflow signed (update-manifest.ts) and that tar's
// SHA-256, and refuses a version that isn't newer. The page then shows "Restart to update", which applies it: nothing
// restarts by itself.
import { join } from "node:path";
import { isNewerVersion, manifestVerifies, parseManifest } from "./update-manifest";

/** What the checker needs of Electrobun's Updater, so a test can stand in for it. */
export interface UpdaterLike {
	checkForUpdate(): Promise<{ updateAvailable: boolean; hash: string }>;
	downloadUpdate(): Promise<void>;
	updateInfo(): { updateReady: boolean; error: string } | undefined;
	applyUpdate(): Promise<void>;
	appDataFolder(): Promise<string>;
	localInfo: { version(): Promise<string>; channel(): Promise<string>; baseUrl(): Promise<string> };
}

export const FIRST_CHECK_MS = 30_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Electrobun's name for a build's platform in release file names (stable-win-x64 and the like). */
export function platformPrefix(
	channel: string,
	platform: string = process.platform,
	arch: string = process.arch,
): string {
	const os = platform === "win32" ? "win" : platform === "darwin" ? "macos" : "linux";
	return `${channel}-${os}-${arch}`;
}

/** The SHA-256 of a file, in hex, read as a stream. */
export async function fileSha256(path: string): Promise<string> {
	const hasher = new Bun.CryptoHasher("sha256");
	for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
	return hasher.digest("hex");
}

export class UpdateChecker {
	private ready: { version: string; hash: string } | null = null;
	private checking = false;

	constructor(
		private readonly updater: UpdaterLike,
		private readonly publicKey: Uint8Array<ArrayBuffer>,
		private readonly onReady: (version: string) => void,
		private readonly fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
		private readonly hashFile: (path: string) => Promise<string> = fileSha256,
	) {}

	/** The version downloaded and verified, waiting for "Restart to update"; null for none. */
	get readyVersion(): string | null {
		return this.ready?.version ?? null;
	}

	/** Checks a while after the start, then every few hours, on the stable channel only. */
	async start(): Promise<void> {
		if ((await this.updater.localInfo.channel()) !== "stable") return;
		setTimeout(() => void this.check(), FIRST_CHECK_MS);
		setInterval(() => void this.check(), CHECK_EVERY_MS);
	}

	/** Looks for a newer version, downloads it and verifies it; a verified one is ready. */
	async check(): Promise<void> {
		if (this.checking || this.ready) return;
		this.checking = true;
		try {
			const found = await this.updater.checkForUpdate();
			if (!found.updateAvailable) return;
			await this.updater.downloadUpdate();
			const info = this.updater.updateInfo();
			if (!info?.updateReady) {
				console.error("[update] the download failed:", info?.error ?? "no update info");
				return;
			}
			const verdict = await this.verify(found.hash);
			if ("refused" in verdict) {
				console.error(`[update] not applying ${found.hash}: ${verdict.refused}`);
				return;
			}
			this.ready = { version: verdict.version, hash: found.hash };
			this.onReady(verdict.version);
		} catch (err) {
			console.error("[update] the check failed:", err);
		} finally {
			this.checking = false;
		}
	}

	/** Whether the downloaded build is the one the release workflow signed, newer than this one. */
	async verify(hash: string): Promise<{ version: string } | { refused: string }> {
		const [baseUrl, channel, current] = await Promise.all([
			this.updater.localInfo.baseUrl(),
			this.updater.localInfo.channel(),
			this.updater.localInfo.version(),
		]);
		const response = await this.fetcher(
			`${baseUrl.replace(/\/+$/, "")}/${platformPrefix(channel)}-update-signature.json`,
		);
		if (!response.ok) return { refused: `no signed manifest (${response.status})` };
		const manifest = parseManifest(await response.json().catch(() => null));
		if (!manifest) return { refused: "the manifest isn't well formed" };
		if (!(await manifestVerifies(this.publicKey, manifest)))
			return { refused: "the manifest's signature doesn't verify" };
		if (manifest.hash !== hash) return { refused: "the manifest names another build" };
		if (!isNewerVersion(manifest.version, current)) {
			return { refused: `version ${manifest.version} isn't newer than ${current}` };
		}
		const tar = join(await this.updater.appDataFolder(), "self-extraction", `${hash}.tar`);
		if ((await this.hashFile(tar)) !== manifest.tarSha256)
			return { refused: "the downloaded build isn't the one signed" };
		return { version: manifest.version };
	}

	/** Applies the verified update: the app quits, is replaced and opens again. */
	async apply(): Promise<void> {
		if (!this.ready) return;
		// Electrobun's applyUpdate reads update.json again and extracts the tar it names: only while that's still the
		// build verified.
		const now = await this.updater.checkForUpdate();
		if (now.hash !== this.ready.hash) {
			console.error(`[update] the release moved from ${this.ready.hash} to ${now.hash}; checking again`);
			this.ready = null;
			void this.check();
			return;
		}
		await this.updater.applyUpdate();
	}
}
