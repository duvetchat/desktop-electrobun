import { describe, expect, test } from "bun:test";
import {
	CallAnswers,
	callDuration,
	callNoticeCase,
	callNoticeLine,
	callNoticeSeen,
	callNoticeText,
	newestBesidesNotice,
	readAfterCallNotice,
} from "$lib/call-notices";
import { isNotice, MessageType, sentAt, type CallNotice, type Message } from "$lib/types";

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ALICE = "01920000-0000-7000-8000-00000000a11c";
const CAROL = "01920000-0000-7000-8000-0000000ca201";

// A call that started ringing at noon, as the API writes its times (UTC, to the microsecond), and lasted ms; its
// participants are its caller, then whoever joined its voice.
const START = "2026-11-01T12:00:00.000000Z";
const call = (participants: string[], ms = 5 * 60_000): CallNotice => ({
	participants,
	started_at: START,
	ended_at: new Date(Date.parse(START) + ms).toISOString(),
});
const lasting = (ms: number) => callDuration(call([ALICE], ms));
// A call notice as a conversation's list has it: by its caller, named as the list names its author.
const notice = (caller: string, c: CallNotice): Pick<Message, "type" | "author_id" | "author_name" | "call"> => ({
	type: MessageType.Call,
	author_id: caller,
	author_name: caller === ME ? "Me" : "Alice",
	call: c,
});
const says = (n: Pick<Message, "type" | "author_id" | "author_name" | "call">, me: string | undefined) => {
	const line = callNoticeLine(n, me);
	return line && callNoticeText(line);
};

describe("callNoticeCase", () => {
	test("a call others got into, which the reader was in or placed", () => {
		expect(callNoticeCase(call([ALICE, ME]), ALICE, ME)).toBe("in");
		expect(callNoticeCase(call([ME, ALICE]), ME, ME)).toBe("in");
		// A group's call: its caller's, also when they left it before the others.
		expect(callNoticeCase(call([ME, ALICE, CAROL]), ME, ME)).toBe("in");
		expect(callNoticeCase(call([ALICE, CAROL, ME]), ALICE, ME)).toBe("in");
	});

	test("a group's call others got into without the reader", () => {
		expect(callNoticeCase(call([ALICE, CAROL]), ALICE, ME)).toBe("missed");
	});

	test("a call nobody but its caller got into: unanswered for the caller, missed for whoever it rang", () => {
		expect(callNoticeCase(call([ME]), ME, ME)).toBe("unanswered");
		expect(callNoticeCase(call([ALICE]), ALICE, ME)).toBe("missed-unanswered");
	});

	test("a reader it doesn't know missed it", () => {
		expect(callNoticeCase(call([ALICE, CAROL]), ALICE, undefined)).toBe("missed");
		expect(callNoticeCase(call([ALICE]), ALICE, undefined)).toBe("missed-unanswered");
	});
});

describe("callNoticeLine", () => {
	test("a call the reader was in: who called, and how long it lasted", () => {
		expect(says(notice(ALICE, call([ALICE, ME])), ME)).toBe("Alice started a call that lasted 5 minutes.");
		expect(says(notice(ME, call([ME, ALICE])), ME)).toBe("You started a call that lasted 5 minutes.");
	});

	test("a group's call the reader missed while others talked", () => {
		expect(says(notice(ALICE, call([ALICE, CAROL], 12 * 60_000)), ME)).toBe(
			"You missed a call from Alice that lasted 12 minutes.",
		);
	});

	test("a call nobody answered", () => {
		expect(says(notice(ME, call([ME])), ME)).toBe("You started a call. No one answered.");
		expect(says(notice(ALICE, call([ALICE])), ME)).toBe("You missed a call from Alice.");
	});

	test("its phone is red only for the reader who missed it", () => {
		expect(callNoticeLine(notice(ALICE, call([ALICE, ME])), ME)?.missed).toBe(false);
		expect(callNoticeLine(notice(ME, call([ME, ALICE])), ME)?.missed).toBe(false);
		expect(callNoticeLine(notice(ME, call([ME])), ME)?.missed).toBe(false);
		expect(callNoticeLine(notice(ALICE, call([ALICE, CAROL])), ME)?.missed).toBe(true);
		expect(callNoticeLine(notice(ALICE, call([ALICE])), ME)?.missed).toBe(true);
	});

	test("the caller's name stands apart, and the reader's own call says You", () => {
		expect(callNoticeLine(notice(ALICE, call([ALICE, ME])), ME)).toEqual({
			missed: false,
			before: "",
			name: "Alice",
			after: " started a call that lasted 5 minutes.",
		});
		expect(callNoticeLine(notice(ALICE, call([ALICE])), ME)).toEqual({
			missed: true,
			before: "You missed a call from ",
			name: "Alice",
			after: ".",
		});
		expect(callNoticeLine(notice(ME, call([ME, ALICE])), ME)?.name).toBe("");
	});

	test("any other message says nothing of the kind", () => {
		expect(callNoticeLine({ ...notice(ALICE, call([ALICE])), type: MessageType.PinNotice }, ME)).toBeNull();
		expect(callNoticeLine({ ...notice(ALICE, call([ALICE])), type: MessageType.Text }, ME)).toBeNull();
		expect(callNoticeLine({ ...notice(ALICE, call([ALICE])), call: undefined }, ME)).toBeNull();
	});
});

