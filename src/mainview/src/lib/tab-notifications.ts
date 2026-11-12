import { get } from "svelte/store";
import { isElectrobunWindow } from "$lib/electrobun-rpc";
import { pageVisible } from "$lib/stores.svelte";

/** What a tab uses of Web Locks and of a BroadcastChannel; the tests hand fakes. */
interface Locks {
	request(name: string, callback: () => Promise<void>): Promise<unknown>;
}
interface Channel {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage(data: unknown): void;
	close(): void;
}
type Said = { type: "hello" | "focus"; id: string; focused: boolean } | { type: "bye"; id: string };

const NAME = "duvet-notifications";

// What another tab said, or null for anything else on the channel.
function heardFrom(data: unknown): Said | null {
	if (typeof data !== "object" || data === null || !("type" in data) || !("id" in data)) return null;
	if (typeof data.id !== "string") return null;
	if (data.type === "bye") return { type: "bye", id: data.id };
	if ((data.type === "hello" || data.type === "focus") && "focused" in data && typeof data.focused === "boolean") {
		return { type: data.type, id: data.id, focused: data.focused };
	}
	return null;
}

/**
 * Which of a browser's tabs notifies (DISENO-NOTIFICACIONES.md, section 7): each has a gateway connection of its own and
 * hears every message, so each would show its notification and play its sound. A focused tab acts on what it decides
 * (lib/notifications.ts); a tab without the focus acts only while no tab has it, and only the one holding the lock (Web
 * Locks): the first open, then the next in line when it closes. The tabs tell each other their focus over a
 * BroadcastChannel, and a tab that opens asks the others'.
 */
export class TabCoordinator {
	readonly #id: string;
	readonly #channel: Channel;
	readonly #focused: () => boolean;
	readonly #focusedElsewhere = new Set<string>();
	#leader = false;
	#letGo: (() => void) | null = null;

	constructor(tab: { locks: Locks; channel: Channel; id: string; focused: () => boolean }) {
		this.#id = tab.id;
		this.#channel = tab.channel;
		this.#focused = tab.focused;
		tab.channel.onmessage = (event) => {
			const said = heardFrom(event.data);
			if (said) this.#heard(said);
		};
		void tab.locks.request(
			NAME,
			() =>
				new Promise<void>((letGo) => {
					this.#leader = true;
					this.#letGo = letGo;
				}),
		);
		this.#say({ type: "hello", id: this.#id, focused: this.#focused() });
	}

	/** Whether this tab shows what notifies, and plays its sound. */
	acts(): boolean {
		return this.#focused() || (this.#leader && this.#focusedElsewhere.size === 0);
	}

	focusChanged() {
		this.#say({ type: "focus", id: this.#id, focused: this.#focused() });
	}

	/** The tab closes: the others forget its focus, and the lock goes to the next. */
	close() {
		this.#say({ type: "bye", id: this.#id });
		this.#leader = false;
		this.#letGo?.();
		this.#channel.close();
	}

	#heard(said: Said) {
		if (said.type === "bye") {
			this.#focusedElsewhere.delete(said.id);
			return;
		}
		if (said.focused) this.#focusedElsewhere.add(said.id);
		else this.#focusedElsewhere.delete(said.id);
		// A tab that just opened asks the others' focus.
		if (said.type === "hello") this.focusChanged();
	}

	#say(said: Said) {
		this.#channel.postMessage(said);
	}
}

let coordinator: TabCoordinator | null = null;

/**
 * This tab's part (TabCoordinator), in a browser with Web Locks and BroadcastChannel; in the desktop app (one window),
 * and without them, every tab acts. Returns what stops it.
 */
export function startTabCoordination(tab: { locks?: Locks; channel?: Channel; id?: string } = {}): () => void {
	if (coordinator || isElectrobunWindow()) return () => {};
	const locks = tab.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
	const channel = tab.channel ?? (typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(NAME));
	if (!locks || !channel) return () => {};
	const started = new TabCoordinator({
		locks,
		channel,
		id: tab.id ?? crypto.randomUUID(),
		focused: () => get(pageVisible),
	});
	coordinator = started;
	const unsubscribe = pageVisible.subscribe(() => started.focusChanged());
	const leave = () => started.close();
	if (typeof addEventListener === "function") addEventListener("pagehide", leave);
	return () => {
		unsubscribe();
		if (typeof removeEventListener === "function") removeEventListener("pagehide", leave);
		started.close();
		coordinator = null;
	};
}

/** Whether this tab shows what notifies and plays its sound (TabCoordinator): every tab does without coordination. */
export const tabActs = () => coordinator?.acts() ?? true;
