import { describe, expect, test } from "bun:test";
import {
	dividerPastWindow,
	inWindow,
	keepJump,
	leaving,
	loadedTo,
	quoteJump,
	readWhenLeft,
	takeJump,
	withPresent,
} from "$lib/jumps";

const QUOTED = "01920000-0000-7000-8000-0000000000aa";
const CONVERSATION = "01920000-0000-7000-8000-0000000c0c0c";
const SPACE = "01920000-0000-7000-8000-00000005ace0";
const ROOM = "01920000-0000-7000-8000-0000000003a0";

describe("quoteJump", () => {
	test("a conversation's quote jumps in the conversation, which its view handles", () => {
		// A conversation's reference has no room or space, and its list no space: its channel is the conversation.
		expect(
			quoteJump({ message_id: QUOTED, room_id: null, space_id: null }, { spaceId: "", channelId: CONVERSATION }),
		).toStrictEqual({ spaceId: "", roomId: "", messageId: QUOTED, conversationId: CONVERSATION });
	});

	test("a room's quote jumps in the room its reference names, with no conversation", () => {
		expect(
			quoteJump({ message_id: QUOTED, room_id: ROOM, space_id: SPACE }, { spaceId: SPACE, channelId: ROOM }),
		).toStrictEqual({ spaceId: SPACE, roomId: ROOM, messageId: QUOTED });
	});

	test("a room's reference without its room or space falls back to the list's", () => {
		expect(
			quoteJump({ message_id: QUOTED, room_id: null, space_id: null }, { spaceId: SPACE, channelId: ROOM }),
		).toStrictEqual({ spaceId: SPACE, roomId: ROOM, messageId: QUOTED });
	});

	test("a quote that names no message jumps nowhere", () => {
		expect(
			quoteJump({ message_id: null, room_id: null, space_id: null }, { spaceId: "", channelId: CONVERSATION }),
		).toBe(null);
		expect(quoteJump({ message_id: null, room_id: ROOM, space_id: SPACE }, { spaceId: SPACE, channelId: ROOM })).toBe(
			null,
		);
	});
});

describe("readWhenLeft", () => {
	// A conversation's messages in order: m(1) is the oldest. A jump to an old one loaded the pages up to m(120), with
	// newer ones still to load below; the conversation's newest was m(400) then.
	const m = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
	const jumped = { moreBelow: true, loadedBelowTo: m(120) };

	test("a list up to the newest message is read once that message is acked or the read position covers it", () => {
		const list = { newest: m(400), moreBelow: false, loadedBelowTo: "" };
		expect(readWhenLeft(list, m(400), m(350))).toBe(true);
		expect(readWhenLeft(list, undefined, m(400))).toBe(true);
		expect(readWhenLeft(list, undefined, m(350))).toBe(false);
		expect(readWhenLeft(list, undefined, undefined)).toBe(false);
	});

	test("a jump's pages, with newer messages still below, are no sign of reading those, even under the read position", () => {
		expect(readWhenLeft({ newest: m(120), ...jumped }, undefined, m(350))).toBe(false);
		expect(readWhenLeft({ newest: m(120), ...jumped }, m(120), m(350))).toBe(false);
	});

	test("a seen call's notice that came during the jump, which moved the read position to it, leaves it read", () => {
		// The notice is the conversation's newest message, listed after the jump's pages.
		expect(readWhenLeft({ newest: m(401), ...jumped }, undefined, m(401))).toBe(true);
	});

	test("another member's message that came during the jump leaves it unread", () => {
		expect(readWhenLeft({ newest: m(401), ...jumped }, undefined, m(350))).toBe(false);
	});
});

describe("loadedTo", () => {
	// A room's or a conversation's messages in order: m(1) is the oldest.
	const m = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
	const page = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: m(from + i) }));

	test("a jump's pages, then each page below, move it to their newest message", () => {
		// A jump to 30 loads 31 to 130 below it; the next page is 131 to 230.
		const afterJump = loadedTo(m(30), page(31, 130));
		expect(afterJump).toBe(m(130));
		expect(loadedTo(afterJump, page(131, 230))).toBe(m(230));
	});

	test("a page in any order: its newest message", () => {
		expect(loadedTo(m(130), [{ id: m(180) }, { id: m(230) }, { id: m(131) }])).toBe(m(230));
	});

	test("an empty page (nothing newer) leaves it where it was", () => {
		expect(loadedTo(m(130), [])).toBe(m(130));
	});
});

describe("inWindow", () => {
	const m = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
	const message = (n: number) => ({ id: m(n) });
	// A message being sent has its nonce, a random UUID, for an ID: it sorts above the API's.
	const sending = { id: "f1d2c3b4-0000-4000-8000-000000000000", nonce: "f1d2c3b4-0000-4000-8000-000000000000" };

	test("a message that came live past the jump's pages waits for the pages below to reach it", () => {
		const jump = [message(29), message(30), message(130)];
		expect(inWindow([...jump, message(401)], m(130))).toEqual(jump);
	});

	test("a message being sent shows, as it takes the reader to the present", () => {
		const jump = [message(30), message(130)];
		expect(inWindow([...jump, sending], m(130))).toEqual([...jump, sending]);
	});

	test("a list that isn't a jump's shows everything, as it is", () => {
		const list = [message(300), message(401)];
		expect(inWindow(list, "")).toBe(list);
		expect(inWindow(list, m(401))).toBe(list);
	});
});

