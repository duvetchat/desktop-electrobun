import { describe, expect, test } from "bun:test";
import { writable } from "svelte/store";
import { SyncGuest, SyncHost, watchSpace, type Shared } from "$lib/window-sync";

/** A value with listeners, as a store is. */
function cell<Value>(initial: Value): Shared<Value> & { value: Value; sets: number } {
	const listeners = new Set<() => void>();
	const self = {
		value: initial,
		sets: 0,
		get: () => self.value,
		set(value: Value) {
			self.value = value;
			self.sets++;
			for (const listener of [...listeners]) listener();
		},
		watch(changed: () => void) {
			listeners.add(changed);
			return () => listeners.delete(changed);
		},
	};
	return self;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the main window's side", () => {
	test("publishes a value as it is shared, then each time it changes to something else", () => {
		const sent: [string, unknown][] = [];
		const host = new SyncHost((key, value) => sent.push([key, value]));
		const theme = cell("dark");
		host.share("theme", theme);
		theme.set("light");
		theme.set("light");
		expect(sent).toEqual([
			["theme", "dark"],
			["theme", "light"],
		]);
	});

	test("publishes a copy, never the value's own object", () => {
		const sent: unknown[] = [];
		const host = new SyncHost((_key, value) => sent.push(value));
		const user = cell({ id: "u1", name: "Tamsin" });
		host.share("user", user);
		expect(sent[0]).toEqual(user.value);
		expect(sent[0]).not.toBe(user.value);
	});

	test("a window's write sets the value and reaches every window as the main window made it", () => {
		const sent: [string, unknown][] = [];
		const host = new SyncHost((key, value) => sent.push([key, value]));
		// The main window keeps only what it can read.
		const theme = cell("dark");
		const parsed: Shared<string> = { ...theme, set: (value) => theme.set(value === "light" ? "light" : "dark") };
		host.share("theme", parsed);
		expect(host.write("theme", "light")).toBe(true);
		expect(host.write("theme", "sepia")).toBe(true);
		expect(theme.value).toBe("dark");
		expect(sent).toEqual([
			["theme", "dark"],
			["theme", "light"],
			["theme", "dark"],
		]);
	});

	test("refuses a write of a key nothing shares", () => {
		const host = new SyncHost(() => {});
		expect(host.write("nothing", 1)).toBe(false);
	});

	test("gathers a busy value's changes into one, of its last state", async () => {
		const sent: unknown[] = [];
		const host = new SyncHost((_key, value) => sent.push(value));
		const space = cell({ members: 1 });
		host.share("space", space, { throttleMs: 5 });
		for (let members = 2; members <= 50; members++) space.set({ members });
		expect(sent).toEqual([{ members: 1 }]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(sent).toEqual([{ members: 1 }, { members: 50 }]);
	});

	test("what stops a share publishes nothing in its place, and stops watching", () => {
		const sent: [string, unknown][] = [];
		const host = new SyncHost((key, value) => sent.push([key, value]));
		const space = cell({ id: "s1" });
		const stop = host.share("space:s1", space);
		stop();
		space.set({ id: "s1-again" });
		expect(sent).toEqual([
			["space:s1", { id: "s1" }],
			["space:s1", null],
		]);
		expect(host.shares("space:s1")).toBe(false);
	});
});

