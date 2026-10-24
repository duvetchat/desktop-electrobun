import { describe, expect, test } from "bun:test";
import { callRings, chosenStatus, mentionSound, statusDotClass, STATUS_CHOICES } from "./status";
import { userStatusToString } from "$lib/types";

describe("userStatusToString", () => {
	test("shows 2 as do not disturb, 1 as online and anything else as offline", () => {
		expect(userStatusToString(2)).toBe("dnd");
		expect(userStatusToString(1)).toBe("online");
		expect(userStatusToString(0)).toBe("offline");
	});
});

describe("chosenStatus", () => {
	test("is do not disturb or else online", () => {
		expect(chosenStatus(2)).toBe(2);
		expect(chosenStatus(1)).toBe(1);
		expect(chosenStatus(undefined)).toBe(1);
		expect(chosenStatus(0)).toBe(1);
	});
});

describe("STATUS_CHOICES", () => {
	test("are online and do not disturb, in that order", () => {
		expect(STATUS_CHOICES.map((c) => c.status)).toEqual([1, 2]);
	});
});

describe("statusDotClass", () => {
	test("gives each status its own color", () => {
		const classes = (["online", "idle", "dnd", "offline"] as const).map(statusDotClass);
		expect(new Set(classes).size).toBe(4);
		expect(statusDotClass("dnd")).toBe("bg-red-500");
	});
});

describe("mentionSound", () => {
	test("plays for a mention off screen, unless the user is in do not disturb", () => {
		expect(mentionSound(1, false)).toBe(true);
		expect(mentionSound(undefined, false)).toBe(true);
		expect(mentionSound(2, false)).toBe(false);
	});
	test("never plays for a mention on screen", () => {
		expect(mentionSound(1, true)).toBe(false);
		expect(mentionSound(2, true)).toBe(false);
	});
});

describe("callRings", () => {
	test("an incoming call rings, except in do not disturb", () => {
		expect(callRings("ringing", 1)).toBe(true);
		expect(callRings("ringing", undefined)).toBe(true);
		expect(callRings("ringing", 2)).toBe(false);
	});
	test("the call the user places always rings back, and nothing else rings", () => {
		expect(callRings("calling", 1)).toBe(true);
		expect(callRings("calling", 2)).toBe(true);
		expect(callRings("connected", 1)).toBe(false);
		expect(callRings("idle", 1)).toBe(false);
	});
});
