import { describe, expect, spyOn, test } from "bun:test";
import { WindowRelay, type WindowCommand, type WindowStateMessage } from "./window-relay";

const state = (seq: number, value: unknown, channel = "media", epoch = 1000): WindowStateMessage => ({
	channel,
	epoch,
	seq,
	sentAt: epoch + seq,
	value,
});

/** A second window's page, as the relay sends to it. */
function mirror() {
	const got: WindowStateMessage[] = [];
	return { got, send: (message: WindowStateMessage) => void got.push(message) };
}

describe("the main window's states", () => {
	test("go to every other window, in the order they came", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		const settings = mirror();
		relay.add(2, popout.send);
		relay.add(3, settings.send);
		relay.stateFromMain(state(1, { muted: false }));
		relay.stateFromMain(state(2, { muted: true }));
		expect(popout.got.map((m) => m.seq)).toEqual([1, 2]);
		expect(settings.got).toEqual(popout.got);
	});

	// The spike's measure: a burst arrives whole and in order (PLATFORM.md §4).
	test("a burst of 5,000 arrives whole and in order", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		relay.add(2, popout.send);
		for (let seq = 1; seq <= 5000; seq++) relay.stateFromMain(state(seq, seq));
		expect(popout.got).toHaveLength(5000);
		expect(popout.got.every((message, index) => message.seq === index + 1)).toBe(true);
	});

	test("a window that opens later gets each channel's latest at once", () => {
		const relay = new WindowRelay();
		relay.stateFromMain(state(1, { muted: false }));
		relay.stateFromMain(state(2, { muted: true }));
		relay.stateFromMain(state(1, { section: "audio" }, "settings"));
		const popout = mirror();
		relay.add(2, popout.send);
		expect(popout.got).toEqual([state(2, { muted: true }), state(1, { section: "audio" }, "settings")]);
	});

	test("a state that isn't newer than its channel's latest goes nowhere", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		relay.add(2, popout.send);
		relay.stateFromMain(state(2, "b"));
		relay.stateFromMain(state(1, "a"));
		relay.stateFromMain(state(2, "b"));
		expect(popout.got).toEqual([state(2, "b")]);
	});

	test("a reloaded main window's states are taken, though their numbers start over", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		relay.add(2, popout.send);
		relay.stateFromMain(state(40, "before"));
		relay.stateFromMain(state(1, "after", "media", 2000));
		expect(popout.got.map((m) => m.value)).toEqual(["before", "after"]);
	});

	test("a closed window gets nothing more", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		relay.add(2, popout.send);
		relay.remove(2);
		relay.stateFromMain(state(1, "a"));
		expect(popout.got).toEqual([]);
		expect(relay.mirrors).toBe(0);
	});

	test("a window that can't be sent to is dropped, and the others still get theirs", () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const relay = new WindowRelay();
			const settings = mirror();
			relay.add(2, () => {
				throw new Error("the window is gone");
			});
			relay.add(3, settings.send);
			relay.stateFromMain(state(1, "a"));
			relay.stateFromMain(state(2, "b"));
			expect(settings.got.map((m) => m.seq)).toEqual([1, 2]);
			expect(relay.mirrors).toBe(1);
			expect(logged).toHaveBeenCalledTimes(1);
		} finally {
			logged.mockRestore();
		}
	});
});

describe("another window's commands", () => {
	const command: WindowCommand = { channel: "media", name: "toggleMute" };

	test("go to the main window's page, whose answer comes back", async () => {
		const relay = new WindowRelay();
		const asked: WindowCommand[] = [];
		relay.setMain(async (asking) => {
			asked.push(asking);
			return { ok: true, result: { muted: true } };
		});
		expect(await relay.commandFromWindow(command)).toEqual({ ok: true, result: { muted: true } });
		expect(asked).toEqual([command]);
	});

	test("say so when there's no main window", async () => {
		const relay = new WindowRelay();
		expect(await relay.commandFromWindow(command)).toEqual({ ok: false, error: "The main window is closed" });
		relay.setMain(async () => ({ ok: true, result: null }));
		relay.setMain(null);
		expect(await relay.commandFromWindow(command)).toEqual({ ok: false, error: "The main window is closed" });
	});

	// The page didn't answer in time, or its RPC failed: the asking window gets an answer all the same.
	test("answer with the failure when the main window's page doesn't", async () => {
		const relay = new WindowRelay();
		relay.setMain(async () => {
			throw new Error("RPC request timed out.");
		});
		expect(await relay.commandFromWindow(command)).toEqual({ ok: false, error: "RPC request timed out." });
	});
});
