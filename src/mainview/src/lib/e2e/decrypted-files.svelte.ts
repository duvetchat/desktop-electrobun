// What this device decrypted of conversations' files (PLAN-E2E-CLIENTES.md, «Adjuntos»; Ruling 19): in memory alone,
// MAX_DECRYPTED of it, the file drawn longest ago let go of first, and every file of a message as the message is
// deleted, each one's URL revoked as it goes. A file is downloaded from its signed URL, opened by the core and checked
// (engine/files.ts' openSealed) once, whoever asks: two panes showing a message share it. One let go of for room isn't
// fetched again by itself, as the view still showing it would fetch it in turn and let another go: a click does. Reads
// are reactive (createSubscriber, as conversation-content.svelte.ts's), so what draws a file draws it again as it
// changes. No rune: Bun's tests load it as it is.
import { createSubscriber } from "svelte/reactivity";
import { FileError, openSealed, type FileFailure, type FileRef } from "./engine/files";

/** How much decrypted memory holds: 256 MiB. */
export const MAX_DECRYPTED = 256 << 20;

/** Where a file is: on its way (how far, from 0 to 1), here (its URL, and its bytes' type), not shown (why), or let go
 * of for room. */
export type FileState =
	| { status: "loading"; progress: number }
	| { status: "ready"; url: string; type: string; blob: Blob }
	| { status: "failed"; reason: FileFailure }
	| { status: "gone" };

/** How a file's sealed bytes come down from a signed URL, and how this device's core opens them. */
export interface Opener {
	download(url: string, most: number, progress?: (received: number) => void): Promise<Uint8Array>;
	open(key: string, id: string, sealed: Blob, progress?: (done: number) => void): Promise<Blob>;
}

/** A file to open: what its message says of its bytes, and the API's signed URL of them (none when it names none). */
export type Openable = Pick<FileRef, "id" | "key" | "sha256" | "size"> & { url: string | null };

interface Entry {
	state: FileState;
	/** The message it's of, which takes it along as it's deleted. */
	message: string;
	/** When it was last drawn or asked for: the one drawn longest ago goes first. */
	used: number;
	work: Promise<FileState> | null;
}

