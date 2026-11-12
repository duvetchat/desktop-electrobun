import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";

// A mention plays the notification sound through an <audio>, which Bun has none of.
class FakeAudio {
	volume = 1;
	currentTime = 0;
	play() {
		return Promise.resolve();
	}
}
Object.assign(globalThis, { Audio: FakeAudio });

const stores = await import("$lib/stores.svelte");
const { mentionNotices } = await import("$lib/mention-notices");
const { notificationLevels } = await import("$lib/notification-levels");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ANA = "01920000-0000-7000-8000-00000000a11c";
const SPACE = "01920000-0000-7000-8000-0000000005a0";
const ROOM = "01920000-0000-7000-8000-0000000005a1";
const OTHER_ROOM = "01920000-0000-7000-8000-0000000005a2";
const DM = "01920000-0000-7000-8000-00000000d001";
const GROUP = "01920000-0000-7000-8000-00000000d002";
const message = (n: number) => `01a15f8c-${String(n).padStart(4, "0")}-7000-8000-000000000000`;
const ana = { id: ANA, username: "ana", alias: "Ana", avatar: null, banner: null };
const T = "2026-11-01T12:00:00Z";

// The messages the API has, by ID, and one it holds until the test lets it go.
const apiMessages = new Map<string, object>([
	[message(2), { id: message(2), room_id: OTHER_ROOM, author_id: ANA, content: `Fetched <@${ME}>`, user: ana }],
	[message(30), { id: message(30), conversation_id: DM, author_id: ANA, content: "Fetched in the DM", user: ana }],
]);
// The user's conversations, as READY's loading reads them.
const conversationList = [
	{ id: DM, type: 1, name: null, owner_id: ME, created_at: T, updated_at: T, deleted_at: null, members: [] },
	{ id: GROUP, type: 2, name: "Weekend", owner_id: ME, created_at: T, updated_at: T, deleted_at: null, members: [] },
];
let held: { id: string; release: () => void } | null = null;
const fetches: string[] = [];
const fetchSpy = spyOn(globalThis, "fetch");

let gateway: TestGateway;
const deliver = (type: string, data: unknown) => gateway.receive(type, data);
// The mention's notice comes once its message is there, which a fetch can take a few turns for.
const settle = () => Bun.sleep(20);
const noticeOf = (id: string) => get(mentionNotices).find((n) => n.id === id);

function roomMessage(n: number, roomId = ROOM, content = `Hey <@${ME}>, look`) {
	deliver("MESSAGE_CREATE", {
		id: message(n),
		room_id: roomId,
		author_id: ANA,
		content,
		user: ana,
		created_at: T,
		updated_at: T,
	});
}
const mention = (n: number, roomId = ROOM) =>
	deliver("MENTION_CREATE", { message_id: message(n), room_id: roomId, author_id: ANA });

beforeAll(async () => {
	fetchSpy.mockImplementation((async (input: string | URL | Request) => {
		const url = input instanceof Request ? input.url : input.toString();
		if (url.endsWith("/api/users/@me/conversations")) return Response.json(conversationList);
		// Every request for a message, whatever its path.
		if (url.includes("/messages/")) fetches.push(url);
		const one = /\/messages\/([^/?]+)$/.exec(url)?.[1];
		if (!one) return Response.json([]);
		if (held?.id === one) await new Promise<void>((resolve) => (held!.release = resolve));
		const found = apiMessages.get(one);
		return found ? Response.json(found) : Response.json({ error: "message not found" }, { status: 404 });
	}) as typeof fetch);
	localStorage.setItem("duvet_session_token", "access");
	gateway = await openGateway();
	deliver("READY", { user: { id: ME, username: "me", status: 1 }, sessionToken: "session", guild_ids: [SPACE] });
	deliver("SPACE_CREATE", {
		space: { id: SPACE, name: "Alpha", owner_id: ME, created_at: T, updated_at: T },
		rooms: {
			[ROOM]: { id: ROOM, space_id: SPACE, name: "general", type: 1, position: 0 },
			[OTHER_ROOM]: { id: OTHER_ROOM, space_id: SPACE, name: "random", type: 1, position: 1 },
		},
		roles_permissions: {},
		member_roles: {},
		overwrites: {},
		voice_states: [],
	});
	stores.pageVisible.set(true);
});

afterAll(() => {
	gateway.close();
	fetchSpy.mockRestore();
});

