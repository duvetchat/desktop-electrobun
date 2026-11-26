// What this device decrypted of conversations' files (PLAN-E2E-CLIENTES.md, «Adjuntos»; Ruling 19): in memory alone,
// MAX_DECRYPTED of it, the file drawn longest ago let go of first, and every file of a message as the message is
// deleted, each one's URL revoked as it goes. A file is downloaded from its signed URL, opened by the core and checked
// (engine/files.ts' openSealed) once, whoever asks: two panes showing a message share it. A file is what its message
// says of it, its ID with its key, SHA-256 and size, never its ID alone: any member can write another's ID in an
// envelope, and one message never shows or blocks another's file (task 18's review, I1). Four come down at once, within
// 64 MiB of sealed bytes, a click's first (I5). One let go of for room isn't fetched again by itself, as the view still
// showing it would fetch it in turn and let another go: a click does, and so does it after a download that failed,
// which is never final (I4).
// Reads are reactive (createSubscriber, as conversation-content.svelte.ts's), so what draws a file draws it again as it
// changes. No rune: Bun's tests load it as it is.
import { createSubscriber } from "svelte/reactivity";
import { FileError, openSealed, sealedSize, type FileFailure, type FileRef } from "./engine/files";

/** How much decrypted memory holds: 256 MiB. */
export const MAX_DECRYPTED = 256 << 20;
/** How many files come down and open at once: each holds its sealed bytes about three times over while it does. */
export const OPENING_MOST = 4;
/**
 * How many sealed bytes come down at once, beside the count, as the Android app holds them: four of a bucket's large
 * files would take hundreds of MB meanwhile (desktop-electrobun#544). A file past it comes down alone.
 */
export const OPENING_BYTES_MOST = 64 << 20;

/** Where a file is: on its way (how far, from 0 to 1), here (its URL, and its bytes' type), not shown (why), or let go
 * of for room. */
export type FileState =
	| { status: "loading"; progress: number }
	| { status: "ready"; url: string; type: string; blob: Blob }
	| { status: "failed"; reason: FileFailure }
	| { status: "gone" };

/** How a file's sealed bytes come down from a signed URL, how this device's core opens them, and what counts a file
 * that didn't open (decision 40). */
export interface Opener {
	download(url: string, most: number, progress?: (received: number) => void): Promise<Uint8Array>;
	open(key: string, id: string, sealed: Blob, progress?: (done: number) => void): Promise<Blob>;
	failed?(): void;
}

/** A file to open: what its message says of its bytes, and the API's signed URL of them (none when it names none). */
export type Openable = Pick<FileRef, "id" | "key" | "sha256" | "size"> & { url: string | null };

/** What a message says of its file whose ID the API doesn't list on it: for that message alone. */
const UNAVAILABLE: FileState = { status: "failed", reason: "unavailable" };
/** What no ask changes: other bytes than the message says, too many of them, or none the core opens. */
const FINAL = new Set<FileFailure>(["hash", "size", "open"]);

/** A file's place: its ID, with what its message says of its bytes. */
const placeOf = ({ id, key, sha256, size }: Openable) => `${id}:${key}:${sha256}:${size}`;

interface Entry {
	state: FileState;
	/** The messages that asked for it, which take it along as they're all deleted. */
	messages: Set<string>;
	/** When it was last drawn or asked for: the one drawn longest ago goes first. */
	used: number;
	work: Promise<FileState> | null;
	/** Its start, while it waits for one of the places that open files, and what takes it out of the queue. */
	begin: (() => void) | null;
	cancel: (() => void) | null;
	/** Its sealed bytes, as the budget of those in flight counts them: the budget at most. */
	bytes: number;
	/** The views that show it and asked for it by themselves; a click's ask holds its place whatever they do. */
	asking: number;
	clicked: boolean;
}

