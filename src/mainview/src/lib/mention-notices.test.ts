import { afterEach, describe, expect, jest, test } from "bun:test";
import { get } from "svelte/store";
import { richParts } from "$lib/i18n";
import {
	conversationPlace,
	directMessageAuthor,
	dismissMentionNotice,
	dropMentionNotice,
	mentionNoticeOf,
	mentionNotices,
	NOTICE_TIME,
	roomPlace,
	showMentionNotice,
	type MentionNotice,
} from "$lib/mention-notices";
import { ComponentType, MessageType } from "$lib/types";

const ME = "0190a3b2-0000-7000-8000-000000000001";
const ANA = "0190a3b2-0000-7000-8000-000000000002";
const SPACE = "0190a3b2-0000-7000-8000-0000000005a0";
const ROOM = "0190a3b2-0000-7000-8000-0000000005a1";
const DM = "0190a3b2-0000-7000-8000-00000000d001";
const message = (n: number) => `0190a3b2-0000-7000-8000-${String(n).padStart(12, "0")}`;

const spaces = [{ id: SPACE, name: "Alpha", rooms: [{ id: ROOM, name: "general" }] }];
const member = (userId: string, alias: string | null, username: string) => ({
	id: `m-${userId}`,
	conversation_id: DM,
	user_id: userId,
	created_at: "",
	updated_at: "",
	user: { id: userId, username, alias, avatar: null, banner: null },
});

// Where a mention's notice says it was, and the link that opens its message (desktop#76).
describe("where a mention is", () => {
	test("a room's is its room and space, by the spaces the user is in", () => {
		expect(roomPlace(spaces, ROOM, message(1))).toEqual({
			link: { spaceId: SPACE, roomId: ROOM, messageId: message(1) },
			place: "named",
			placeName: "#general · Alpha",
			name: "#general · Alpha",
		});
		expect(roomPlace(spaces, "0190a3b2-0000-7000-8000-0000000005ff", message(1))).toBeNull();
	});

	test("a group's is its name, a DM's says it's a direct message, as its author says who", () => {
		const link = { spaceId: "", roomId: "", messageId: message(1), conversationId: DM };
		const group = {
			id: DM,
			type: 2 as const,
			name: "Weekend",
			members: [member(ME, null, "me"), member(ANA, "Ana", "ana")],
		};
		expect(conversationPlace(group, DM, message(1), ME)).toEqual({
			link,
			place: "named",
			placeName: "Weekend",
			name: "Weekend",
		});
		// A DM's system notification names no place: its author says who (DISENO-NOTIFICACIONES.md, objective 7).
		expect(conversationPlace({ ...group, type: 1 }, DM, message(1), ME)).toEqual({
			link,
			place: "dm",
			placeName: "",
			name: null,
		});
		expect(conversationPlace(undefined, DM, message(1), ME)).toEqual({ link, place: "dm", placeName: "", name: null });
	});

	test("is one sentence with its author, drawn by MentionNotices: the author whole, where after", () => {
		const head = (place: ReturnType<typeof conversationPlace>) =>
			richParts("chat_mention_notice_head", { author: "Ana", place: place.place, name: place.placeName });
		expect(head(roomPlace(spaces, ROOM, message(1))!)).toEqual([
			{ tag: "who", text: "Ana" },
			" ",
			{ tag: "where", text: "in #general · Alpha" },
		]);
		expect(head(conversationPlace(undefined, DM, message(1), ME))).toEqual([
			{ tag: "who", text: "Ana" },
			" ",
			{ tag: "where", text: "in a direct message" },
		]);
	});
});

describe("a mention's notice", () => {
	test("has its author, its text, and the names of whom its text mentions", () => {
		const place = roomPlace(spaces, ROOM, message(1))!;
		const notice = mentionNoticeOf(
			{ id: message(1), author_name: "Ana", author_avatar_url: null, content: `Hey <@${ME}>, **look**` },
			place,
			[{ id: ME, username: "me", alias: "Myself" }],
			{},
		);
		expect(notice).toEqual({
			id: message(1),
			link: place.link,
			authorName: "Ana",
			authorAvatar: null,
			place: "named",
			placeName: "#general · Alpha",
			text: `Hey <@${ME}>, **look**`,
			mentionMap: { [ME]: "Myself" },
			customEmojiMap: {},
		});
	});

	test("takes a components message's text displays, and has none for a message without text", () => {
		const place = roomPlace(spaces, ROOM, message(1))!;
		const v2 = { id: message(1), author_name: "bot", author_avatar_url: null, content: "", flags: 1 << 15 };
		const components = [{ type: ComponentType.TextDisplay, content: `Hi <@${ME}>` }];
		expect(mentionNoticeOf({ ...v2, components }, place, [], {}).text).toBe(`Hi <@${ME}>`);
		expect(mentionNoticeOf({ ...v2, flags: 0, content: null }, place, [], {}).text).toBe("");
	});

	test("names a conversation message's author as the message does, else as the conversation does", () => {
		const conv = { members: [member(ANA, "Ana", "ana")] };
		const dm = { author_id: ANA, type: MessageType.Text };
		expect(
			directMessageAuthor({ ...dm, user: { id: ANA, username: "ana", alias: null, avatar: null, banner: null } }, conv),
		).toEqual({
			name: "ana",
			avatar: null,
		});
		expect(directMessageAuthor(dm, conv)).toEqual({ name: "Ana", avatar: null });
		expect(directMessageAuthor(dm, undefined).name).toBe(ANA.slice(0, 8));
	});
});

describe("the notices showing", () => {
	const notice = (n: number): MentionNotice => ({
		id: message(n),
		link: { spaceId: SPACE, roomId: ROOM, messageId: message(n) },
		authorName: "Ana",
		authorAvatar: null,
		place: "named",
		placeName: "#general · Alpha",
		text: "hi",
		mentionMap: {},
		customEmojiMap: {},
	});
	const shown = () => get(mentionNotices).map((n) => n.id);
	afterEach(() => {
		jest.useRealTimers();
		mentionNotices.set([]);
	});

	test("are the newest first, three at most, each for its time", () => {
		jest.useFakeTimers();
		for (const n of [10, 11, 12, 13]) expect(showMentionNotice(notice(n))).toBe(true);
		expect(shown()).toEqual([message(13), message(12), message(11)]);
		jest.advanceTimersByTime(NOTICE_TIME - 1);
		expect(shown()).toHaveLength(3);
		jest.advanceTimersByTime(1);
		expect(shown()).toEqual([]);
	});

	test("show once per message, whatever comes again", () => {
		expect(showMentionNotice(notice(20))).toBe(true);
		dismissMentionNotice(message(20));
		expect(showMentionNotice(notice(20))).toBe(false);
		expect(shown()).toEqual([]);
	});

	test("a click or ×, or the message's deletion, takes one away; a message deleted first never shows", () => {
		showMentionNotice(notice(30));
		showMentionNotice(notice(31));
		dismissMentionNotice(message(30));
		dropMentionNotice(message(31));
		expect(shown()).toEqual([]);
		dropMentionNotice(message(32));
		expect(showMentionNotice(notice(32))).toBe(false);
		expect(shown()).toEqual([]);
	});
});