// A mention in a room or a conversation that isn't on screen shows a notice of who, where and what, as its sound plays
// (desktop#76).
describe("a mention's notice", () => {
	test("shows who mentioned the user, where, and their text, with the message its MESSAGE_CREATE brought", async () => {
		roomMessage(1);
		mention(1);
		await settle();
		expect(noticeOf(message(1))).toMatchObject({
			link: { spaceId: SPACE, roomId: ROOM, messageId: message(1) },
			authorName: "Ana",
			where: "in #general · Alpha",
			text: `Hey <@${ME}>, look`,
			mentionMap: { [ME]: "me" },
		});
		expect(fetches).toEqual([]);
	});

	test("fetches a message whose MESSAGE_CREATE hasn't come", async () => {
		mention(2, OTHER_ROOM);
		await settle();
		expect(fetches).toEqual([`https://api.test/api/rooms/${OTHER_ROOM}/messages/${message(2)}`]);
		expect(noticeOf(message(2))).toMatchObject({ where: "in #random · Alpha", text: `Fetched <@${ME}>` });
	});

	test("shows once per message", async () => {
		mention(1);
		await settle();
		expect(get(mentionNotices).filter((n) => n.id === message(1))).toHaveLength(1);
	});

	test("shows nothing for the room on screen, nor in do not disturb", async () => {
		stores.activeTextRoomId.set(ROOM);
		roomMessage(3);
		mention(3);
		stores.activeTextRoomId.set(null);
		stores.currentUser.update((user) => user && { ...user, status: 2 });
		roomMessage(4);
		mention(4);
		stores.currentUser.update((user) => user && { ...user, status: 1 });
		await settle();
		expect(noticeOf(message(3))).toBeUndefined();
		expect(noticeOf(message(4))).toBeUndefined();
	});

	test("fetches a message by its IDs alone, as they go into the request's path", async () => {
		fetches.length = 0;
		deliver("MENTION_CREATE", { message_id: "../../users/@me", room_id: ROOM, author_id: ANA });
		deliver("DM_MENTION_CREATE", { message_id: message(31), conversation_id: "..", author_id: ANA });
		await settle();
		expect(fetches).toEqual([]);
	});

	test("shows nothing for a message deleted first, which the API no longer has", async () => {
		mention(5);
		await settle();
		expect(noticeOf(message(5))).toBeUndefined();
	});

	test("goes when its message is deleted, and never shows for one deleted while it was fetched", async () => {
		roomMessage(6);
		mention(6);
		await settle();
		expect(noticeOf(message(6))).toBeDefined();
		deliver("MESSAGE_DELETE", { id: message(6), room_id: ROOM });
		expect(noticeOf(message(6))).toBeUndefined();

		apiMessages.set(message(7), { id: message(7), room_id: ROOM, author_id: ANA, content: "soon gone", user: ana });
		held = { id: message(7), release: () => {} };
		mention(7);
		await settle();
		deliver("MESSAGE_DELETE", { id: message(7), room_id: ROOM });
		held.release();
		await settle();
		expect(noticeOf(message(7))).toBeUndefined();
	});

	test("in a conversation, says a group by its name and a DM as a direct message", async () => {
		deliver("DM_MESSAGE_CREATE", {
			id: message(20),
			conversation_id: GROUP,
			author_id: ANA,
			content: `In the group, <@${ME}>`,
			user: ana,
			created_at: T,
			updated_at: T,
		});
		deliver("DM_MENTION_CREATE", { message_id: message(20), conversation_id: GROUP, author_id: ANA });
		deliver("DM_MENTION_CREATE", { message_id: message(30), conversation_id: DM, author_id: ANA });
		await settle();
		expect(noticeOf(message(20))).toMatchObject({
			link: { conversationId: GROUP, messageId: message(20) },
			authorName: "Ana",
			where: "in Weekend",
		});
		expect(noticeOf(message(30))).toMatchObject({ where: "in a direct message", text: "Fetched in the DM" });
	});

	test("shows nothing for the conversation on screen", async () => {
		stores.activeDMConvId.set(GROUP);
		deliver("DM_MESSAGE_CREATE", { id: message(21), conversation_id: GROUP, author_id: ANA, content: "hi", user: ana });
		deliver("DM_MENTION_CREATE", { message_id: message(21), conversation_id: GROUP, author_id: ANA });
		stores.activeDMConvId.set(null);
		await settle();
		expect(noticeOf(message(21))).toBeUndefined();
	});
});

// A level of nothing silences a place: no notice and no sound for its mentions. A room's own level wins over its
// Space's, and a Space's default of every message still notifies mentions.
describe("a level of nothing", () => {
	test("silences a Space's rooms, but not a room of it with a level of its own", async () => {
		notificationLevels.set({ [SPACE]: 2 });
		roomMessage(70);
		mention(70);
		notificationLevels.set({ [SPACE]: 2, [ROOM]: 1 });
		roomMessage(71);
		mention(71);
		await settle();
		notificationLevels.set({});
		expect(noticeOf(message(70))).toBeUndefined();
		expect(noticeOf(message(71))).toBeDefined();
	});

	test("silences a conversation", async () => {
		notificationLevels.set({ [GROUP]: 2 });
		deliver("DM_MESSAGE_CREATE", {
			id: message(72),
			conversation_id: GROUP,
			author_id: ANA,
			content: `In the group, <@${ME}>`,
			user: ana,
			created_at: T,
			updated_at: T,
		});
		deliver("DM_MENTION_CREATE", { message_id: message(72), conversation_id: GROUP, author_id: ANA });
		await settle();
		notificationLevels.set({});
		expect(noticeOf(message(72))).toBeUndefined();
	});

	test("a Space whose default is every message still notifies its mentions", async () => {
		deliver("SPACE_UPDATE", { id: SPACE, name: "Alpha", default_notifications: 0 });
		roomMessage(73);
		mention(73);
		await settle();
		expect(noticeOf(message(73))).toBeDefined();
	});
});