describe("callDuration", () => {
	test("under a minute, a few seconds", () => {
		expect(lasting(0)).toBe("a few seconds");
		expect(lasting(59_999)).toBe("a few seconds");
	});

	test("then whole minutes", () => {
		expect(lasting(60_000)).toBe("1 minute");
		expect(lasting(119_999)).toBe("1 minute");
		expect(lasting(2 * 60_000)).toBe("2 minutes");
		expect(lasting(60 * 60_000 - 1)).toBe("59 minutes");
	});

	test("from an hour, hours and minutes", () => {
		expect(lasting(60 * 60_000)).toBe("1 hour");
		expect(lasting(61 * 60_000)).toBe("1 hour 1 minute");
		expect(lasting(90 * 60_000)).toBe("1 hour 30 minutes");
		expect(lasting(120 * 60_000)).toBe("2 hours");
		expect(lasting(125 * 60_000 + 59_999)).toBe("2 hours 5 minutes");
	});

	test("from the API's times, to the microsecond, its ringing included", () => {
		expect(callDuration({ started_at: "2026-11-01T12:00:00.999999Z", ended_at: "2026-11-01T12:05:00Z" })).toBe(
			"4 minutes",
		);
		expect(callDuration({ started_at: "2026-11-01T12:00:00Z", ended_at: "2026-11-01T13:00:00.000001Z" })).toBe(
			"1 hour",
		);
	});

	test("an end before its start, or times it can't read, are a few seconds", () => {
		expect(callDuration({ started_at: "2026-11-01T12:05:00Z", ended_at: "2026-11-01T12:00:00Z" })).toBe(
			"a few seconds",
		);
		expect(callDuration({ started_at: "", ended_at: "2026-11-01T12:00:00Z" })).toBe("a few seconds");
	});
});

describe("callNoticeSeen", () => {
	test("whoever was in the call saw it: its caller, and whoever joined its voice", () => {
		expect(callNoticeSeen(call([ME, ALICE]), ME, false)).toBe(true);
		expect(callNoticeSeen(call([ME]), ME, false)).toBe(true);
		expect(callNoticeSeen(call([ALICE, ME]), ME, false)).toBe(true);
	});

	test("so did whoever answered it from a device, accepting or declining it, without joining it", () => {
		expect(callNoticeSeen(call([ALICE]), ME, true)).toBe(true);
		expect(callNoticeSeen(call([ALICE, CAROL]), ME, true)).toBe(true);
	});

	test("not whoever it rang who never answered", () => {
		expect(callNoticeSeen(call([ALICE]), ME, false)).toBe(false);
		expect(callNoticeSeen(call([ALICE, CAROL]), ME, false)).toBe(false);
	});
});

describe("CallAnswers", () => {
	const CONV = "01920000-0000-7000-8000-0000000000c1";
	const OTHER_CONV = "01920000-0000-7000-8000-0000000000c2";

	test("the notice of a call the user answered finds the answer, once", () => {
		const answers = new CallAnswers();
		answers.answered(CONV);
		expect(answers.take(OTHER_CONV)).toBe(false);
		expect(answers.take(CONV)).toBe(true);
		expect(answers.take(CONV)).toBe(false);
	});

	test("a new call ringing the user there, or their leaving the group, drops it", () => {
		const answers = new CallAnswers();
		answers.answered(CONV);
		answers.drop(CONV);
		expect(answers.take(CONV)).toBe(false);
	});

	test("a READY that lists the conversation's call still ringing them drops it, one they answered keeps it", () => {
		const answers = new CallAnswers();
		answers.answered(CONV);
		answers.answered(OTHER_CONV);
		answers.ready([
			{ conversation_id: CONV, ringing: true },
			{ conversation_id: OTHER_CONV, ringing: false },
		]);
		expect(answers.take(CONV)).toBe(false);
		expect(answers.take(OTHER_CONV)).toBe(true);
	});

	test("a READY from a gateway that doesn't say whether a call rings drops nothing", () => {
		const answers = new CallAnswers();
		answers.answered(CONV);
		answers.ready([{ conversation_id: CONV }]);
		expect(answers.take(CONV)).toBe(true);
	});
});

