import { describe, expect, test } from "bun:test";

// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { TabCoordinator } = await import("./tab-notifications");

// A browser's BroadcastChannel: a message reaches every other channel of the name, never its sender.
class Bus {
	channels: FakeChannel[] = [];
}
class FakeChannel {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	constructor(private readonly bus: Bus) {
		bus.channels.push(this);
	}
	postMessage(data: unknown) {
		for (const other of this.bus.channels) if (other !== this) queueMicrotask(() => other.onmessage?.({ data }));
	}
	close() {
		this.bus.channels = this.bus.channels.filter((c) => c !== this);
	}
}

// Web Locks: the first tab to ask holds the lock; the next gets it once it's let go.
class FakeLocks {
	#held = false;
	#waiting: (() => void)[] = [];
	request(_name: string, callback: () => Promise<void>): Promise<void> {
		return new Promise((done) => {
			const run = () => {
				this.#held = true;
				void callback().then(() => {
					this.#held = false;
					done();
					this.#waiting.shift()?.();
				});
			};
			if (this.#held) this.#waiting.push(run);
			else run();
		});
	}
}

const settle = () => Bun.sleep(5);

function tabs() {
	const bus = new Bus();
	const locks = new FakeLocks();
	const tab = (id: string) => {
		let focused = false;
		const coordinator = new TabCoordinator({ locks, channel: new FakeChannel(bus), id, focused: () => focused });
		return {
			coordinator,
			focus(on: boolean) {
				focused = on;
				coordinator.focusChanged();
			},
		};
	};
	return { first: tab("first"), second: tab("second") };
}

// One browser's tabs each hear every message: one of them notifies (DISENO-NOTIFICACIONES.md, section 7).
describe("a browser's tabs", () => {
	test("with none focused, only the one holding the lock notifies", async () => {
		const { first, second } = tabs();
		await settle();
		expect(first.coordinator.acts()).toBe(true);
		expect(second.coordinator.acts()).toBe(false);
	});

	test("a focused tab notifies, and the one holding the lock holds back", async () => {
		const { first, second } = tabs();
		second.focus(true);
		await settle();
		expect(second.coordinator.acts()).toBe(true);
		expect(first.coordinator.acts()).toBe(false);
		second.focus(false);
		await settle();
		expect(first.coordinator.acts()).toBe(true);
	});

	test("a tab opened after a focused one learns its focus", async () => {
		const bus = new Bus();
		const focused = new TabCoordinator({
			locks: new FakeLocks(),
			channel: new FakeChannel(bus),
			id: "focused",
			focused: () => true,
		});
		// A lock of its own: it would notify, but for the focus it learns from the answer to its hello.
		const later = new TabCoordinator({
			locks: new FakeLocks(),
			channel: new FakeChannel(bus),
			id: "later",
			focused: () => false,
		});
		await settle();
		expect(later.acts()).toBe(false);
		expect(focused.acts()).toBe(true);
	});

	test("when the one holding the lock closes, another takes over", async () => {
		const { first, second } = tabs();
		await settle();
		first.coordinator.close();
		await settle();
		expect(second.coordinator.acts()).toBe(true);
	});
});
