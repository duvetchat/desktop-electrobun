import { describe, expect, test } from "bun:test";
import {
	applyStatusUpdate,
	callRings,
	chosenStatus,
	forgetMemberStatus,
	forgetSpaceStatuses,
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

// What each event leaves in the cache, in the order connection.ts applies them: SPACE_CREATE's member_statuses
// (noteMemberStatus, without saying who is a bot), SPACE_MEMBER_ADD (with its user's is_bot), USER_STATUS_UPDATE
// (applyStatusUpdate), SPACE_MEMBER_REMOVE (forgetMemberStatus) and SPACE_DELETE (forgetSpaceStatuses).
describe("a bot's status per space, through a space's events", () => {
	const bot = { id: "bot", is_bot: true };
	const person = { id: "person", is_bot: false };

	test("a bot added to another space at 0 still shows online where it was (#123)", () => {
		// Shard 0 holds S1 and is up; shard 1, which holds S3, is down.
		const statuses = new Map<string, UserStatus>();
		noteMemberStatus(statuses, "bot", "S1", 1);
		const before = statuses.get("bot");
		// The bot is added to S3: its SPACE_MEMBER_ADD carries 0, as the API can't tell whether a shard holds S3.
		noteMemberStatus(statuses, "bot", "S3", 0, true);
		expect(memberStatus(statuses, bot, "S1")).toBe(1);
		expect(memberStatus(statuses, bot, "S3")).toBe(0);
		// Its global entry keeps what it had: an ADD is a bot's status in that space alone.
		expect(statuses.get("bot")).toBe(before);
		// Then shard 1 connects, and S3 hears of it.
		applyStatusUpdate(statuses, { user_id: "bot", space_id: "S3", status_id: 1 });
		expect(memberStatus(statuses, bot, "S3")).toBe(1);
	});

	test("a SPACE_MEMBER_ADD sets a bot's entry for its space alone, and a person's global status alone", () => {
		const statuses = new Map<string, UserStatus>();
		noteMemberStatus(statuses, "bot", "S", 1, true);
		noteMemberStatus(statuses, "person", "S", 2, false);
		expect([...statuses]).toEqual([
			[spaceStatusKey("bot", "S"), 1],
			["person", 2],
		]);
		expect(memberStatus(statuses, bot, "S")).toBe(1);
		expect(memberStatus(statuses, person, "S")).toBe(2);
		// One whose user the API couldn't read says nothing of who it is: both, as member_statuses.
		noteMemberStatus(statuses, "other", "S", 1);
		expect(statuses.get("other")).toBe(1);
		expect(statuses.get(spaceStatusKey("other", "S"))).toBe(1);
	});

	test("a member removed from a space loses their status there alone", () => {
		const statuses = new Map<string, UserStatus>();
		noteMemberStatus(statuses, "bot", "S", 1);
		noteMemberStatus(statuses, "bot", "T", 1);
		noteMemberStatus(statuses, "person", "S", 1);
		forgetMemberStatus(statuses, "bot", "S");
		forgetMemberStatus(statuses, "person", "S");
		expect(memberStatus(statuses, bot, "S")).toBe(0);
		expect(memberStatus(statuses, bot, "T")).toBe(1);
		// A person's global status stays, for their conversations and friends.
		expect(statuses.get("person")).toBe(1);
		expect(statuses.has(spaceStatusKey("person", "S"))).toBe(false);
	});

	test("a space the user left keeps no statuses, so a bot it shows again later isn't online from before", () => {
		const statuses = new Map<string, UserStatus>();
		noteMemberStatus(statuses, "bot", "S", 1);
		noteMemberStatus(statuses, "bot", "T", 1);
		noteMemberStatus(statuses, "person", "S", 1);
		// The user leaves S (SPACE_DELETE); then S's shard drops, whose 0 only S's members hear.
		forgetSpaceStatuses(statuses, "S");
		expect([...statuses]).toEqual([
			["bot", 1],
			[spaceStatusKey("bot", "T"), 1],
			["person", 1],
		]);
		// They join S again: its SPACE_CREATE leaves the bot out, and sets nothing for it.
		noteMemberStatus(statuses, "person", "S", 1);
		expect(memberStatus(statuses, bot, "S")).toBe(0);
		expect(memberStatus(statuses, bot, "T")).toBe(1);
	});
});
