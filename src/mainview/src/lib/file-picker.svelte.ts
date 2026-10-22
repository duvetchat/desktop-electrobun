import { SvelteSet } from "svelte/reactivity";
import {
	FILE_KINDS,
	fileKind,
	shownFiles,
	transferFilter,
	type FileKind,
	type PickableFile,
} from "$lib/storage-transfers";

/** Which files of a storage's list are picked to move: their checkboxes, "Select all" and the kind filters. */
export class FilePicker<T extends PickableFile> {
	/** The kind filters that are on; with none, every file shows. */
	kinds = $state<FileKind[]>([]);
	picked = new SvelteSet<string>();
	#files: () => T[];

	/** `files` reads the list as it is now. */
	constructor(files: () => T[]) {
		this.#files = files;
	}

	/** The files the kind filters show. */
	shown = $derived.by(() => shownFiles(this.#files(), this.kinds));
	/** The picked files, in list order. */
	pickedFiles = $derived.by(() => this.#files().filter((f) => this.picked.has(f.id)));
	pickedBytes = $derived.by(() => this.pickedFiles.reduce((sum, f) => sum + f.size_bytes, 0));
	allShownPicked = $derived.by(() => this.shown.length > 0 && this.shown.every((f) => this.picked.has(f.id)));
	someShownPicked = $derived.by(() => !this.allShownPicked && this.shown.some((f) => this.picked.has(f.id)));
	/** How a transfer takes the picked files from the source. */
	filter = $derived.by(() => transferFilter(this.#files(), this.kinds, this.picked));
	/** How many files of each kind the list has. */
	kindCounts = $derived.by(() => {
		const counts: Record<FileKind, number> = { image: 0, video: 0, audio: 0, other: 0 };
		for (const f of this.#files()) counts[fileKind(f.content_type)]++;
		return counts;
	});

	toggle(id: string) {
		if (this.picked.has(id)) this.picked.delete(id);
		else this.picked.add(id);
	}

	/** Picks every file shown, or none of them when they all are. */
	toggleAll() {
		const unpick = this.allShownPicked;
		for (const f of this.shown) {
			if (unpick) this.picked.delete(f.id);
			else this.picked.add(f.id);
		}
	}

	/** Turns a kind filter on or off. The files it hides are unpicked. */
	toggleKind(kind: FileKind) {
		const on = !this.kinds.includes(kind);
		this.kinds = FILE_KINDS.filter((k) => (k === kind ? on : this.kinds.includes(k)));
		this.prune();
	}

	/** Unpicks the files the list doesn't show (any more). */
	prune() {
		const shown = new Set(this.shown.map((f) => f.id));
		for (const id of [...this.picked]) if (!shown.has(id)) this.picked.delete(id);
	}

	/** Unpicks everything and turns the kind filters off. */
	clear() {
		this.kinds = [];
		this.picked.clear();
	}
}