describe("withPresent", () => {
	const m = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
	const page = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: m(from + i) }));
	const sending = { id: "f1d2c3b4-0000-4000-8000-000000000000", nonce: "f1d2c3b4-0000-4000-8000-000000000000" };

	test("the jump's pages give way to the newest page, with the message being sent", () => {
		const jump = page(1, 130);
		expect(withPresent([...jump, sending], page(201, 300))).toEqual([...page(201, 300), sending]);
	});

	test("a message being sent that the page lists already (its files still going up) shows once, as being sent", () => {
		const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 12, minute)).toISOString();
		const message = (n: number, author: string, content: string) => ({
			id: m(n),
			author_id: author,
			content,
			created_at: at(n % 60),
		});
		const nonce = "f1d2c3b4-0000-4000-8000-000000000000";
		const mine = { id: nonce, nonce, author_id: "me", content: "hello", created_at: at(59) };
		// The API's copy of it, without the nonce; and the same text the user sent 50 minutes earlier, which is no copy.
		const copy = message(299, "me", "hello");
		const earlier = message(249, "me", "hello");
		const newest = [earlier, message(298, "alice", "hi"), copy];
		expect(withPresent([message(30, "alice", "old"), mine], newest)).toEqual([
			earlier,
			message(298, "alice", "hi"),
			mine,
		]);
	});

	test("what came after the newest page was cut stays, each message once", () => {
		// 301 came live while the newest page was asked for; 300 is both in the list and in the page.
		const current = [...page(1, 130), { id: m(300) }, { id: m(301) }];
		expect(withPresent(current, page(201, 300))).toEqual([...page(201, 300), { id: m(301) }]);
	});
});

describe("dividerPastWindow", () => {
	// A jump to 20 loaded up to 120, with newer messages still below; the user read up to 400.
	const m = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
	const from = (n: number, author: string) => ({ id: m(n), author_id: author });
	const jump = [from(20, "alice"), from(120, "me")];

	test("another member's message past the jump's pages puts the divider after the read position", () => {
		expect(dividerPastWindow([...jump, from(401, "alice")], m(120), "me", m(400))).toBe(m(400));
	});

	test("in a conversation never read, above everything", () => {
		expect(dividerPastWindow([...jump, from(401, "alice")], m(120), "me", undefined)).toBe("0");
	});

	test("the user's own message, one still being sent, or one the read position covers sets none", () => {
		const sending = {
			id: "f1d2c3b4-0000-4000-8000-000000000000",
			nonce: "f1d2c3b4-0000-4000-8000-000000000000",
			author_id: "me",
		};
		expect(dividerPastWindow([...jump, from(401, "me")], m(120), "me", m(400))).toBeNull();
		expect(dividerPastWindow([...jump, sending], m(120), "me", m(400))).toBeNull();
		// A call's notice of a call the user saw: the read position moved to it.
		expect(dividerPastWindow([...jump, from(401, "alice")], m(120), "me", m(401))).toBeNull();
	});

	test("the jump's own pages, history the reader scrolls into, set none", () => {
		expect(dividerPastWindow([...jump, from(100, "alice")], m(120), "me", m(10))).toBeNull();
	});
});

describe("leaving", () => {
	// A room or conversation read up to 100 (its divider there); a jump to 60 loaded up to 160, newer messages below.
	const m = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
	const window = { newest: m(160), moreBelow: true, loadedBelowTo: m(160) };

	test("the bottom of a jump's pages, with newer messages below, acks nothing and stays unread", () => {
		expect(leaving({ atBottom: true, ...window }, m(100), undefined, m(100))).toEqual({ ack: false, unread: true });
	});

	test("the bottom of a list that reaches the newest message acks it, and the divider goes", () => {
		const list = { atBottom: true, newest: m(400), moreBelow: false, loadedBelowTo: "" };
		expect(leaving(list, m(100), undefined, m(100))).toEqual({ ack: true, unread: false });
	});

	test("a list left above its bottom acks nothing, and an unread one stays so", () => {
		const list = { atBottom: false, newest: m(400), moreBelow: false, loadedBelowTo: "" };
		expect(leaving(list, m(100), undefined, m(100))).toEqual({ ack: false, unread: true });
		expect(leaving(list, null, undefined, m(100))).toEqual({ ack: false, unread: false });
	});

	test("one acked at its newest message earlier in the visit is read", () => {
		const list = { atBottom: false, newest: m(400), moreBelow: false, loadedBelowTo: "" };
		expect(leaving(list, m(100), m(400), m(100))).toEqual({ ack: false, unread: false });
	});
});

describe("keepJump and takeJump", () => {
	// A jump to 20 loaded up to 220 (one page below already), newer messages still below, as its view went.
	const m = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
	const list = Array.from({ length: 220 }, (_, i) => ({ id: m(i + 1) }));
	const kept = { hasMore: false, loadedBelowTo: m(220) };

	test("the view shown again goes on from the jump's pages, once", () => {
		keepJump("a", kept);
		expect(takeJump("a", list)).toEqual(kept);
		expect(takeJump("a", list)).toBeNull();
	});

	test("a list that lost the jump's pages meanwhile starts again from the newest page", () => {
		keepJump("b", kept);
		expect(takeJump("b", undefined)).toBeNull();
		keepJump("b", kept);
		expect(takeJump("b", list.slice(0, 120))).toBeNull();
	});

	test("a list that reached the present keeps nothing", () => {
		keepJump("c", kept);
		keepJump("c", null);
		expect(takeJump("c", list)).toBeNull();
	});
});
