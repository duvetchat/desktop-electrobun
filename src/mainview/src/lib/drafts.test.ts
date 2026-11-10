import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import {
	changeDraft,
	chatDrafts,
	draftOf,
	dropReplyTo,
	PUT_BACK_KEPT_MS,
	putBack,
	takeBack,
	threadDraft,
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
		putBack(ROOM, "n1", sent());
		expect(draft(ROOM)).toEqual({ text: RAW, files: [photo], replyTo: reply("m1"), replyMention: false });
		expect(get(chatDrafts)[OTHER_ROOM]).toBeUndefined();
	});

	// #61: a thread's message box has a draft of its own, which its sends come from.
	test("from a thread's draft gives back to it, and its create event takes back from it", () => {
		const thread = threadDraft("01900000-0000-7000-8000-0000000000f1");
		putBack(ROOM, "t1", sent(), thread);
		expect(draft(thread)).toEqual({ text: RAW, files: [photo], replyTo: reply("m1"), replyMention: false });
		expect(get(chatDrafts)[ROOM]).toBeUndefined();
		expect(takeBack(ROOM, "t1")).toBe(true);
		expect(get(chatDrafts)[thread]).toBeUndefined();
	});

	test("puts its files after those the draft has, its text and reply coming back all the same", () => {
		changeDraft(CONVERSATION, { files: [file] });
		putBack(CONVERSATION, "n1", sent());
		expect(draft(CONVERSATION)).toEqual({ text: RAW, files: [file, photo], replyTo: reply("m1"), replyMention: false });
	});

	test("leaves the text written since, and its reply, and gives back its files alone", () => {
		changeDraft(ROOM, { text: "typed since", files: [file], replyTo: reply("m2") });
		putBack(ROOM, "n1", sent());
		expect(draft(ROOM)).toEqual({
			text: "typed since",
			files: [file, photo],
			replyTo: reply("m2"),
			replyMention: true,
		});
	});

	test("leaves a reply picked since, with no text, and gives back its files alone", () => {
		changeDraft(ROOM, { replyTo: reply("m2") });
		putBack(ROOM, "n1", sent());
		expect(draft(ROOM)).toEqual({ text: "", files: [photo], replyTo: reply("m2"), replyMention: true });
	});

	test("takes a draft of blanks for an empty one", () => {
		changeDraft(ROOM, { text: " \n " });
		putBack(ROOM, "n1", sent({ replyTo: null }));
		expect(draft(ROOM)).toEqual({ text: RAW, files: [photo], replyTo: null, replyMention: true });
	});

	test("of files alone gives them back, and the draft's text and @ stay as they were", () => {
		changeDraft(ROOM, { text: "typed since" });
		putBack(ROOM, "n1", sent({ text: "", replyTo: null, replyMention: true }));
		expect(draft(ROOM)).toEqual({ text: "typed since", files: [photo], replyTo: null, replyMention: true });
	});

	test("with nothing to give back changes nothing", () => {
		const before = get(chatDrafts);
		putBack(ROOM, "n1", { text: "", files: [], replyTo: null, replyMention: true });
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

// A message whose Cancel came once the API had its whole body is posted all the same (#211). Its create event takes out
// of the draft what the Cancel put back and is still there as it went, so that sending it can't post the message twice;
// what the user changed since stays.
describe("a cancelled message the API posted all the same", () => {
	const photo = new File(["png"], "photo.png", { type: "image/png" });
	const notes = new File(["txt"], "notes.txt");
	const sent: SentDraft = { text: "fix this", files: [photo, notes], replyTo: reply("m1"), replyMention: false };

	test("takes back what its Cancel put in the draft, and the files the draft had before stay", () => {
		changeDraft(ROOM, { files: [file] });
		putBack(ROOM, "late-1", sent);
		expect(takeBack(ROOM, "late-1")).toBe(true);
		expect(draft(ROOM)).toEqual({ text: "", files: [file], replyTo: null, replyMention: true });
	});

	test("leaves what was changed since: the text, a file marked as a spoiler, the reply's @, a file added", () => {
		putBack(CONVERSATION, "late-2", sent);
		const spoiler = new File([notes], "SPOILER_notes.txt");
		const added = new File(["more"], "more.txt");
		changeDraft(CONVERSATION, { text: "fix this, edited", files: [photo, spoiler, added], replyMention: true });
		expect(takeBack(CONVERSATION, "late-2")).toBe(true);
		expect(draft(CONVERSATION)).toEqual({
			text: "fix this, edited",
			files: [spoiler, added],
			replyTo: reply("m1"),
			replyMention: true,
		});
	});

	test("takes out only what the Cancel put back: the draft's own text and reply stay, the same as the message's too", () => {
		changeDraft(ROOM, { text: "fix this", replyTo: reply("m1"), replyMention: false });
		putBack(ROOM, "late-3", sent);
		expect(takeBack(ROOM, "late-3")).toBe(true);
		expect(draft(ROOM)).toEqual({ text: "fix this", files: [], replyTo: reply("m1"), replyMention: false });
	});

	test("is its own chat's and nonce's, once", () => {
		putBack(ROOM, "late-4", sent);
		expect(takeBack(OTHER_ROOM, "late-4")).toBe(false);
		expect(takeBack(ROOM, "late-5")).toBe(false);
		expect(draft(ROOM).text).toBe("fix this");
		expect(takeBack(ROOM, "late-4")).toBe(true);
		expect(takeBack(ROOM, "late-4")).toBe(false);
	});

	test("is forgotten a few minutes after the Cancel", () => {
		const now = spyOn(Date, "now").mockReturnValue(1_000_000);
		try {
			putBack(ROOM, "late-6", sent);
			putBack(OTHER_ROOM, "late-7", sent);
			now.mockReturnValue(1_000_000 + PUT_BACK_KEPT_MS - 1);
			expect(takeBack(ROOM, "late-6")).toBe(true);
			now.mockReturnValue(1_000_000 + PUT_BACK_KEPT_MS);
			expect(takeBack(OTHER_ROOM, "late-7")).toBe(false);
			expect(draft(OTHER_ROOM).files).toEqual([photo, notes]);
		} finally {
			now.mockRestore();
		}
	});
});
