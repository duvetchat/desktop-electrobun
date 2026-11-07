import { beforeEach, describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import {
	changeDraft,
	chatDrafts,
	draftOf,
	dropReplyTo,
	putBack,
	withoutDeletedReply,
	type SentDraft,
} from "$lib/drafts";
import { MessageType, type Message, type ReferencedMessage } from "$lib/types";

const ROOM = "01900000-0000-7000-8000-000000000a01";
const OTHER_ROOM = "01900000-0000-7000-8000-000000000a02";
const CONVERSATION = "01900000-0000-7000-8000-000000000c01";
const reply = (id: string): Message => ({
	id,
	content: "the message",
	type: MessageType.Text,
	author_id: "alice",
	author_name: "alice",
	author_avatar_url: null,
	author_is_bot: false,
	created_at: "",
	updated_at: "",
});
const file = new File(["hello"], "notes.txt");
const draft = (chatId: string) => draftOf(get(chatDrafts), chatId);

beforeEach(() => chatDrafts.set({}));

describe("a chat's draft", () => {
	test("a chat without one has an empty one, with the reply's @ on", () => {
		expect(draft(ROOM)).toEqual({ text: "", files: [], replyTo: null, replyMention: true });
	});

	test("is that chat's alone, room or conversation", () => {
		changeDraft(ROOM, { text: "for the room" });
		changeDraft(CONVERSATION, { text: "for the conversation" });
		expect(draft(ROOM).text).toBe("for the room");
		expect(draft(CONVERSATION).text).toBe("for the conversation");
		expect(draft(OTHER_ROOM).text).toBe("");
	});

	test("clearing one leaves the others: a send clears only its own chat's", () => {
		changeDraft(ROOM, { text: "sent", files: [file], replyTo: reply("m1") });
		changeDraft(OTHER_ROOM, { text: "still a draft", files: [file], replyTo: reply("m2") });
		changeDraft(ROOM, { text: "", files: [], replyTo: null });
		expect(get(chatDrafts)[ROOM]).toBeUndefined();
		expect(draft(OTHER_ROOM)).toEqual({
			text: "still a draft",
			files: [file],
			replyTo: reply("m2"),
			replyMention: true,
		});
	});

	test("changes in parts: the text leaves its files and reply, and the other way round", () => {
		changeDraft(ROOM, { files: [file] });
		changeDraft(ROOM, { replyTo: reply("m1"), replyMention: false });
		changeDraft(ROOM, { text: "hello" });
		expect(draft(ROOM)).toEqual({ text: "hello", files: [file], replyTo: reply("m1"), replyMention: false });
		changeDraft(ROOM, { text: "" });
		expect(draft(ROOM)).toEqual({ text: "", files: [file], replyTo: reply("m1"), replyMention: false });
	});

	test("a draft left with nothing in it is forgotten, its @ with it", () => {
		changeDraft(ROOM, { replyTo: reply("m1"), replyMention: false });
		changeDraft(ROOM, { replyTo: null });
		expect(get(chatDrafts)).toEqual({});
		expect(draft(ROOM).replyMention).toBe(true);
	});

	test("emptying a chat that has none keeps nothing for it", () => {
		const before = get(chatDrafts);
		changeDraft(ROOM, { text: "" });
		expect(get(chatDrafts)).toBe(before);
	});
});

describe("the message a draft replies to goes", () => {
	test("the draft goes on as no reply, its text and files with it", () => {
		changeDraft(ROOM, { text: "hello", files: [file], replyTo: reply("m1") });
		dropReplyTo(ROOM, "m1");
		expect(draft(ROOM)).toEqual({ text: "hello", files: [file], replyTo: null, replyMention: true });
	});

	test("another message's going, or another chat's, changes nothing", () => {
		changeDraft(ROOM, { replyTo: reply("m1") });
		dropReplyTo(ROOM, "m2");
		dropReplyTo(OTHER_ROOM, "m1");
		expect(draft(ROOM).replyTo?.id).toBe("m1");
	});

	test("a draft that was only that reply is forgotten", () => {
		changeDraft(ROOM, { replyTo: reply("m1") });
		dropReplyTo(ROOM, "m1");
		expect(get(chatDrafts)).toEqual({});
	});
});

// A message whose upload was cancelled (#61, #210): what it took from its chat's draft comes back. Its files after those
// the draft has, as the mobile app's come back to its tray; its text and its reply, with the reply bar's @, while the
// draft has neither, so a Cancel to fix the message leaves nothing to type or pick again.
describe("a cancelled send", () => {
	const photo = new File(["png"], "photo.png", { type: "image/png" });
	// As the API takes it: a mention and a custom emoji by their IDs.
	const RAW = "fix <@01900000-0000-7000-8000-0000000000a1> <:01900000-0000-7000-8000-00000000e101:> 🎉";
	const sent = (change: Partial<SentDraft> = {}): SentDraft => ({
		text: RAW,
		files: [photo],
		replyTo: reply("m1"),
		replyMention: false,
		...change,
	});

	test("gives its text, raw, and its reply with its @ back with its files, to a draft that has neither", () => {
		putBack(ROOM, sent());
		expect(draft(ROOM)).toEqual({ text: RAW, files: [photo], replyTo: reply("m1"), replyMention: false });
		expect(get(chatDrafts)[OTHER_ROOM]).toBeUndefined();
	});

	test("puts its files after those the draft has, its text and reply coming back all the same", () => {
		changeDraft(CONVERSATION, { files: [file] });
		putBack(CONVERSATION, sent());
		expect(draft(CONVERSATION)).toEqual({ text: RAW, files: [file, photo], replyTo: reply("m1"), replyMention: false });
	});

	test("leaves the text written since, and its reply, and gives back its files alone", () => {
		changeDraft(ROOM, { text: "typed since", files: [file], replyTo: reply("m2") });
		putBack(ROOM, sent());
		expect(draft(ROOM)).toEqual({
			text: "typed since",
			files: [file, photo],
			replyTo: reply("m2"),
			replyMention: true,
		});
	});

	test("leaves a reply picked since, with no text, and gives back its files alone", () => {
		changeDraft(ROOM, { replyTo: reply("m2") });
		putBack(ROOM, sent());
		expect(draft(ROOM)).toEqual({ text: "", files: [photo], replyTo: reply("m2"), replyMention: true });
	});

	test("takes a draft of blanks for an empty one", () => {
		changeDraft(ROOM, { text: " \n " });
		putBack(ROOM, sent({ replyTo: null }));
		expect(draft(ROOM)).toEqual({ text: RAW, files: [photo], replyTo: null, replyMention: true });
	});

	test("of files alone gives them back, and the draft's text and @ stay as they were", () => {
		changeDraft(ROOM, { text: "typed since" });
		putBack(ROOM, sent({ text: "", replyTo: null, replyMention: true }));
		expect(draft(ROOM)).toEqual({ text: "typed since", files: [photo], replyTo: null, replyMention: true });
	});

	test("with nothing to give back changes nothing", () => {
		const before = get(chatDrafts);
		putBack(ROOM, { text: "", files: [], replyTo: null, replyMention: true });
		expect(get(chatDrafts)).toBe(before);
	});
});

// The API refuses a reply to a deleted message: a Cancel doesn't give back a reply whose message went meanwhile, which
// the send's copy in the list says by its quote, as MESSAGE_DELETE leaves it without a date.
describe("a cancelled send's reply", () => {
	const quote = (messageId: string, createdAt?: string): ReferencedMessage => ({
		type: 0,
		message_id: messageId,
		room_id: ROOM,
		space_id: null,
		...(createdAt ? { created_at: createdAt } : {}),
	});
	const sent: SentDraft = { text: "hi", files: [], replyTo: reply("m1"), replyMention: true };

	test("comes back while the send's copy quotes its message", () => {
		expect(withoutDeletedReply(sent, { referenced_message: quote("m1", "2026-11-07T10:00:00Z") })).toBe(sent);
	});

	test("doesn't once the copy's quote says its message is deleted", () => {
		expect(withoutDeletedReply(sent, { referenced_message: quote("m1") })).toEqual({ ...sent, replyTo: null });
	});

	test("a copy without a quote, or with another message's, says nothing about it", () => {
		expect(withoutDeletedReply(sent, { referenced_message: null })).toBe(sent);
		expect(withoutDeletedReply(sent, { referenced_message: quote("m2") })).toBe(sent);
	});
});