describe("readAfterCallNotice", () => {
	// Message IDs are UUIDv7, in time order.
	const id = (n: number) => `01a15f8c-${String(n).padStart(4, "0")}-7000-8000-000000000000`;

	test("a call the user saw leaves the conversation read, up to the notice", () => {
		expect(readAfterCallNotice({ unread: false, lastRead: id(10) }, id(20), true, id(10))).toEqual({
			unread: false,
			lastRead: id(20),
		});
	});

	test("what came before the notice is read with it, as the API moves the read position there", () => {
		expect(readAfterCallNotice({ unread: true, lastRead: id(10) }, id(20), true, id(15))).toEqual({
			unread: false,
			lastRead: id(20),
		});
		// A conversation never read.
		expect(readAfterCallNotice({ unread: true, lastRead: undefined }, id(20), true, id(15))).toEqual({
			unread: false,
			lastRead: id(20),
		});
	});

	test("a notice posted late leaves unread a newer message the user hasn't read", () => {
		expect(readAfterCallNotice({ unread: true, lastRead: id(10) }, id(20), true, id(30))).toEqual({
			unread: true,
			lastRead: id(20),
		});
	});

	test("nor does it move back a read position past it", () => {
		expect(readAfterCallNotice({ unread: false, lastRead: id(30) }, id(20), true, id(30))).toEqual({
			unread: false,
			lastRead: id(30),
		});
	});

	test("a call the user missed makes the conversation unread", () => {
		expect(readAfterCallNotice({ unread: false, lastRead: id(10) }, id(20), false, id(10))).toEqual({
			unread: true,
			lastRead: id(10),
		});
		expect(readAfterCallNotice({ unread: false, lastRead: undefined }, id(20), false, undefined)).toEqual({
			unread: true,
			lastRead: undefined,
		});
	});

	test("unless the user read past it already: a notice posted late", () => {
		expect(readAfterCallNotice({ unread: false, lastRead: id(30) }, id(20), false, id(30))).toEqual({
			unread: false,
			lastRead: id(30),
		});
		expect(readAfterCallNotice({ unread: true, lastRead: id(30) }, id(20), false, id(40))).toEqual({
			unread: true,
			lastRead: id(30),
		});
	});
});

describe("newestBesidesNotice", () => {
	const id = (n: number) => `01a15f8c-${String(n).padStart(4, "0")}-7000-8000-000000000000`;
	const listed = (...ns: number[]) => ns.map((n) => ({ id: id(n) }));

	test("a newer message the client knows of counts, though it never loaded it", () => {
		expect(newestBesidesNotice(id(20), listed(10), id(30))).toBe(id(30));
		expect(newestBesidesNotice(id(20), [], id(30))).toBe(id(30));
	});

	test("a loaded message newer than what it knows of counts: the mark doesn't follow what loads", () => {
		expect(newestBesidesNotice(id(20), listed(10, 40), id(30))).toBe(id(40));
	});

	test("the notice isn't newer than itself, where it's the mark or in the list", () => {
		expect(newestBesidesNotice(id(20), listed(10, 20), id(20))).toBe(id(10));
		expect(newestBesidesNotice(id(20), [], id(20))).toBeUndefined();
		const read = { unread: true, lastRead: id(5) };
		expect(readAfterCallNotice(read, id(20), true, newestBesidesNotice(id(20), listed(10), id(20))).unread).toBe(false);
	});

	test("no entry proves nothing: it goes by the loaded messages", () => {
		expect(newestBesidesNotice(id(20), listed(10, 30), "")).toBe(id(30));
		expect(newestBesidesNotice(id(20), [], "")).toBeUndefined();
	});

	test("a message still being sent isn't known yet: its ID is its nonce", () => {
		expect(newestBesidesNotice(id(20), [{ id: id(90), nonce: id(90) }, ...listed(10)], "")).toBe(id(10));
	});
});

describe("isNotice", () => {
	test("a pin's or a call's notice, which the API posts", () => {
		expect(isNotice({ type: MessageType.PinNotice })).toBe(true);
		expect(isNotice({ type: MessageType.Call })).toBe(true);
	});

	test("not a message someone wrote", () => {
		expect(isNotice({ type: MessageType.Text })).toBe(false);
		expect(isNotice({ type: MessageType.Voice })).toBe(false);
	});
});

describe("sentAt", () => {
	// A call that ended at 12:05, whose notice the API posted at 12:30, after a message sent at 12:10.
	const late = {
		created_at: "2026-11-01T12:30:00.000000Z",
		call: { participants: [ALICE, ME], started_at: START, ended_at: "2026-11-01T12:05:00.000000Z" },
	};
	const before = { created_at: "2026-11-01T11:59:00.000000Z" };
	const after = { created_at: "2026-11-01T12:10:00.000000Z" };

	test("a call notice shows, and sorts, where its call ended, also when the API posted it late", () => {
		expect(sentAt(late)).toBe("2026-11-01T12:05:00.000000Z");
		// As a conversation's list orders what it has, newest first: the late notice came last.
		const shown = [before, after, late].sort((a, b) => Date.parse(sentAt(b)) - Date.parse(sentAt(a)));
		expect(shown).toEqual([after, late, before]);
	});

	test("any other message, when it was created", () => {
		expect(sentAt(after)).toBe("2026-11-01T12:10:00.000000Z");
	});
});
