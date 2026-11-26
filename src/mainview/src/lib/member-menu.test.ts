import { describe, expect, test } from "bun:test";
import { Permission } from "$lib/permissions";
import type { GatewayRole, GatewaySpace, GatewayUser } from "$lib/types";

// moderationOf's module has the confirmation and the toasts, .svelte.ts modules whose $state only Svelte's compiler
// knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { canChatWith, memberMenuItems, personOf, tiesOf } = await import("$lib/member-menu");
type Input = Parameters<typeof memberMenuItems>[0];

const SPACE = "01920000-0000-7000-8000-0000000005a0";
const OWNER = "01920000-0000-7000-8000-00000000000a";
const ME = "01920000-0000-7000-8000-00000000b0b0";
const CAROL = "01920000-0000-7000-8000-00000000ca01";
const CAROL_MEMBER = "01920000-0000-7000-8000-00000000c0c0";

const role = (id: string, permissions: number, position: number): GatewayRole => ({
	id,
	space_id: SPACE,
	name: id,
	color_from: null,
	color_via: null,
	color_to: null,
	flags: 0,
	permissions,
	created_at: "",
	updated_at: "",
	hoisted: false,
	position,
});
const ROLES = [
	role(SPACE, 0, 0),
	role("helpers", Permission.KickMembers, 1),
	role("mods", Permission.BanMembers, 2),
	role("managers", Permission.ManageRoles, 3),
	role("admins", Permission.Administrator, 4),
];
// The Space as `me` has it, holding @everyone and `mine`; Carol holds @everyone and `hers`.
const space = (mine: string[], me = ME, hers: string[] = []): GatewaySpace => ({
	id: SPACE,
	name: "Alpha",
	description: null,
	banner: null,
	owner_id: OWNER,
	locale: null,
	member: { id: me, space_id: SPACE, user_id: me, alias: null, created_at: "", updated_at: "" },
	member_roles: { [me]: [SPACE, ...mine], [CAROL]: [SPACE, ...hers] },
	room_overwrites: [],
	rooms: [],
	members: [],
	roles: ROLES,
	users: [],
	created_at: "",
	updated_at: "",
});

const STRANGER = { friend: false, askedMe: false, askedThem: false, dm: false };
const carol = { id: CAROL, memberId: CAROL_MEMBER, name: "Carol", isBot: false, flags: null };
const input = (change: Partial<Input> = {}): Input => ({
	me: { id: ME, staff: false },
	person: carol,
	space: space([]),
	ties: STRANGER,
	busy: false,
	can: { profile: true, mention: true, removeFromGroup: false },
	...change,
});

