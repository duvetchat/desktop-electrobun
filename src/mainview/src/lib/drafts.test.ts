import { beforeEach, describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { changeDraft, chatDrafts, draftOf, dropReplyTo, putBackFiles } from "$lib/drafts";
import { MessageType, type Message } from "$lib/types";

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

// A message whose upload was cancelled (#61): its files come back to the chat's draft, as the mobile app's come back to
// its tray, and nothing else of the draft changes.
describe("a cancelled upload's files", () => {
	const photo = new File(["png"], "photo.png", { type: "image/png" });

	test("go back to the chat's draft, after the files it has, its text and reply as they were", () => {
		changeDraft(ROOM, { text: "typed since", files: [file], replyTo: reply("m1") });
		putBackFiles(ROOM, [photo]);
		expect(draft(ROOM)).toEqual({
			text: "typed since",
			files: [file, photo],
			replyTo: reply("m1"),
			replyMention: true,
		});
		expect(get(chatDrafts)[OTHER_ROOM]).toBeUndefined();
	});

	test("make a draft of a chat that had none, with them alone", () => {
		putBackFiles(CONVERSATION, [photo, file]);
		expect(draft(CONVERSATION)).toEqual({ text: "", files: [photo, file], replyTo: null, replyMention: true });
	});

	test("none to put back changes nothing", () => {
		const before = get(chatDrafts);
		putBackFiles(ROOM, []);
		expect(get(chatDrafts)).toBe(before);
	});
});
