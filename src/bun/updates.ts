// The app's own updates, on the stable channel (desktop#456). Electrobun's Updater finds a new version at the release's
// base URL (the rolling desktop-stable release of duvetchat/releases). Before anything is downloaded, Duvet verifies the
// manifest the release workflow signed for that build (update-manifest.ts), for this platform and newer than this
// version; once Electrobun has downloaded it into self-extraction/<hash>.tar, it checks that tar's SHA-256 against the
// manifest. The page then offers "Restart to update", which applies it: nothing restarts by itself.
//
// What Electrobun 1.15.1 does that this works around:
// - downloadUpdate and applyUpdate read update.json again and take the hash it names as a file name, unchecked. While
//   they run, its checkForUpdate gives the build verified here instead (pinned). A plain checkForUpdate also replaces the
//   update info applyUpdate needs ready, which left Restart to update doing nothing.
// - downloadUpdate patches from the running build's tar when it's there, and files what the patch makes of it before
//   anything is verified. That tar is deleted first, so it downloads the whole build.
// - On Windows it applies through an update.bat written in UTF-8, which cmd reads in the console's code page, and where
//   `%` starts a variable. It schedules that script with a schtasks command run through cmd, which reads the folder
//   outside its quotes, where `&` ends the command and `^` escapes the next character: with `^`, the app would quit
//   and not open again by itself. An app folder with any of those gets "Download update" (duvet.chat/download)
//   instead.
// - On Linux it moves the new build into <appData>/app, then runs `chmod +x "<launcher>"` and opens it again with
//   sh -c "\"<launcher>\" &". Between a shell's double quotes `"`, `$`, `` ` `` and `\` don't stand for themselves: the
//   chmod would fail once the old build is gone, and nothing would open again. A data folder with any of them gets
//   "Download update" too.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { isNewerVersion, manifestVerifies, parseManifest, type UpdateManifest } from "./update-manifest";

/** Electrobun's update info, as its checkForUpdate gives it. */
type Found = { updateAvailable: boolean; hash: string };

/** What the checker needs of Electrobun's Updater, so a test can stand in for it. */
export interface UpdaterLike {
	checkForUpdate: () => Promise<Found>;
	downloadUpdate: () => Promise<void>;
	updateInfo: () => { updateReady: boolean; error: string } | undefined;
	applyUpdate: () => Promise<void>;
	appDataFolder: () => Promise<string>;
	localInfo: {
		version: () => Promise<string>;
		hash: () => Promise<string>;
		channel: () => Promise<string>;
		baseUrl: () => Promise<string>;
	};
}

/** What the title bar offers: restart into a build verified here, or download it from duvet.chat. */
export type UpdateOffer = { version: string; how: "restart" | "download" };

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

/** Whether Electrobun can apply an update in a folder on Windows: printable ASCII (space to `~`) but `%`, `&` and `^`. */
export function updateBatCanName(folder: string): boolean {
	return /^[ -~]*$/.test(folder) && !/[%&^]/.test(folder);
}