describe("a member's menu", () => {
	test("someone the user doesn't know: their profile, a mention, Add friend and their ID, nothing more", () => {
		expect(memberMenuItems(input())).toEqual({
			profile: true,
			mention: true,
			message: false,
			call: false,
			friend: "add",
			roles: [],
			displayName: false,
			moderation: null,
			removeFromGroup: false,
			shareHistory: false,
			staff: false,
		});
	});

	test("what the list doesn't do isn't there: its profile, a mention in its chat, Remove from group", () => {
		const items = memberMenuItems(input({ can: { profile: false, mention: false, removeFromGroup: false } }));
		expect([items.profile, items.mention, items.removeFromGroup]).toEqual([false, false, false]);
	});

	test("a friend: Message, Call and Remove friend; Call waits for no other call", () => {
		const friend = memberMenuItems(input({ ties: { ...STRANGER, friend: true } }));
		expect([friend.message, friend.call, friend.friend]).toEqual([true, true, "remove"]);
		expect(memberMenuItems(input({ ties: { ...STRANGER, friend: true }, busy: true })).call).toBe(false);
	});

	test("someone the user has a direct conversation with: Message and Call, friends or not", () => {
		const items = memberMenuItems(input({ ties: { ...STRANGER, dm: true } }));
		expect([items.message, items.call, items.friend]).toEqual([true, true, "add"]);
	});

	test("a friend request: theirs is accepted from here; the user's own, waiting, offers nothing", () => {
		expect(memberMenuItems(input({ ties: { ...STRANGER, askedMe: true } })).friend).toBe("accept");
		expect(memberMenuItems(input({ ties: { ...STRANGER, askedThem: true } })).friend).toBeNull();
	});

	test("a bot: no friendship, no direct conversation and no call, which a bot can't take", () => {
		const items = memberMenuItems(input({ person: { ...carol, isBot: true }, ties: { ...STRANGER, dm: true } }));
		expect([items.message, items.call, items.friend]).toEqual([false, false, null]);
	});

	test("the user themselves: their display name, and none of what's for someone else", () => {
		// The Space's owner, who may act on anyone but themselves.
		const items = memberMenuItems(
			input({
				me: { id: OWNER, staff: false },
				person: { ...carol, id: OWNER },
				ties: { ...STRANGER, friend: true, dm: true },
				space: space([], OWNER),
			}),
		);
		expect(items).toMatchObject({ message: false, call: false, friend: null, displayName: true, moderation: null });
		const inGroup = input({ person: { ...carol, id: ME }, can: { ...input().can, removeFromGroup: true } });
		expect(memberMenuItems(inGroup).removeFromGroup).toBe(false);
	});

	test("Remove from group for the group's owner, on anyone else", () => {
		expect(
			memberMenuItems(input({ space: null, can: { ...input().can, removeFromGroup: true } })).removeFromGroup,
		).toBe(true);
	});

	// Task 30: an encrypted conversation's history, shared with another member who is a person, where the list shares it.
	test("Share history in a conversation's list, on anyone else who is a person", () => {
		const sharing = (change: Partial<Input> = {}) =>
			memberMenuItems(input({ space: null, can: { ...input().can, shareHistory: true }, ...change })).shareHistory;
		expect(sharing()).toBe(true);
		expect(sharing({ person: { ...carol, id: ME } })).toBe(false);
		expect(sharing({ person: { ...carol, isBot: true } })).toBe(false);
		expect(memberMenuItems(input({ space: null })).shareHistory).toBe(false);
	});
});

// The menu's Message and Call, and a profile's Send direct message.
describe("a direct conversation with someone", () => {
	const person = { id: CAROL, isBot: false };

	test("opens with a friend, and with someone the user has one with already", () => {
		expect(canChatWith(ME, person, { friend: true, dm: false })).toBe(true);
		expect(canChatWith(ME, person, { friend: false, dm: true })).toBe(true);
	});

	test("doesn't with a stranger, whom the API refuses, a bot, oneself, or nobody signed in", () => {
		expect(canChatWith(ME, person, { friend: false, dm: false })).toBe(false);
		expect(canChatWith(ME, { ...person, isBot: true }, { friend: true, dm: true })).toBe(false);
		expect(canChatWith(CAROL, person, { friend: true, dm: true })).toBe(false);
		expect(canChatWith(null, person, { friend: true, dm: true })).toBe(false);
	});
});

describe("a member's roles, within the user's reach", () => {
	const roles = (items: ReturnType<typeof memberMenuItems>) =>
		items.roles.map((r) => `${r.role.id}${r.held ? "✓" : ""}`);

	test("with Manage Roles, the roles below the user's highest, the highest first, ticked where the member holds them", () => {
		expect(roles(memberMenuItems(input({ space: space(["managers"], ME, ["helpers"]) })))).toEqual([
			"mods",
			"helpers✓",
		]);
	});

	test("the owner reaches every role; an Administrator those below their highest; never @everyone", () => {
		expect(roles(memberMenuItems(input({ space: space([], OWNER), me: { id: OWNER, staff: false } })))).toEqual([
			"admins",
			"managers",
			"mods",
			"helpers",
		]);
		expect(roles(memberMenuItems(input({ space: space(["admins"]) })))).toEqual(["managers", "mods", "helpers"]);
	});

	test("none without Manage Roles, outside a Space, or for a member whose member ID isn't known yet", () => {
		expect(memberMenuItems(input({ space: space(["mods"]) })).roles).toEqual([]);
		expect(memberMenuItems(input({ space: null })).roles).toEqual([]);
		expect(memberMenuItems(input({ space: space(["managers"]), person: { ...carol, memberId: "" } })).roles).toEqual(
			[],
		);
	});

	test("the user's own roles, as the API lets them change those too", () => {
		const items = memberMenuItems(
			input({ space: space(["managers", "helpers"]), person: { ...carol, id: ME, memberId: "m" } }),
		);
		expect(roles(items)).toEqual(["mods", "helpers✓"]);
	});
});

