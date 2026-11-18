import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addWindowCommands, answerWindowCommand, joinWindowCommands } from "$lib/window-commands";

// #357: the main window answers its other windows' commands, each part of the app adding its own channel.
test("each channel's commands are answered by whoever added them", async () => {
	const stopMedia = addWindowCommands("media", { toggleMute: () => "muted" });
	const stopSettings = addWindowCommands("settings", { open: (section) => `opened ${String(section)}` });
	expect(await answerWindowCommand({ channel: "media", name: "toggleMute" })).toEqual({ ok: true, result: "muted" });
	expect(await answerWindowCommand({ channel: "settings", name: "open", args: "audio" })).toEqual({
		ok: true,
		result: "opened audio",
	});
	stopMedia();
	// One part going takes only its own channel.
	expect(await answerWindowCommand({ channel: "media", name: "toggleMute" })).toEqual({
		ok: false,
		error: "No command media.toggleMute",
	});
	expect((await answerWindowCommand({ channel: "settings", name: "open" })).ok).toBe(true);
	stopSettings();
});

test("a channel added again keeps the later commands, and the earlier one's stop leaves them", async () => {
	const stopFirst = addWindowCommands("media", { which: () => "first" });
	const stopSecond = addWindowCommands("media", { which: () => "second" });
	stopFirst();
	expect(await answerWindowCommand({ channel: "media", name: "which" })).toEqual({ ok: true, result: "second" });
	stopSecond();
	expect((await answerWindowCommand({ channel: "media", name: "which" })).ok).toBe(false);
});

test("a command that throws answers why, and one nobody has answers so", async () => {
	const stop = addWindowCommands("media", {
		selectMic: () => {
			throw new Error("selectMic takes a microphone's ID");
		},
	});
	expect(await answerWindowCommand({ channel: "media", name: "selectMic" })).toEqual({
		ok: false,
		error: "selectMic takes a microphone's ID",
	});
	expect(await answerWindowCommand({ channel: "nobody", name: "x" })).toEqual({
		ok: false,
		error: "No command nobody.x",
	});
	stop();
});

// The media controls' pop-out and the Settings windows each start on their own, and the RPC keeps one answerer: both
// register here, so whichever hands it over, every channel is answered (#357).
test("commands joined to a channel sit beside its earlier ones, and beside other channels'", async () => {
	const stop = addWindowCommands("media", { toggleMute: () => "muted" });
	joinWindowCommands("settings-test", { open: () => "opened" });
	joinWindowCommands("settings-test", { close: () => "closed" });
	expect(await answerWindowCommand({ channel: "settings-test", name: "open" })).toEqual({ ok: true, result: "opened" });
	expect(await answerWindowCommand({ channel: "settings-test", name: "close" })).toEqual({
		ok: true,
		result: "closed",
	});
	expect(await answerWindowCommand({ channel: "media", name: "toggleMute" })).toEqual({ ok: true, result: "muted" });
	stop();
});

test("the Settings windows' hub and the media pop-out hand the RPC the same answerer", () => {
	const hub = readFileSync(join(import.meta.dir, "window-hub.ts"), "utf8");
	const popOut = readFileSync(join(import.meta.dir, "media-popout.svelte.ts"), "utf8");
	expect(hub).toContain("on.windowCommand(answerWindowCommand)");
	expect(popOut).toContain("on.windowCommand(answerWindowCommand)");
	expect(hub).not.toContain("answerCommand(handlers");
});