/** Whether Electrobun can apply an update in a folder on Linux: one a shell reads as itself between double quotes. */
export function shellCanQuote(folder: string): boolean {
	return !/["$`\\]/.test(folder);
}

/** The SHA-256 of a file, in hex, read as a stream. */
export async function fileSha256(path: string): Promise<string> {
	const hasher = new Bun.CryptoHasher("sha256");
	for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
	return hasher.digest("hex");
}

export class UpdateChecker {
	private offered: UpdateOffer | null = null;
	/** Electrobun's info on the build downloaded and verified, which applyUpdate gets. */
	private verified: Found | null = null;
	private checking = false;
	private applying = false;

	constructor(
		private readonly updater: UpdaterLike,
		private readonly publicKey: Uint8Array<ArrayBuffer>,
		private readonly onOffer: (offer: UpdateOffer | null) => void,
		private readonly fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
		/** The system whose rules for the app's data folder hold: Windows' update.bat, Linux's shell. */
		private readonly platform: string = process.platform,
	) {}

	/** What the title bar offers; null for nothing. */
	get offer(): UpdateOffer | null {
		return this.offered;
	}

	/** Checks a while after the start, then every few hours, on the stable channel only. */
	async start(): Promise<void> {
		if ((await this.updater.localInfo.channel()) !== "stable") return;
		setTimeout(() => void this.check(), FIRST_CHECK_MS);
		setInterval(() => void this.check(), CHECK_EVERY_MS);
	}

	/** Looks for a newer version, and offers it once it's verified. */
	async check(): Promise<void> {
		if (this.checking || this.offered) return;
		this.checking = true;
		try {
			const found = await this.updater.checkForUpdate();
			if (!found?.updateAvailable) return;
			const manifest = await this.signedManifest(found.hash);
			if (typeof manifest === "string") {
				console.error(`[update] not taking ${found.hash}: ${manifest}`);
				return;
			}
			// found.hash is now the signed one, a safe file name.
			const appData = await this.updater.appDataFolder();
			if (!this.canApplyIn(appData)) {
				this.offerNow({ version: manifest.version, how: "download" });
				return;
			}
			const extraction = join(appData, "self-extraction");
			await rm(join(extraction, `${await this.updater.localInfo.hash()}.tar`), { force: true });
			await this.pinned(found, () => this.updater.downloadUpdate());
			const info = this.updater.updateInfo();
			if (!info?.updateReady) {
				console.error("[update] the download failed:", info?.error ?? "no update info");
				return;
			}
			const tar = join(extraction, `${found.hash}.tar`);
			if ((await fileSha256(tar)) !== manifest.tarSha256) {
				// Deleted, or Electrobun would take it as downloaded at the next check.
				console.error(`[update] not taking ${found.hash}: the downloaded build isn't the one signed`);
				await rm(tar, { force: true });
				return;
			}
			this.verified = found;
			this.offerNow({ version: manifest.version, how: "restart" });
		} catch (err) {
			console.error("[update] the check failed:", err);
		} finally {
			this.checking = false;
		}
	}

	/** The manifest signed for a build, when it verifies, is for this platform and is newer than this version; else why not. */
	async signedManifest(hash: string): Promise<UpdateManifest | string> {
		const [baseUrl, channel, current] = await Promise.all([
			this.updater.localInfo.baseUrl(),
			this.updater.localInfo.channel(),
			this.updater.localInfo.version(),
		]);
		const prefix = platformPrefix(channel);
		const response = await this.fetcher(`${baseUrl.replace(/\/+$/, "")}/${prefix}-update-signature.json`);
		if (!response.ok) return `no signed manifest (${response.status})`;
		const manifest = parseManifest(await response.json().catch(() => null));
		if (!manifest) return "the manifest isn't well formed";
		if (!(await manifestVerifies(this.publicKey, manifest))) return "the manifest's signature doesn't verify";
		if (manifest.platform !== prefix) return `the manifest is for ${manifest.platform}`;
		if (manifest.hash !== hash) return "the manifest names another build";
		if (!isNewerVersion(manifest.version, current)) return `version ${manifest.version} isn't newer than ${current}`;
		return manifest;
	}

	/** Applies the verified build: the app quits, is replaced and opens again. */
	async apply(): Promise<void> {
		if (!this.verified || this.applying) return;
		this.applying = true;
		try {
			await this.pinned(this.verified, () => this.updater.applyUpdate());
			// It quits once update.bat is set to put the new build in place: back here, it didn't get that far.
			console.error("[update] the update wasn't applied:", this.updater.updateInfo()?.error ?? "");
		} catch (err) {
			console.error("[update] applying the update failed:", err);
		} finally {
			this.applying = false;
			// The page waits on "Restarting…": offered again, it can be tried again.
			this.onOffer(this.offered);
		}
	}

	/** Whether Electrobun can apply an update with the app's data in that folder, on this system. */
	private canApplyIn(folder: string): boolean {
		if (this.platform === "win32") return updateBatCanName(folder);
		if (this.platform === "linux") return shellCanQuote(folder);
		return true;
	}

	/** Runs Electrobun's download or apply with its checkForUpdate giving the build checked here. */
	private async pinned(found: Found, run: () => Promise<void>): Promise<void> {
		const real = this.updater.checkForUpdate;
		this.updater.checkForUpdate = async () => found;
		try {
			await run();
		} finally {
			this.updater.checkForUpdate = real;
		}
	}

	private offerNow(offer: UpdateOffer): void {
		this.offered = offer;
		this.onOffer(offer);
	}
}