describe("a window's side", () => {
	test("mirrors the main window's value, and says once it has it", () => {
		const guest = new SyncGuest(() => Promise.resolve());
		const user = cell<{ id: string } | null>(null);
		guest.mirror("user", user);
		expect(guest.has("user")).toBe(false);
		guest.accept("user", { id: "u1" });
		expect(user.value).toEqual({ id: "u1" });
		expect(guest.has("user")).toBe(true);
	});

	test("takes a value that arrived before anything mirrored its key", () => {
		const guest = new SyncGuest(() => Promise.resolve());
		guest.accept("theme", "light");
		const theme = cell("dark");
		guest.mirror("theme", theme);
		expect(theme.value).toBe("light");
	});

	test("sends what the window changes, and not what the main window told it", () => {
		const sent: [string, unknown][] = [];
		const guest = new SyncGuest((key, value) => {
			sent.push([key, value]);
			return Promise.resolve();
		});
		const theme = cell("dark");
		guest.mirror("theme", theme);
		guest.accept("theme", "dark");
		guest.accept("theme", "light");
		expect(sent).toEqual([]);
		theme.set("dark");
		expect(sent).toEqual([["theme", "dark"]]);
	});

	test("doesn't set its value again for the echo of its own write", async () => {
		const guest = new SyncGuest(() => Promise.resolve());
		const theme = cell("dark");
		guest.mirror("theme", theme);
		guest.accept("theme", "dark");
		theme.set("light");
		const sets = theme.sets;
		await tick();
		guest.accept("theme", "light");
		expect(theme.sets).toBe(sets);
	});

	// Two writes in a row: the echo of the first arrives while the second is on its way, and mustn't put the first back.
	test("an older echo doesn't undo a newer write on its way", async () => {
		const answers: (() => void)[] = [];
		const guest = new SyncGuest(() => new Promise<void>((resolve) => answers.push(resolve)));
		const list = cell<string[]>([]);
		guest.mirror("bans", list);
		guest.accept("bans", []);
		list.set(["a"]);
		list.set(["a", "b"]);
		guest.accept("bans", ["a"]);
		expect(list.value).toEqual(["a", "b"]);
		answers[0]!();
		await tick();
		expect(list.value).toEqual(["a", "b"]);
		guest.accept("bans", ["a", "b"]);
		answers[1]!();
		await tick();
		expect(list.value).toEqual(["a", "b"]);
	});

	// The main window had the last word: what it made of a write (a live event it merged in) wins once the write is answered.
	test("ends on the main window's last word once its writes are answered", async () => {
		const answers: (() => void)[] = [];
		const guest = new SyncGuest(() => new Promise<void>((resolve) => answers.push(resolve)));
		const list = cell<string[]>([]);
		guest.mirror("bans", list);
		guest.accept("bans", []);
		list.set(["a"]);
		guest.accept("bans", ["a", "live"]);
		expect(list.value).toEqual(["a"]);
		answers[0]!();
		await tick();
		expect(list.value).toEqual(["a", "live"]);
	});

	test("a refused write still ends on the main window's word", async () => {
		const guest = new SyncGuest(() => Promise.reject(new Error("The main window is closed")));
		const theme = cell("dark");
		guest.mirror("theme", theme);
		guest.accept("theme", "dark");
		theme.set("light");
		guest.accept("theme", "dark");
		await tick();
		expect(theme.value).toBe("dark");
	});

	test("never writes back a value it only reads", () => {
		const sent: unknown[] = [];
		const guest = new SyncGuest((_key, value) => {
			sent.push(value);
			return Promise.resolve();
		});
		const user = cell<{ name: string } | null>(null);
		guest.mirror("user", user, { readOnly: true });
		guest.accept("user", { name: "Tamsin" });
		user.set({ name: "Changed here" });
		expect(sent).toEqual([]);
		guest.accept("user", { name: "Tamsin Hale" });
		expect(user.value).toEqual({ name: "Tamsin Hale" });
	});
});

test("two windows and the main one end up agreeing", async () => {
	const guests: SyncGuest[] = [];
	const host = new SyncHost((key, value) => {
		for (const guest of guests) guest.accept(key, value);
	});
	const main = cell("dark");
	const first = cell("?");
	const second = cell("?");
	for (const value of [first, second]) {
		const guest = new SyncGuest((key, written) => Promise.resolve(host.write(key, written)));
		guest.mirror("theme", value);
		guests.push(guest);
	}
	host.share("theme", main);
	expect([first.value, second.value]).toEqual(["dark", "dark"]);
	second.set("light");
	await tick();
	expect([main.value, first.value, second.value]).toEqual(["light", "light", "light"]);
	main.set("system");
	expect([first.value, second.value]).toEqual(["system", "system"]);
});

describe("watching one Space of the store", () => {
	test("calls back for that Space's changes, its coming and its going, and for no other Space's", () => {
		const a = { id: "a", name: "A" };
		const b = { id: "b", name: "B" };
		const spaces = writable([a, b]);
		let calls = 0;
		const stop = watchSpace(spaces, "a", () => calls++);
		expect(calls).toBe(1); // as it starts, like a store's own subscribe
		spaces.set([a, { ...b, name: "B2" }]);
		spaces.set([a, { ...b, name: "B3" }, { id: "c", name: "C" }]);
		expect(calls).toBe(1);
		spaces.set([{ ...a, name: "A2" }, b]);
		expect(calls).toBe(2);
		spaces.set([b]);
		expect(calls).toBe(3);
		spaces.set([]);
		expect(calls).toBe(3);
		spaces.set([a]);
		expect(calls).toBe(4);
		stop();
		spaces.set([{ ...a }]);
		expect(calls).toBe(4);
	});
});