describe("Kick and Ban, as the API allows them", () => {
	test("for whom the user outranks, with the permission", () => {
		expect(memberMenuItems(input({ space: space(["helpers"]) })).moderation).toMatchObject({ kick: true, ban: false });
		expect(memberMenuItems(input({ space: space(["mods"]) })).moderation).toMatchObject({ kick: false, ban: true });
	});

	test("never on someone ranked as high, nor without the permission", () => {
		expect(memberMenuItems(input({ space: space(["helpers"], ME, ["helpers"]) })).moderation).toBeNull();
		expect(memberMenuItems(input({ space: space(["managers"]) })).moderation).toBeNull();
	});
});

describe("Duvet staff", () => {
	test("edit the flags and badges of someone whose flags the list knows", () => {
		const staff = { id: ME, staff: true };
		expect(memberMenuItems(input({ me: staff, person: { ...carol, flags: { flags: 0, badges: 1 } } })).staff).toBe(
			true,
		);
		expect(memberMenuItems(input({ me: staff })).staff).toBe(false);
		expect(memberMenuItems(input({ person: { ...carol, flags: { flags: 0, badges: 1 } } })).staff).toBe(false);
	});
});

describe("a list's member, as the menu takes them", () => {
	const listed = { id: CAROL, member_id: CAROL_MEMBER, username: "Carol", is_bot: false };
	test("a Space's: their member ID, and their flags where the Space has their user", () => {
		const user: GatewayUser = {
			id: CAROL,
			username: "carol",
			email_verified: true,
			alias: "Carol",
			avatar: null,
			banner: null,
			custom: "",
			flags: 1,
			badges: 2,
			is_bot: false,
			created_at: "",
			updated_at: "",
		};
		const withUser = { ...space([]), users: [user] };
		expect(personOf(listed, withUser)).toEqual({ ...carol, flags: { flags: 1, badges: 2 } });
		expect(personOf(listed, space([])).flags).toBeNull();
	});

	test("a conversation's: no Space member ID, which theirs isn't", () => {
		expect(personOf(listed, null)).toEqual({ ...carol, memberId: "", flags: null });
	});

	test("the gateway's own row for the user, whose member ID is their user ID until a page brings theirs: none", () => {
		expect(personOf({ ...listed, member_id: CAROL }, space([])).memberId).toBe("");
	});
});

describe("where the user stands with someone", () => {
	type Between = { sender_id: string; recipient_id: string };
	type Chat = { type: 1 | 2; members: { user_id: string }[] };
	const friendOf = (sender: string, recipient: string): Between => ({ sender_id: sender, recipient_id: recipient });
	const request = friendOf;
	const chat = (type: 1 | 2, users: string[]): Chat => ({ type, members: users.map((user_id) => ({ user_id })) });

	test("friends either way round, requests each way, and a direct conversation (a group's isn't one)", () => {
		const ties = (friends: Between[], received: Between[], sent: Between[], chats: Chat[]) =>
			tiesOf(CAROL, ME, { friends, received, sent, conversations: chats });
		expect(ties([friendOf(CAROL, ME)], [], [], [])).toEqual({ ...STRANGER, friend: true });
		expect(ties([friendOf(ME, CAROL)], [], [], []).friend).toBe(true);
		expect(ties([friendOf(ME, OWNER)], [], [], []).friend).toBe(false);
		expect(ties([], [request(CAROL, ME)], [], []).askedMe).toBe(true);
		expect(ties([], [], [request(ME, CAROL)], []).askedThem).toBe(true);
		expect(ties([], [], [], [chat(1, [ME, CAROL])]).dm).toBe(true);
		expect(ties([], [], [], [chat(2, [ME, CAROL, OWNER])]).dm).toBe(false);
	});
});
