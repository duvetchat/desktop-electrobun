import { describe, expect, test } from "bun:test";
import {
	applyStatusUpdate,
	callRings,
	chosenStatus,
	memberStatus,
	mentionSound,
	noteMemberStatus,
	spaceStatusKey,
	statusDotClass,
	STATUS_CHOICES,
} from "./status";
import { userStatusToString, type UserStatus } from "$lib/types";

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

// A bot whose shards hold spaces A and B, one each.
describe("a bot's status in each space", () => {
	const bot = { id: "bot", is_bot: true };
	const connected = () =>
		new Map<string, UserStatus>([
			["bot", 1],
			[spaceStatusKey("bot", "A"), 1],
			[spaceStatusKey("bot", "B"), 1],
		]);

	test("an update for space A changes neither its status in space B nor its global status", () => {
		// B's shard is down, and A's connects.
		const statuses = new Map<string, UserStatus>([["bot", 1]]);
		applyStatusUpdate(statuses, { user_id: "bot", space_id: "A", status_id: 1 });
		expect(memberStatus(statuses, bot, "A")).toBe(1);
		expect(memberStatus(statuses, bot, "B")).toBe(0);
		expect(statuses.get("bot")).toBe(1);

		// Both are up, and A's goes.
		const both = connected();
		applyStatusUpdate(both, { user_id: "bot", space_id: "A", status_id: 0 });
		expect(memberStatus(both, bot, "B")).toBe(1);
		expect(both.get("bot")).toBe(1);
	});

	test("going offline in space A removes only A's entry", () => {
		const statuses = connected();
		applyStatusUpdate(statuses, { user_id: "bot", space_id: "A", status_id: 0 });
		expect(memberStatus(statuses, bot, "A")).toBe(0);
		expect([...statuses]).toEqual([
			["bot", 1],
			[spaceStatusKey("bot", "B"), 1],
		]);
	});

	test("is offline in a space whose SPACE_CREATE leaves it out, though another space shows it online", () => {
		const statuses = new Map<string, UserStatus>();
		// A's member_statuses list it; B's don't, as B's shard is down.
		noteMemberStatus(statuses, "bot", "A", 1);
		expect(memberStatus(statuses, bot, "A")).toBe(1);
		expect(memberStatus(statuses, bot, "B")).toBe(0);
	});

	test("a person's is their global status, in every space", () => {
		const person = { id: "person", is_bot: false };
		const statuses = new Map<string, UserStatus>();
		noteMemberStatus(statuses, "person", "A", 1);
		applyStatusUpdate(statuses, { user_id: "person", status_id: 2 });
		expect(memberStatus(statuses, person, "A")).toBe(2);
		expect(memberStatus(statuses, person, "B")).toBe(2);
		applyStatusUpdate(statuses, { user_id: "person", status_id: 0 });
		expect(memberStatus(statuses, person, "A")).toBe(0);
	});
});
