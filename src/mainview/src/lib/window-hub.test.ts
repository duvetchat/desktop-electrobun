import { expect, mock, test } from "bun:test";
import type { WindowAnswer, WindowCommand, WindowStateMessage } from "$lib/window-link";

// The page's end of what crosses between the app's windows (#357), against a fake of the app's RPC that isn't there
// yet when the page starts, as in the app: everything asked of it before it resolves has to wait for it.
type Answerer = (command: WindowCommand) => Promise<WindowAnswer>;
const rpc = {
	answerers: [] as Answerer[],
	sent: [] as WindowStateMessage[],
	stateListeners: [] as ((message: WindowStateMessage) => void)[],
	answer: { ok: true, result: null } as WindowAnswer,
	asked: [] as WindowCommand[],
	on: {
		windowCommand: (answerer: Answerer) => void rpc.answerers.push(answerer),
		windowState: (listener: (message: WindowStateMessage) => void) => void rpc.stateListeners.push(listener),
	},
	send: { windowState: (message: WindowStateMessage) => void rpc.sent.push(message) },
	request: {
		windowCommand: (command: WindowCommand) => {
			rpc.asked.push(command);
			return Promise.resolve(rpc.answer);
		},
	},
};
let arrive: (value: typeof rpc | null) => void = () => {};
let arriving = new Promise<typeof rpc | null>((resolve) => (arrive = resolve));
const shell = { window: "main" };
mock.module("$lib/electrobun-rpc", () => ({ getElectrobunRpc: () => arriving }));
mock.module("$lib/platform", () => ({ currentShell: () => shell }));
const { answerWindows, askMainWindow, onWindowStates, publishToWindows } = await import("./window-hub");

const state = (channel: string, epoch: number, seq: number, value: unknown): WindowStateMessage => ({
	channel,
	epoch,
	seq,
	sentAt: 0,
	value,
});

test("a window that isn't the main one answers nothing and publishes nothing", async () => {
	shell.window = "settings";
	answerWindows("hub-test", { ping: () => "pong" });
	publishToWindows("hub-test", "from a guest");
	shell.window = "main";
	arrive(rpc);
	await arriving;
	await Promise.resolve();
	expect(rpc.answerers).toEqual([]);
	expect(rpc.sent).toEqual([]);
	// Back to an RPC that hasn't arrived, for the tests of the main window.
	arriving = new Promise((resolve) => (arrive = resolve));
});

test("before the RPC is there, each channel's latest state waits, and the answerer is asked for once", async () => {
	answerWindows("hub-test", { open: () => "opened" });
	answerWindows("hub-test", { close: () => "closed" });
	answerWindows("hub-other", { ping: (args) => args });
	publishToWindows("hub-a", 1);
	publishToWindows("hub-a", 2);
	publishToWindows("hub-b", "only");
	expect(rpc.sent).toEqual([]);
	expect(rpc.answerers).toEqual([]);

	arrive(rpc);
	await arriving;
	await Promise.resolve();

	// One answerer for every channel, and it answers each channel's commands, the later ones beside the earlier.
	expect(rpc.answerers).toHaveLength(1);
	const answer = rpc.answerers[0]!;
	expect(await answer({ channel: "hub-test", name: "open" })).toEqual({ ok: true, result: "opened" });
	expect(await answer({ channel: "hub-test", name: "close" })).toEqual({ ok: true, result: "closed" });
	expect(await answer({ channel: "hub-other", name: "ping", args: 7 })).toEqual({ ok: true, result: 7 });
	expect((await answer({ channel: "hub-test", name: "nope" })).ok).toBe(false);

	// The states that waited: the last of each channel, not the ones it replaced, numbered as they were published.
	expect(rpc.sent.map((m) => [m.channel, m.seq, m.value])).toEqual([
		["hub-a", 2, 2],
		["hub-b", 1, "only"],
	]);
});

test("once the RPC is there, a state goes straight out, on the page's one epoch", () => {
	publishToWindows("hub-a", 3);
	publishToWindows("hub-c", "new");
	expect(rpc.sent.slice(2).map((m) => [m.channel, m.seq, m.value])).toEqual([
		["hub-a", 3, 3],
		["hub-c", 1, "new"],
	]);
	expect(new Set(rpc.sent.map((m) => m.epoch)).size).toBe(1);
});

test("a later part of the app adds its commands without a second answerer", async () => {
	answerWindows("hub-late", { hello: () => "hi" });
	await Promise.resolve();
	expect(rpc.answerers).toHaveLength(1);
	expect(await rpc.answerers[0]!({ channel: "hub-late", name: "hello" })).toEqual({ ok: true, result: "hi" });
});

test("another window hears each state once, and never one older than its channel's last", async () => {
	const heard: [string, unknown][] = [];
	expect(await onWindowStates((channel, value) => heard.push([channel, value]))).toBe(true);
	const deliver = rpc.stateListeners.at(-1)!;
	deliver(state("media", 100, 2, "second"));
	deliver(state("media", 100, 1, "first, late"));
	deliver(state("media", 100, 2, "second again"));
	deliver(state("settings", 100, 1, "another channel"));
	deliver(state("media", 100, 3, "third"));
	// The main window reloaded: its numbers start over, on a later epoch.
	deliver(state("media", 200, 1, "after a reload"));
	deliver(state("media", 100, 9, "the page before, late"));
	expect(heard).toEqual([
		["media", "second"],
		["settings", "another channel"],
		["media", "third"],
		["media", "after a reload"],
	]);
});

test("asking the main window gives its result, and throws its refusal", async () => {
	rpc.answer = { ok: true, result: { saved: true } };
	expect(await askMainWindow("settings", "save", { name: "x" })).toEqual({ saved: true });
	expect(rpc.asked.at(-1)).toEqual({ channel: "settings", name: "save", args: { name: "x" } });
	rpc.answer = { ok: false, error: "No main window" };
	expect(askMainWindow("settings", "save")).rejects.toThrow("No main window");
});

test("outside the desktop app there is nothing to listen to and nobody to ask", async () => {
	arriving = Promise.resolve(null);
	expect(await onWindowStates(() => {})).toBe(false);
	expect(askMainWindow("settings", "save")).rejects.toThrow("Not in the desktop app");
});
