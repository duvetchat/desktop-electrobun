import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import type { MentionNotice } from "$lib/mention-notices";

// A mention plays the notification sound through an <audio>, which Bun has none of.
class FakeAudio {
	// Each sound played, counted: a message plays its sound once.
	static plays = 0;
	volume = 1;
	currentTime = 0;
	play() {
		FakeAudio.plays++;
		return Promise.resolve();
	}
}
Object.assign(globalThis, { Audio: FakeAudio });

const stores = await import("$lib/stores.svelte");
const { mentionNotices } = await import("$lib/mention-notices");
const { notificationLevels } = await import("$lib/notification-levels");
const { showChat } = await import("$lib/on-screen");
const { setSystemNotifier } = await import("$lib/api/ws/connection");
const { startTabCoordination } = await import("$lib/tab-notifications");
const { audioStore } = await import("$lib/stores/audio.svelte");

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
			place: "named",
			placeName: "#general · Alpha",
			text: `Hey <@${ME}>, look`,
			mentionMap: { [ME]: "me" },
		});
		expect(fetches).toEqual([]);
	});

	test("fetches a message whose MESSAGE_CREATE hasn't come", async () => {
		mention(2, OTHER_ROOM);
		await settle();
		expect(fetches).toEqual([`https://api.test/api/rooms/${OTHER_ROOM}/messages/${message(2)}`]);
		expect(noticeOf(message(2))).toMatchObject({ placeName: "#random · Alpha", text: `Fetched <@${ME}>` });
	});

	test("shows once per message", async () => {
		mention(1);
		await settle();
		expect(get(mentionNotices).filter((n) => n.id === message(1))).toHaveLength(1);
	});

	test("shows nothing for the room on screen, nor in do not disturb", async () => {
		const hide = showChat(ROOM);
		roomMessage(3);
		mention(3);
		hide();
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
			place: "named",
			placeName: "Weekend",
		});
		// A conversation's text is the device's alone, never what the API serves (task 20's review, I1): here, none.
		expect(noticeOf(message(30))).toMatchObject({ place: "dm", placeName: "", text: "" });
	});

	test("shows nothing for the conversation on screen", async () => {
		const hide = showChat(GROUP);
		deliver("DM_MESSAGE_CREATE", { id: message(21), conversation_id: GROUP, author_id: ANA, content: "hi", user: ana });
		deliver("DM_MENTION_CREATE", { message_id: message(21), conversation_id: GROUP, author_id: ANA });
		hide();
		await settle();
		expect(noticeOf(message(21))).toBeUndefined();
	});

	// Every pane's chat is on screen, not only the one whose effect last wrote activeTextRoomId (a split's second pane).
	test("shows nothing for a room a second pane shows", async () => {
		stores.activeTextRoomId.set(OTHER_ROOM);
		const hide = showChat(ROOM);
		roomMessage(8);
		mention(8);
		hide();
		stores.activeTextRoomId.set(null);
		await settle();
		expect(noticeOf(message(8))).toBeUndefined();
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

// An ordinary message notifies in a place at every message, as a mention does anywhere but at nothing: one notice and
// one sound per message, whichever of its two events comes first (DISENO-NOTIFICACIONES.md, objectives 3 and 5).
describe("ordinary messages", () => {
	// A Space on its default of only mentions, and no level of the user's own.
	function onDefaults() {
		notificationLevels.set({});
		deliver("SPACE_UPDATE", { id: SPACE, name: "Alpha", default_notifications: 1 });
	}
	const others = { room_id: ROOM, author_id: ANA, user: ana, created_at: T, updated_at: T };
	// A system notifier that keeps what it's asked to show, and answers whether it showed it.
	const systemNotifier = (
		keep: (notice: MentionNotice, place: string | null, silent: boolean) => void,
		shows = true,
	) => ({
		available: () => true,
		show: async (notice: MentionNotice, place: string | null, silent: boolean) => {
			keep(notice, place, silent);
			return shows;
		},
	});

	test("in a room at every message, someone's message shows a notice and plays the sound once", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		const before = FakeAudio.plays;
		roomMessage(80, ROOM, "Plain words");
		await settle();
		expect(noticeOf(message(80))).toMatchObject({ placeName: "#general · Alpha", text: "Plain words" });
		expect(FakeAudio.plays - before).toBe(1);
	});

	test("at only mentions, a message that mentions nobody notifies nothing", async () => {
		onDefaults();
		const before = FakeAudio.plays;
		roomMessage(81, ROOM, "Plain words");
		await settle();
		expect(noticeOf(message(81))).toBeUndefined();
		expect(FakeAudio.plays).toBe(before);
	});

	test("the user's own messages, Duvet's notices and ephemeral messages notify nothing", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		const before = FakeAudio.plays;
		const me = { id: ME, username: "me", alias: null, avatar: null, banner: null };
		deliver("MESSAGE_CREATE", { ...others, id: message(82), author_id: ME, user: me, content: "Mine" });
		deliver("MESSAGE_CREATE", { ...others, id: message(83), type: 2, content: "" });
		deliver("MESSAGE_CREATE", { ...others, id: message(84), flags: 1 << 6, content: "Just for you" });
		await settle();
		for (const n of [82, 83, 84]) expect(noticeOf(message(n))).toBeUndefined();
		expect(FakeAudio.plays).toBe(before);
	});

	test("a mention at every message notifies once, whichever of its events comes first", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		const before = FakeAudio.plays;
		roomMessage(85);
		mention(85);
		apiMessages.set(message(86), { id: message(86), room_id: ROOM, author_id: ANA, content: "Again", user: ana });
		mention(86);
		roomMessage(86, ROOM, "Again");
		await settle();
		expect(get(mentionNotices).filter((n) => n.id === message(85) || n.id === message(86))).toHaveLength(2);
		expect(FakeAudio.plays - before).toBe(2);
	});

	test("do not disturb notifies nothing", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		stores.currentUser.update((user) => user && { ...user, status: 2 });
		const before = FakeAudio.plays;
		roomMessage(87, ROOM, "Plain words");
		stores.currentUser.update((user) => user && { ...user, status: 1 });
		await settle();
		expect(noticeOf(message(87))).toBeUndefined();
		expect(FakeAudio.plays).toBe(before);
	});

	test("without the focus, the system's notification shows instead of Duvet's notice; without one, the notice", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		const system: [string, string | null][] = [];
		setSystemNotifier(systemNotifier((notice, place) => system.push([notice.id, place])));
		stores.pageVisible.set(false);
		const before = FakeAudio.plays;
		roomMessage(88, ROOM, "Plain words");
		await settle();
		expect(system).toEqual([[message(88), "#general · Alpha"]]);
		expect(noticeOf(message(88))).toBeUndefined();
		expect(FakeAudio.plays - before).toBe(1);

		setSystemNotifier(null);
		roomMessage(89, ROOM, "Plain words");
		await settle();
		stores.pageVisible.set(true);
		expect(noticeOf(message(89))).toBeDefined();
	});

	test("a DM notifies every message by default, and its system notification names no place", async () => {
		onDefaults();
		const system: [string, string | null][] = [];
		setSystemNotifier(systemNotifier((notice, place) => system.push([notice.id, place])));
		stores.pageVisible.set(false);
		deliver("DM_MESSAGE_CREATE", {
			id: message(90),
			conversation_id: DM,
			author_id: ANA,
			content: "Hi there",
			user: ana,
			created_at: T,
			updated_at: T,
		});
		await settle();
		setSystemNotifier(null);
		stores.pageVisible.set(true);
		expect(system).toEqual([[message(90), null]]);
	});

	// Chromium (WebView2 too) lets a page play a sound only once it's been clicked or typed in: Duvet opened and
	// minimized without a click had its sound refused, and its toasts came silent.
	test("before the page's first click, the system notification makes the sound, and Duvet's plays none", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		const system: [string, boolean][] = [];
		setSystemNotifier(systemNotifier((notice, _, silent) => system.push([notice.id, silent])));
		stores.pageVisible.set(false);
		const before = FakeAudio.plays;
		Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true });
		roomMessage(92, ROOM, "Plain words");
		await settle();
		Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });
		roomMessage(93, ROOM, "Plain words");
		await settle();
		Reflect.deleteProperty(navigator, "userActivation");
		setSystemNotifier(null);
		stores.pageVisible.set(true);
		expect(system).toEqual([
			[message(92), false],
			[message(93), true],
		]);
		expect(FakeAudio.plays - before).toBe(1);
	});

	test("with the notifications' sound turned off, the system notification stays silent before the first click too", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		const silent: boolean[] = [];
		setSystemNotifier(systemNotifier((_notice, _place, quiet) => silent.push(quiet)));
		stores.pageVisible.set(false);
		const volume = audioStore.get("notification");
		audioStore.set("notification", 0);
		Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true });
		roomMessage(94, ROOM, "Plain words");
		await settle();
		Reflect.deleteProperty(navigator, "userActivation");
		audioStore.set("notification", volume);
		setSystemNotifier(null);
		stores.pageVisible.set(true);
		expect(silent).toEqual([true]);
	});

	// The web's notifier can show one only while the browser lets it, which can change in another tab or in the site's
	// settings: it's asked as each message notifies.
	test("a system notification that can't show now, a browser's without its permission, leaves Duvet's notice", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		const system: string[] = [];
		setSystemNotifier({ ...systemNotifier((notice) => system.push(notice.id)), available: () => false });
		stores.pageVisible.set(false);
		roomMessage(95, ROOM, "Plain words");
		await settle();
		setSystemNotifier(null);
		stores.pageVisible.set(true);
		expect(system).toEqual([]);
		expect(noticeOf(message(95))).toBeDefined();
	});

	// Bun couldn't show the toast (its helper failed, or toasts weren't set up), or a browser refused the notification.
	test("a system notification that couldn't show leaves Duvet's notice instead", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		setSystemNotifier(systemNotifier(() => {}, false));
		stores.pageVisible.set(false);
		roomMessage(96, ROOM, "Plain words");
		await settle();
		setSystemNotifier(null);
		stores.pageVisible.set(true);
		expect(noticeOf(message(96))).toBeDefined();
	});

	test("... unless its message was deleted while the system tried", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		let answer: (shown: boolean) => void = () => {};
		setSystemNotifier({ available: () => true, show: () => new Promise<boolean>((resolve) => (answer = resolve)) });
		stores.pageVisible.set(false);
		roomMessage(97, ROOM, "Plain words");
		await settle();
		deliver("MESSAGE_DELETE", { id: message(97), room_id: ROOM });
		answer(false);
		await settle();
		setSystemNotifier(null);
		stores.pageVisible.set(true);
		expect(noticeOf(message(97))).toBeUndefined();
	});

	// One browser tab notifies (lib/tab-notifications.ts): this one, without the focus, while another holds the lock.
	test("a tab that doesn't act neither shows nor plays", async () => {
		onDefaults();
		notificationLevels.set({ [ROOM]: 0 });
		stores.pageVisible.set(false);
		const stop = startTabCoordination({
			locks: { request: () => new Promise(() => {}) },
			channel: { onmessage: null, postMessage() {}, close() {} },
			id: "this tab",
		});
		const before = FakeAudio.plays;
		roomMessage(91, ROOM, "Plain words");
		await settle();
		stop();
		stores.pageVisible.set(true);
		expect(noticeOf(message(91))).toBeUndefined();
		expect(FakeAudio.plays).toBe(before);
	});
});
