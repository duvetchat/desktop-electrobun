import { expect, test } from "bun:test";
import { addWindowCommands, answerWindowCommand } from "$lib/window-commands";

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