export class DecryptedFiles {
	readonly #files = new Map<string, Entry>();
	readonly #limit: number;
	readonly #inFlight: number;
	readonly #url: (blob: Blob) => string;
	readonly #revoke: (url: string) => void;
	#opener: Opener | null = null;
	#clock = 0;
	#used = 0;
	/** Files that come down and open now, and those that wait for a place, a click's first. */
	#opening = 0;
	#openingBytes = 0;
	readonly #waiting: Entry[] = [];
	#changed = () => {};
	readonly #track = createSubscriber((update) => {
		this.#changed = update;
		return () => (this.#changed = () => {});
	});

	constructor(
		limit = MAX_DECRYPTED,
		url = (blob: Blob) => URL.createObjectURL(blob),
		revoke = (made: string) => URL.revokeObjectURL(made),
		inFlight = OPENING_BYTES_MOST,
	) {
		this.#limit = limit;
		this.#inFlight = inFlight;
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
		this.#waiting.length = 0;
		this.#changed();
	}

	/**
	 * Where the file is: undefined while nobody asked for it, and unavailable when its message's API row doesn't name it.
	 * Reading it counts as drawing it.
	 */
	state(file: Openable): FileState | undefined {
		this.#track();
		if (!file.url) return UNAVAILABLE;
		const entry = this.#files.get(placeOf(file));
		if (entry) entry.used = ++this.#clock;
		return entry?.state;
	}

	/**
	 * The file of a message, downloaded, opened and checked, unless it's here or on its way: what it ends as. `auto` is a
	 * view's own ask as it shows, which doesn't fetch again a file let go of for room, or one whose download failed; a
	 * click does, and goes before the views' asks.
	 */
	open(file: Openable, message: string, { auto = false }: { auto?: boolean } = {}): Promise<FileState> {
		const { url } = file;
		const opener = this.#opener;
		// None for its message: its alone. No engine yet: asked again once there's one.
		if (!url || !opener) return Promise.resolve(UNAVAILABLE);
		const place = placeOf(file);
		const had = this.#files.get(place);
		had?.messages.add(message);
		if (had && auto) had.asking++;
		if (had?.work) {
			if (!auto) {
				had.clicked = true;
				this.#first(had);
			}
			return had.work;
		}
		const state = had?.state;
		const kept =
			state?.status === "ready" ||
			(state?.status === "failed" && (auto || FINAL.has(state.reason))) ||
			(auto && state?.status === "gone");
		if (had && state && kept) {
			had.used = ++this.#clock;
			return Promise.resolve(state);
		}
		const entry: Entry = {
			// Every message that asked for it before keeps it as well (task 18's re-review, N4).
			...{ state: { status: "loading", progress: 0 }, messages: new Set([...(had?.messages ?? []), message]) },
			...{ used: ++this.#clock, work: null, begin: null, cancel: null },
			bytes: Math.min(sealedSize(file.size), this.#inFlight),
			...{ asking: (had?.asking ?? 0) + (had || !auto ? 0 : 1), clicked: !auto },
		};
		this.#files.set(place, entry);
		this.#changed();
		const deps = {
			download: (most: number, progress?: (received: number) => void) => opener.download(url, most, progress),
			open: (key: string, id: string, sealed: Blob, progress?: (done: number) => void) =>
				opener.open(key, id, sealed, progress),
		};
		const opened = () =>
			openSealed(file, deps, (progress) => {
				if (this.#files.get(place) !== entry) return;
				entry.state = { status: "loading", progress };
				this.#changed();
			});
		entry.work = this.#inPlace(entry, opened, !auto).then(
			({ blob, type }) => this.#settled(place, entry, { status: "ready", url: this.#url(blob), type, blob }),
			(error: unknown) => {
				const reason = error instanceof FileError ? error.reason : "open";
				// Counted as decryption failures are: a file the core didn't open, or opened to other bytes.
				if (reason === "open" || reason === "hash") opener.failed?.();
				return this.#settled(place, entry, { status: "failed", reason });
			},
		);
		return entry.work;
	}

	/**
	 * Every file of a message goes, its URL revoked, once no other message that asked for it is left: it was deleted. One
	 * that still waits for its place goes from the queue (task 18's re-review, N3).
	 */
	forgetMessage(message: string) {
		let any = false;
		for (const [place, entry] of this.#files) {
			if (!entry.messages.delete(message) || entry.messages.size > 0) continue;
			this.#release(entry);
			this.#files.delete(place);
			entry.cancel?.();
			any = true;
		}
		if (any) this.#changed();
	}

	/**
	 * A view that asked for the file by itself no longer shows it: one that waits for its place, which no other view asks
	 * for and no click asked for, goes from the queue, so a fast scroll leaves nothing behind it (task 18's re-review, N3).
	 */
	letGo(file: Openable) {
		const place = placeOf(file);
		const entry = this.#files.get(place);
		if (!entry) return;
		entry.asking = Math.max(0, entry.asking - 1);
		if (entry.asking > 0 || entry.clicked || !entry.cancel) return;
		this.#files.delete(place);
		entry.cancel();
		this.#changed();
	}

	/** The bytes of a decrypted file this memory holds, by the URL it made of them: Copy image's. */
	blobOf(url: string): Blob | null {
		for (const { state } of this.#files.values()) if (state.status === "ready" && state.url === url) return state.blob;
		return null;
	}

	/**
	 * Its work once a place is free and its sealed bytes fit those in flight: at once, or after those before it, a
	 * click's before the views' asks.
	 */
	#inPlace<T>(entry: Entry, work: () => Promise<T>, first: boolean): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			entry.cancel = () => {
				const at = this.#waiting.indexOf(entry);
				if (at >= 0) this.#waiting.splice(at, 1);
				entry.begin = entry.cancel = null;
				// A download it never made: not a failure of its bytes, and nothing to count.
				reject(new FileError("download"));
				this.#next();
			};
			entry.begin = () => {
				entry.begin = entry.cancel = null;
				this.#opening++;
				this.#openingBytes += entry.bytes;
				work()
					.then(resolve, reject)
					.finally(() => {
						this.#opening--;
						this.#openingBytes -= entry.bytes;
						this.#next();
					});
			};
			if (first) this.#waiting.unshift(entry);
			else this.#waiting.push(entry);
			this.#next();
		});
	}

	/** The files that wait, in their order, while a place is free and their sealed bytes fit: one past them alone. */
	#next() {
		for (let next = this.#waiting[0]; next; next = this.#waiting[0]) {
			if (this.#opening >= OPENING_MOST) return;
			if (this.#opening > 0 && this.#openingBytes + next.bytes > this.#inFlight) return;
			this.#waiting.shift();
			next.begin?.();
		}
	}

	/** A click on a file that waits for its place: it goes before the views' asks. */
	#first(entry: Entry) {
		const at = this.#waiting.indexOf(entry);
		if (at <= 0) return;
		this.#waiting.splice(at, 1);
		this.#waiting.unshift(entry);
		this.#next();
	}

	/** A file's work ended: kept, unless it was let go of meanwhile; a file kept past the limit lets others go. */
	#settled(place: string, entry: Entry, state: FileState): FileState {
		entry.work = null;
		if (this.#files.get(place) !== entry) {
			if (state.status === "ready") this.#revoke(state.url);
			return state;
		}
		entry.state = state;
		if (state.status === "ready") {
			this.#used += state.blob.size;
			this.#makeRoom(place);
		}
		this.#changed();
		return state;
	}

	/** Past the limit, the files drawn longest ago go, but `keep`, which just came. */
	#makeRoom(keep: string) {
		while (this.#used > this.#limit) {
			let oldest: Entry | null = null;
			for (const [place, entry] of this.#files) {
				if (place === keep || entry.state.status !== "ready") continue;
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
