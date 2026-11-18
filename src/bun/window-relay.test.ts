import { describe, expect, spyOn, test } from "bun:test";
import { WindowRelay, type WindowCommand, type WindowStateMessage } from "./window-relay";

const state = (seq: number, value: unknown, channel = "media", epoch = 1000): WindowStateMessage => ({
	channel,
	epoch,
	seq,
	sentAt: epoch + seq,
	value,
});

/** A window that mirrors every channel. */
const every = () => true;

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
		relay.add(2, popout.send, every);
		relay.add(3, settings.send, every);
		relay.stateFromMain(state(1, { muted: false }));
		relay.stateFromMain(state(2, { muted: true }));
		expect(popout.got.map((m) => m.seq)).toEqual([1, 2]);
		expect(settings.got).toEqual(popout.got);
	});

	// The spike's measure: a burst arrives whole and in order (PLATFORM.md §4).
	test("a burst of 5,000 arrives whole and in order", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		relay.add(2, popout.send, every);
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
		relay.add(2, popout.send, every);
		expect(popout.got).toEqual([state(2, { muted: true }), state(1, { section: "audio" }, "settings")]);
	});

	test("a state that isn't newer than its channel's latest goes nowhere", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		relay.add(2, popout.send, every);
		relay.stateFromMain(state(2, "b"));
		relay.stateFromMain(state(1, "a"));
		relay.stateFromMain(state(2, "b"));
		expect(popout.got).toEqual([state(2, "b")]);
	});

	test("a reloaded main window's states are taken, though their numbers start over", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		relay.add(2, popout.send, every);
		relay.stateFromMain(state(40, "before"));
		relay.stateFromMain(state(1, "after", "media", 2000));
		expect(popout.got.map((m) => m.value)).toEqual(["before", "after"]);
	});

	test("a closed window gets nothing more", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		relay.add(2, popout.send, every);
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
			relay.add(
				2,
				() => {
					throw new Error("the window is gone");
				},
				every,
			);
			relay.add(3, settings.send, every);
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

// C-09 of the redesign's review: every state went to every window, so the media controls' pop-out held the storage
// buckets' keys and a Space's bans, and the Settings windows the call's state.
describe("a window's channels", () => {
	const sync = (key: string, seq: number, epoch = 1000) => state(seq, key, `sync:${key}`, epoch);

	test("a window is sent the channels it mirrors, and no other", () => {
		const relay = new WindowRelay();
		const popout = mirror();
		const settings = mirror();
		relay.add(2, popout.send, (channel) => channel === "media");
		relay.add(3, settings.send, (channel) => channel.startsWith("sync:"));
		relay.stateFromMain(state(1, { muted: true }));
		relay.stateFromMain(sync("buckets", 1));
		relay.stateFromMain(state(1, { open: true, shown: 0 }, "media-window"));
		expect(popout.got.map((m) => m.channel)).toEqual(["media"]);
		expect(settings.got.map((m) => m.channel)).toEqual(["sync:buckets"]);
	});

	test("a window that opens later gets the latest of its own channels only", () => {
		const relay = new WindowRelay();
		relay.stateFromMain(state(1, { muted: true }));
		relay.stateFromMain(sync("user", 1));
		relay.stateFromMain(sync("space:42", 1));
		const popout = mirror();
		relay.add(2, popout.send, (channel) => channel === "media");
		expect(popout.got).toEqual([state(1, { muted: true })]);
	});
});

// C-09: the latest state of each channel was kept for as long as the app ran, so after a sign-out and a sign-in as
// someone else a new Settings window was handed the account before's Space and its bans.
describe("what is kept for a window that opens later", () => {
	const sync = (key: string, seq: number, epoch: number) => state(seq, key, `sync:${key}`, epoch);

	test("is one page's: a later page's first state lets go of everything the page before published", () => {
		const relay = new WindowRelay();
		relay.stateFromMain(sync("user", 1, 1000));
		relay.stateFromMain(sync("space:42", 1, 1000));
		relay.stateFromMain(sync("bans:42", 1, 1000));
		expect(relay.kept).toBe(3);
		// The next account's page publishes its user, and never opens Space 42.
		relay.stateFromMain(sync("user", 1, 2000));
		expect(relay.kept).toBe(1);
		const settings = mirror();
		relay.add(3, settings.send, every);
		expect(settings.got).toEqual([sync("user", 1, 2000)]);
	});

	test("a page that started on an earlier clock is still the later page", () => {
		const relay = new WindowRelay();
		relay.stateFromMain(sync("user", 7, 2000));
		relay.stateFromMain(sync("space:42", 1, 2000));
		// The computer's clock was set back before the page loaded again.
		relay.stateFromMain(sync("user", 1, 1500));
		const settings = mirror();
		relay.add(3, settings.send, every);
		expect(settings.got).toEqual([sync("user", 1, 1500)]);
	});

	test("is let go of when the main window's page leaves the app, or the window closes", () => {
		const relay = new WindowRelay();
		relay.stateFromMain(sync("user", 1, 1000));
		relay.stateFromMain(sync("buckets", 1, 1000));
		relay.reset();
		expect(relay.kept).toBe(0);
		const settings = mirror();
		relay.add(3, settings.send, every);
		expect(settings.got).toEqual([]);
		// The same page's states are taken again afterwards (a page that left and came back by its history).
		relay.stateFromMain(sync("user", 2, 1000));
		expect(settings.got).toEqual([sync("user", 2, 1000)]);
	});

	test("doesn't grow with every Space ever opened across sessions", () => {
		const relay = new WindowRelay();
		for (let session = 1; session <= 50; session++) {
			relay.stateFromMain(sync("user", 1, session * 1000));
			relay.stateFromMain(sync(`space:${session}`, 1, session * 1000));
			relay.stateFromMain(sync(`bans:${session}`, 1, session * 1000));
		}
		expect(relay.kept).toBe(3);
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
