import { describe, expect, test } from "bun:test";
import {
	applyStatusUpdate,
	callRings,
	chosenStatus,
	forgetMemberStatus,
	forgetSpaceStatuses,
	isMobileOnly,
	memberMobileOnly,
	memberStatus,
	mentionSound,
	noteConversationMemberStatus,
	noteMemberStatus,
	rememberConversationPresences,
	rememberFriendPresences,
	spaceStatusKey,
	statusDotClass,
	STATUS_CHOICES,
} from "./status";
import type { ConversationMember } from "$lib/api/conversations";
import type { Friend } from "$lib/api/friends";
import { userStatusToString, type ClientStatus, type Presence, type UserStatus } from "$lib/types";

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

describe("isMobileOnly", () => {
	test("is a client status whose one platform is mobile, as duvet_client reads it (#82)", () => {
		expect(isMobileOnly({ mobile: 1 })).toBe(true);
		expect(isMobileOnly({ mobile: 2 })).toBe(true);
		expect(isMobileOnly({ desktop: 1 })).toBe(false);
		expect(isMobileOnly({ web: 1 })).toBe(false);
		expect(isMobileOnly({ desktop: 1, mobile: 1 })).toBe(false);
		expect(isMobileOnly({ web: 2, mobile: 2 })).toBe(false);
		// A platform this client doesn't know is one more.
		expect(isMobileOnly({ mobile: 1, watch: 1 } as ClientStatus)).toBe(false);
		// None: offline, or from a server from before client statuses.
		expect(isMobileOnly({})).toBe(false);
		expect(isMobileOnly(undefined)).toBe(false);
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

// A presence as an event gives it, without the platforms.
const presence = (status_id: UserStatus): Presence => ({ status_id });
// One with the platforms the user is on.
const on = (client_status: ClientStatus, status_id: UserStatus = 1): Presence => ({ status_id, client_status });

// A bot whose shards hold spaces A and B, one each.
describe("a bot's status in each space", () => {
	const bot = { id: "bot", is_bot: true };
	const connected = () =>
		new Map<string, Presence>([
			["bot", presence(1)],
			[spaceStatusKey("bot", "A"), presence(1)],
			[spaceStatusKey("bot", "B"), presence(1)],
		]);

	test("an update for space A changes neither its status in space B nor its global status", () => {
		// B's shard is down, and A's connects.
		const statuses = new Map<string, Presence>([["bot", presence(1)]]);
		applyStatusUpdate(statuses, { user_id: "bot", space_id: "A", status_id: 1 });
		expect(memberStatus(statuses, bot, "A")).toBe(1);
		expect(memberStatus(statuses, bot, "B")).toBe(0);
		expect(statuses.get("bot")?.status_id).toBe(1);

		// Both are up, and A's goes.
		const both = connected();
		applyStatusUpdate(both, { user_id: "bot", space_id: "A", status_id: 0 });
		expect(memberStatus(both, bot, "B")).toBe(1);
		expect(both.get("bot")?.status_id).toBe(1);
	});

	test("going offline in space A removes only A's entry", () => {
		const statuses = connected();
		applyStatusUpdate(statuses, { user_id: "bot", space_id: "A", status_id: 0 });
		expect(memberStatus(statuses, bot, "A")).toBe(0);
		expect([...statuses]).toEqual([
			["bot", presence(1)],
			[spaceStatusKey("bot", "B"), presence(1)],
		]);
	});

	test("is offline in a space whose SPACE_CREATE leaves it out, though another space shows it online", () => {
		const statuses = new Map<string, Presence>();
		// A's member_statuses list it; B's don't, as B's shard is down.
		noteMemberStatus(statuses, "bot", "A", presence(1));
		expect(memberStatus(statuses, bot, "A")).toBe(1);
		expect(memberStatus(statuses, bot, "B")).toBe(0);
	});

	test("a person's is their global status, in every space", () => {
		const person = { id: "person", is_bot: false };
		const statuses = new Map<string, Presence>();
		noteMemberStatus(statuses, "person", "A", presence(1));
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
		const statuses = new Map<string, Presence>();
		noteMemberStatus(statuses, "bot", "S1", presence(1));
		const before = statuses.get("bot");
		// The bot is added to S3: its SPACE_MEMBER_ADD carries 0, as the API can't tell whether a shard holds S3.
		noteMemberStatus(statuses, "bot", "S3", presence(0), true);
		expect(memberStatus(statuses, bot, "S1")).toBe(1);
		expect(memberStatus(statuses, bot, "S3")).toBe(0);
		// Its global entry keeps what it had: an ADD is a bot's status in that space alone.
		expect(statuses.get("bot")).toBe(before);
		// Then shard 1 connects, and S3 hears of it.
		applyStatusUpdate(statuses, { user_id: "bot", space_id: "S3", status_id: 1 });
		expect(memberStatus(statuses, bot, "S3")).toBe(1);
	});

	test("a SPACE_MEMBER_ADD sets a bot's entry for its space alone, and a person's global status alone", () => {
		const statuses = new Map<string, Presence>();
		noteMemberStatus(statuses, "bot", "S", presence(1), true);
		noteMemberStatus(statuses, "person", "S", presence(2), false);
		expect([...statuses]).toEqual([
			[spaceStatusKey("bot", "S"), presence(1)],
			["person", presence(2)],
		]);
		expect(memberStatus(statuses, bot, "S")).toBe(1);
		expect(memberStatus(statuses, person, "S")).toBe(2);
		// One whose user the API couldn't read says nothing of who it is: both, as member_statuses.
		noteMemberStatus(statuses, "other", "S", presence(1));
		expect(statuses.get("other")?.status_id).toBe(1);
		expect(statuses.get(spaceStatusKey("other", "S"))?.status_id).toBe(1);
	});

	test("a member removed from a space loses their status there alone", () => {
		const statuses = new Map<string, Presence>();
		noteMemberStatus(statuses, "bot", "S", presence(1));
		noteMemberStatus(statuses, "bot", "T", presence(1));
		noteMemberStatus(statuses, "person", "S", presence(1));
		forgetMemberStatus(statuses, "bot", "S");
		forgetMemberStatus(statuses, "person", "S");
		expect(memberStatus(statuses, bot, "S")).toBe(0);
		expect(memberStatus(statuses, bot, "T")).toBe(1);
		// A person's global status stays, for their conversations and friends.
		expect(statuses.get("person")?.status_id).toBe(1);
		expect(statuses.has(spaceStatusKey("person", "S"))).toBe(false);
	});

	test("a space the user left keeps no statuses, so a bot it shows again later isn't online from before", () => {
		const statuses = new Map<string, Presence>();
		noteMemberStatus(statuses, "bot", "S", presence(1));
		noteMemberStatus(statuses, "bot", "T", presence(1));
		noteMemberStatus(statuses, "person", "S", presence(1));
		// The user leaves S (SPACE_DELETE); then S's shard drops, whose 0 only S's members hear.
		forgetSpaceStatuses(statuses, "S");
		expect([...statuses]).toEqual([
			["bot", presence(1)],
			[spaceStatusKey("bot", "T"), presence(1)],
			["person", presence(1)],
		]);
		// They join S again: its SPACE_CREATE leaves the bot out, and sets nothing for it.
		noteMemberStatus(statuses, "person", "S", presence(1));
		expect(memberStatus(statuses, bot, "S")).toBe(0);
		expect(memberStatus(statuses, bot, "T")).toBe(1);
	});
});

// The platforms each event leaves beside a user's status, in the order connection.ts applies them, as above: whether
// a member shows as connected only from the mobile app (memberMobileOnly), which draws a phone for them (#82).
describe("a user's client status, through the events", () => {
	const ana = { id: "ana", is_bot: false };
	const bot = { id: "bot", is_bot: true };

	test("a SPACE_CREATE's member_client_status goes with its member_statuses", () => {
		const statuses = new Map<string, Presence>();
		noteMemberStatus(statuses, "ana", "S", on({ mobile: 1 }));
		expect(memberStatus(statuses, ana, "S")).toBe(1);
		expect(memberMobileOnly(statuses, ana)).toBe(true);
		// A gateway from before client statuses gives none, and the platforms known before don't stay.
		noteMemberStatus(statuses, "ana", "S", presence(1));
		expect(memberMobileOnly(statuses, ana)).toBe(false);
	});

	test("a USER_STATUS_UPDATE brings each change of platforms, and an offline one none", () => {
		const statuses = new Map<string, Presence>();
		applyStatusUpdate(statuses, { user_id: "ana", ...on({ mobile: 1 }) });
		expect(memberMobileOnly(statuses, ana)).toBe(true);
		// Their desktop app connects: the same status, from another platform.
		applyStatusUpdate(statuses, { user_id: "ana", ...on({ desktop: 1, mobile: 1 }) });
		expect(memberMobileOnly(statuses, ana)).toBe(false);
		// It drops, and its 30 seconds to resume are over; then they choose do not disturb on the phone.
		applyStatusUpdate(statuses, { user_id: "ana", ...on({ mobile: 1 }) });
		applyStatusUpdate(statuses, { user_id: "ana", ...on({ mobile: 2 }, 2) });
		expect(memberStatus(statuses, ana, "S")).toBe(2);
		expect(memberMobileOnly(statuses, ana)).toBe(true);
		// Offline: no platform is left.
		applyStatusUpdate(statuses, { user_id: "ana", status_id: 0 });
		expect(statuses.has("ana")).toBe(false);
		expect(memberMobileOnly(statuses, ana)).toBe(false);
		// An update without a client status, from a server from before them, leaves none either.
		applyStatusUpdate(statuses, { user_id: "ana", ...on({ mobile: 1 }) });
		applyStatusUpdate(statuses, { user_id: "ana", status_id: 1 });
		expect(memberMobileOnly(statuses, ana)).toBe(false);
	});

	test("a SPACE_MEMBER_ADD gives a person's platforms, and an offline presence keeps none", () => {
		const statuses = new Map<string, Presence>();
		noteMemberStatus(statuses, "ana", "S", on({ mobile: 1 }), false);
		expect(memberMobileOnly(statuses, ana)).toBe(true);
		noteMemberStatus(statuses, "ana", "S", on({ mobile: 0 }, 0), false);
		expect(statuses.get("ana")).toEqual({ status_id: 0 });
		expect(memberMobileOnly(statuses, ana)).toBe(false);
	});

	test("a person's platforms stay when they leave a space, or the user does, as their status", () => {
		const statuses = new Map<string, Presence>();
		noteMemberStatus(statuses, "ana", "S", on({ mobile: 1 }));
		forgetMemberStatus(statuses, "ana", "S");
		forgetSpaceStatuses(statuses, "S");
		expect(memberMobileOnly(statuses, ana)).toBe(true);
	});

	test("a bot is never only on mobile, and its status in each space stays its own (#113)", () => {
		const statuses = new Map<string, Presence>();
		// member_statuses doesn't say who is a bot; its client status there is desktop, with its status in the space.
		noteMemberStatus(statuses, "bot", "S", on({ desktop: 1 }));
		applyStatusUpdate(statuses, { user_id: "bot", space_id: "T", ...on({ desktop: 1 }) });
		expect(memberMobileOnly(statuses, bot)).toBe(false);
		// Not even where a presence would say so.
		applyStatusUpdate(statuses, { user_id: "bot", ...on({ mobile: 1 }) });
		expect(memberMobileOnly(statuses, bot)).toBe(false);
		// Its shard holding S drops: S shows it offline, T online.
		applyStatusUpdate(statuses, { user_id: "bot", space_id: "S", status_id: 0 });
		expect(memberStatus(statuses, bot, "S")).toBe(0);
		expect(memberStatus(statuses, bot, "T")).toBe(1);
	});
});

describe("rememberFriendPresences", () => {
	// A friend as the list and an accept's answer give them, with their presence.
	const friend = (other: string, shown: Presence, sentByMe = false): Friend => ({
		id: `friendship-${other}`,
		request_id: `request-${other}`,
		sender_id: sentByMe ? "me" : other,
		recipient_id: sentByMe ? other : "me",
		user_username: other,
		user_alias: null,
		user_avatar: null,
		...shown,
	});

	test("takes a friend's status and platforms when the gateway hasn't told of them (#82)", () => {
		const statuses = new Map<string, Presence>();
		const learned = rememberFriendPresences(
			statuses,
			[friend("ana", on({ mobile: 1 })), friend("bob", on({ web: 2 }, 2), true)],
			"me",
		);
		expect([...learned]).toEqual(["ana", "bob"]);
		expect(statuses.get("ana")).toEqual({ status_id: 1, client_status: { mobile: 1 } });
		expect(statuses.get("bob")).toEqual({ status_id: 2, client_status: { web: 2 } });
		expect(memberMobileOnly(statuses, { id: "ana" })).toBe(true);
		expect(memberMobileOnly(statuses, { id: "bob" })).toBe(false);
	});

	test("keeps what the gateway said, which is newer, and takes no offline friend", () => {
		const statuses = new Map<string, Presence>([["ana", on({ desktop: 1 })]]);
		const learned = rememberFriendPresences(
			statuses,
			[friend("ana", on({ mobile: 1 })), friend("cid", presence(0))],
			"me",
		);
		expect(learned.size).toBe(0);
		expect(statuses.get("ana")).toEqual(on({ desktop: 1 }));
		expect(statuses.has("cid")).toBe(false);
	});
});

// Someone in a DM or a group with the user who is neither their friend nor in a space with them is known only from the
// conversation: from the conversations list, CONVERSATION_CREATE and CONVERSATION_MEMBER_ADD, then their changes (#84).
describe("a conversation's members' presences", () => {
	// A member as the conversations list and CONVERSATION_CREATE give them, with their presence.
	const member = (userId: string, shown: Partial<Presence> = {}): ConversationMember => ({
		id: `member-${userId}`,
		conversation_id: "conv",
		user_id: userId,
		created_at: "",
		updated_at: "",
		user: { id: userId, username: userId, alias: null, avatar: null, banner: null },
		...shown,
	});

	test("the conversations list gives a stranger's status and platforms, and not the user's own", () => {
		const statuses = new Map<string, Presence>();
		const learned = rememberConversationPresences(
			statuses,
			[
				{ members: [member("me", on({ web: 1 })), member("ana", on({ desktop: 1 }))] },
				{ members: [member("me", on({ web: 1 })), member("bob", on({ mobile: 2 }, 2)), member("cid", presence(0))] },
			],
			"me",
		);
		expect([...learned]).toEqual(["ana", "bob"]);
		expect(statuses.get("ana")).toEqual(on({ desktop: 1 }));
		expect(statuses.get("bob")).toEqual(on({ mobile: 2 }, 2));
		expect(memberMobileOnly(statuses, { id: "bob" })).toBe(true);
		expect(statuses.has("me")).toBe(false);
		expect(statuses.has("cid")).toBe(false);
	});

	test("the list keeps what the gateway said, which is newer, and an API from before presences gives none", () => {
		const statuses = new Map<string, Presence>([["ana", on({ mobile: 1 })]]);
		const learned = rememberConversationPresences(
			statuses,
			[{ members: [member("ana", on({ desktop: 2 }, 2)), member("dan")] }],
			"me",
		);
		expect(learned.size).toBe(0);
		expect(statuses.get("ana")).toEqual(on({ mobile: 1 }));
		expect(statuses.has("dan")).toBe(false);
	});

	test("CONVERSATION_CREATE's and CONVERSATION_MEMBER_ADD's presence is kept, and USER_STATUS_UPDATE keeps it up", () => {
		// Kept from a space the user has since left, whose changes no longer reach them.
		const statuses = new Map<string, Presence>([["ana", on({ desktop: 1 })]]);
		noteConversationMemberStatus(statuses, "ana", on({ mobile: 2 }, 2));
		expect(statuses.get("ana")).toEqual(on({ mobile: 2 }, 2));
		noteConversationMemberStatus(statuses, "bob", on({ web: 1 }));
		expect(statuses.get("bob")).toEqual(on({ web: 1 }));
		// Offline, as an event gives it: without platforms.
		noteConversationMemberStatus(statuses, "cid", on({ mobile: 1 }, 0));
		expect(statuses.get("cid")).toEqual(presence(0));
		// An event from an API from before presences changes nothing.
		noteConversationMemberStatus(statuses, "ana", {});
		expect(statuses.get("ana")).toEqual(on({ mobile: 2 }, 2));
		applyStatusUpdate(statuses, { user_id: "bob", status_id: 0 });
		expect(statuses.has("bob")).toBe(false);
	});
});
