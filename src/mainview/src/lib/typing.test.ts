import { describe, expect, test } from "bun:test";
import type { TypingUser } from "$lib/stores.svelte";
import { recordingPhrase, TYPING_TIMEOUT, typersAt, typingPhrase, typingSentence } from "$lib/typing";

const NOW = 1_000_000;
const user = (name: string, ago = 0, recording = false, alias: string | null = null): TypingUser => ({
	user_id: `id-${name}`,
	username: name,
	alias,
	avatar: null,
	timestamp: NOW - ago,
	recording,
});

describe("typersAt", () => {
	test("shows everyone but the user", () => {
		const { typers } = typersAt({ room: [user("me"), user("ana")] }, "id-me", NOW);
		expect(typers.room.map((u) => u.username)).toEqual(["ana"]);
	});

	test("a chat where only the user types has nobody to show", () => {
		expect(typersAt({ room: [user("me")] }, "id-me", NOW).typers).toEqual({});
	});

	test("a notice shows for its whole time and no longer", () => {
		const almost = typersAt({ room: [user("ana", TYPING_TIMEOUT - 1)] }, undefined, NOW);
		expect(almost.typers.room).toHaveLength(1);
		expect(typersAt({ room: [user("ana", TYPING_TIMEOUT)] }, undefined, NOW).typers).toEqual({});
	});

	test("says when the next one ends, so that nothing has to happen for it to go", () => {
		const { nextEnd } = typersAt({ a: [user("ana", 1000)], b: [user("bob", 3000), user("eve", 2000)] }, "id-me", NOW);
		expect(nextEnd).toBe(NOW - 3000 + TYPING_TIMEOUT);
	});

	test("the user's own notice and old ones set no time: there's nothing to end", () => {
		const { nextEnd } = typersAt({ a: [user("me")], b: [user("ana", TYPING_TIMEOUT)] }, "id-me", NOW);
		expect(nextEnd).toBeNull();
	});
});

describe("what a chat's row says", () => {
	test("nobody: nothing, so the row says what it does", () => {
		expect(typingSentence(undefined)).toBeNull();
		expect(typingSentence([])).toBeNull();
	});

	test("names who's typing by their alias, up to two", () => {
		expect(typingSentence([user("ana", 0, false, "Ana")])).toBe("Ana is typing…");
		expect(typingSentence([user("ana", 0, false, "Ana"), user("bob")])).toBe("Ana and bob are typing…");
		expect(typingSentence([user("ana"), user("bob"), user("eve")])).toBe("Several people are typing…");
	});

	test("says who's recording, and both when both", () => {
		expect(typingSentence([user("ana", 0, true)])).toBe("ana is recording a voice message");
		expect(typingSentence([user("ana"), user("bob", 0, true)])).toBe(
			"ana is typing… · bob is recording a voice message",
		);
	});

	test("the open chat's indicator reads the same words", () => {
		expect(typingPhrase([user("ana")])).toBe("ana is typing");
		expect(recordingPhrase([user("ana"), user("bob")])).toBe("ana and bob are recording voice messages");
		expect(recordingPhrase([user("ana"), user("bob"), user("eve")])).toBe(
			"Several people are recording voice messages",
		);
	});
});
