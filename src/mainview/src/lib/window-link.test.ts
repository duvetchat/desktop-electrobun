import { describe, expect, test } from "bun:test";
import { answerCommand, isNewer, StateMirror, StatePublisher, type WindowStateMessage } from "$lib/window-link";

const clock = (start: number) => {
	let now = start;
	return () => now++;
};

describe("the main window's state stream", () => {
	test("numbers each channel's states from 1, in the page's epoch", () => {
		const sent: WindowStateMessage[] = [];
		const publisher = new StatePublisher((message) => sent.push(message), clock(1000));
		publisher.publish("media", { muted: false });
		publisher.publish("media", { muted: true });
		publisher.publish("settings", { section: "audio" });
		expect(sent).toEqual([
			{ channel: "media", epoch: 1000, seq: 1, sentAt: 1001, value: { muted: false } },
			{ channel: "media", epoch: 1000, seq: 2, sentAt: 1002, value: { muted: true } },
			{ channel: "settings", epoch: 1000, seq: 1, sentAt: 1003, value: { section: "audio" } },
		]);
	});
});

describe("another window's mirror", () => {
	const state = (seq: number, value: unknown, epoch = 1000, channel = "media"): WindowStateMessage => ({
		channel,
		epoch,
		seq,
		sentAt: epoch + seq,
		value,
	});

	test("holds the latest state of its channel and tells its listeners each one", () => {
		const mirror = new StateMirror<{ muted: boolean }>("media");
		const seen: boolean[] = [];
		expect(mirror.latest).toBeUndefined();
		mirror.subscribe((value) => seen.push(value.muted));
		expect(mirror.accept(state(1, { muted: false }))).toBe(true);
		expect(mirror.accept(state(2, { muted: true }))).toBe(true);
		expect(mirror.latest).toEqual({ muted: true });
		expect(seen).toEqual([false, true]);
	});

	test("ignores another channel's states", () => {
		const mirror = new StateMirror<unknown>("media");
		expect(mirror.accept(state(1, { section: "audio" }, 1000, "settings"))).toBe(false);
		expect(mirror.latest).toBeUndefined();
		expect(mirror.dropped).toBe(0);
	});

	// The relay was measured in order; if it ever isn't, the older state must not win.
	test("drops a state that arrives behind a newer one, and counts it", () => {
		const mirror = new StateMirror<{ muted: boolean }>("media");
		mirror.accept(state(1, { muted: false }));
		mirror.accept(state(3, { muted: true }));
		expect(mirror.accept(state(2, { muted: false }))).toBe(false);
		expect(mirror.accept(state(3, { muted: true }))).toBe(false);
		expect(mirror.latest).toEqual({ muted: true });
		expect(mirror.dropped).toBe(2);
	});

	// The main window's page reloaded: its numbers start over, in a later epoch.
	test("takes a reloaded main window's states, whose numbers start over", () => {
		const mirror = new StateMirror<{ muted: boolean }>("media");
		mirror.accept(state(40, { muted: true }, 1000));
		expect(mirror.accept(state(1, { muted: false }, 2000))).toBe(true);
		expect(mirror.latest).toEqual({ muted: false });
		// And nothing more of the page before it.
		expect(mirror.accept(state(41, { muted: true }, 1000))).toBe(false);
	});

	test("a new listener gets the latest at once, and none after it stops", () => {
		const mirror = new StateMirror<number>("media");
		mirror.accept(state(1, 7));
		const seen: number[] = [];
		const stop = mirror.subscribe((value) => seen.push(value));
		expect(seen).toEqual([7]);
		stop();
		mirror.accept(state(2, 8));
		expect(seen).toEqual([7]);
	});

	test("the order is the epoch's, then the number's", () => {
		expect(isNewer(state(1, null), null)).toBe(true);
		expect(isNewer(state(2, null), state(1, null))).toBe(true);
		expect(isNewer(state(1, null), state(1, null))).toBe(false);
		expect(isNewer(state(1, null, 2000), state(9, null, 1000))).toBe(true);
		expect(isNewer(state(9, null, 1000), state(1, null, 2000))).toBe(false);
	});
});

describe("the main window's answers to commands", () => {
	let muted = false;
	const handlers = {
		media: {
			toggleMute: () => (muted = !muted),
			setMic: (args: unknown) => `mic ${String(args)}`,
			later: async () => "done",
			fail: () => {
				throw new Error("No microphone");
			},
			nothing: () => undefined,
		},
	};

	test("run the named handler with its arguments and answer with its result", async () => {
		expect(await answerCommand(handlers, { channel: "media", name: "toggleMute" })).toEqual({ ok: true, result: true });
		expect(await answerCommand(handlers, { channel: "media", name: "setMic", args: "default" })).toEqual({
			ok: true,
			result: "mic default",
		});
		expect(await answerCommand(handlers, { channel: "media", name: "later" })).toEqual({ ok: true, result: "done" });
	});

	test("a handler that returns nothing answers null: undefined doesn't cross the RPC", async () => {
		expect(await answerCommand(handlers, { channel: "media", name: "nothing" })).toEqual({ ok: true, result: null });
	});

	test("say why not: no such command, or what it threw", async () => {
		expect(await answerCommand(handlers, { channel: "media", name: "hangUp" })).toEqual({
			ok: false,
			error: "No command media.hangUp",
		});
		expect(await answerCommand(handlers, { channel: "settings", name: "open" })).toEqual({
			ok: false,
			error: "No command settings.open",
		});
		expect(await answerCommand(handlers, { channel: "media", name: "fail" })).toEqual({
			ok: false,
			error: "No microphone",
		});
	});

	// A command's name comes from another page: it names a handler, never something an object inherits.
	test("never run what the handlers only inherit", async () => {
		expect(await answerCommand(handlers, { channel: "media", name: "constructor" })).toEqual({
			ok: false,
			error: "No command media.constructor",
		});
		expect(await answerCommand(handlers, { channel: "__proto__", name: "toString" })).toEqual({
			ok: false,
			error: "No command __proto__.toString",
		});
	});
});