export class DecryptedFiles {
	readonly #files = new Map<string, Entry>();
	readonly #limit: number;
	readonly #url: (blob: Blob) => string;
	readonly #revoke: (url: string) => void;
	#opener: Opener | null = null;
	#clock = 0;
	#used = 0;
	#changed = () => {};
	readonly #track = createSubscriber((update) => {
		this.#changed = update;
		return () => (this.#changed = () => {});
	});

	constructor(
		limit = MAX_DECRYPTED,
		url = (blob: Blob) => URL.createObjectURL(blob),
		revoke = (made: string) => URL.revokeObjectURL(made),
	) {
		this.#limit = limit;
		this.#url = url;
		this.#revoke = revoke;
	}

	/** How many bytes of decrypted files memory holds. */
	get used(): number {
		return this.#used;
	}

	/** What opens files from now on; none (the engine stopped, or the person signed out) lets every file go. */
	useOpener(opener: Opener | null) {
		this.#opener = opener;
		if (opener) return;
		for (const entry of this.#files.values()) this.#release(entry);
		this.#files.clear();
		this.#changed();
	}

	/** Where the file is: undefined while nobody asked for it. Reading it counts as drawing it. */
	state(id: string): FileState | undefined {
		this.#track();
		const entry = this.#files.get(id);
		if (entry) entry.used = ++this.#clock;
		return entry?.state;
	}

	/**
	 * The file of a message, downloaded, opened and checked, unless it's here or on its way: what it ends as. `auto` is a
	 * view's own ask as it shows, which doesn't fetch again a file let go of for room.
	 */
	open(file: Openable, message: string, { auto = false }: { auto?: boolean } = {}): Promise<FileState> {
		const had = this.#files.get(file.id);
		if (had?.work) return had.work;
		const status = had?.state.status;
		if (had && (status === "ready" || status === "failed" || (auto && status === "gone"))) {
			had.used = ++this.#clock;
			return Promise.resolve(had.state);
		}
		const { url } = file;
		const opener = this.#opener;
		if (!url || !opener) {
			const unavailable: FileState = { status: "failed", reason: "unavailable" };
			// None for its message: kept. No engine yet: asked again once there's one.
			if (!url) this.#files.set(file.id, { state: unavailable, message, used: ++this.#clock, work: null });
			this.#changed();
			return Promise.resolve(unavailable);
		}
		const entry: Entry = { state: { status: "loading", progress: 0 }, message, used: ++this.#clock, work: null };
		this.#files.set(file.id, entry);
		this.#changed();
		const deps = {
			download: (most: number, progress?: (received: number) => void) => opener.download(url, most, progress),
			open: (key: string, id: string, sealed: Blob, progress?: (done: number) => void) =>
				opener.open(key, id, sealed, progress),
		};
		entry.work = openSealed(file, deps, (progress) => {
			if (this.#files.get(file.id) !== entry) return;
			entry.state = { status: "loading", progress };
			this.#changed();
		}).then(
			({ blob, type }) => this.#settled(file.id, entry, { status: "ready", url: this.#url(blob), type, blob }),
			(error: unknown) => {
				const reason = error instanceof FileError ? error.reason : "open";
				return this.#settled(file.id, entry, { status: "failed", reason });
			},
		);
		return entry.work;
	}

	/** Every file of a message goes, its URL revoked: the message was deleted. */
	forgetMessage(message: string) {
		let any = false;
		for (const [id, entry] of this.#files) {
			if (entry.message !== message) continue;
			this.#release(entry);
			this.#files.delete(id);
			any = true;
		}
		if (any) this.#changed();
	}

	/** The bytes of a decrypted file this memory holds, by the URL it made of them: Copy image's. */
	blobOf(url: string): Blob | null {
		for (const { state } of this.#files.values()) if (state.status === "ready" && state.url === url) return state.blob;
		return null;
	}

	/** A file's work ended: kept, unless it was let go of meanwhile; a file kept past the limit lets others go. */
	#settled(id: string, entry: Entry, state: FileState): FileState {
		entry.work = null;
		if (this.#files.get(id) !== entry) {
			if (state.status === "ready") this.#revoke(state.url);
			return state;
		}
		entry.state = state;
		if (state.status === "ready") {
			this.#used += state.blob.size;
			this.#makeRoom(id);
		}
		this.#changed();
		return state;
	}

	/** Past the limit, the files drawn longest ago go, but `keep`, which just came. */
	#makeRoom(keep: string) {
		while (this.#used > this.#limit) {
			let oldest: Entry | null = null;
			for (const [id, entry] of this.#files) {
				if (id === keep || entry.state.status !== "ready") continue;
				if (!oldest || entry.used < oldest.used) oldest = entry;
			}
			if (!oldest) return;
			this.#release(oldest);
			oldest.state = { status: "gone" };
		}
	}

	#release(entry: Entry) {
		if (entry.state.status !== "ready") return;
		this.#revoke(entry.state.url);
		this.#used -= entry.state.blob.size;
	}
}

/** The page's decrypted files: lib/e2e/engine.svelte.ts gives them their opener as the engine starts. */
export const decryptedFiles = new DecryptedFiles();

// How the names of the files whose messages this device holds are had: the page's engine, which gives it as it starts.
// Settings asks here, which a window of its own loads without the engine and its gateway connection.
let namer: (() => Promise<Map<string, string>>) | null = null;

/** What names the files from now on; none when the engine stopped. */
export function useNamer(given: typeof namer) {
	namer = given;
}

/** The names of the files whose messages this device holds, by their IDs (Ruling 31): Settings → Attachments'. */
export function encryptedFileNames(): Promise<Map<string, string>> {
	return namer ? namer() : Promise.reject(new Error("encrypted conversations aren't open in this window"));
}

/** A decrypted file as it's saved: bytes, never what they are, so nothing opens it after (Review Focus 6). */
export const downloadable = (blob: Blob) => new Blob([blob], { type: "application/octet-stream" });

/** Saves a decrypted file under its name, as bytes, through a download link: never a page, a tab or a window. */
export function saveFile(blob: Blob, name: string) {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(downloadable(blob));
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
