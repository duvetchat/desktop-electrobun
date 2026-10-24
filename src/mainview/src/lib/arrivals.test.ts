import { describe, expect, test } from "bun:test";
import { arrival, arrivalAction, listEnd } from "$lib/arrivals";
import { MessageType, type Message } from "$lib/types";

// The API's IDs are UUIDv7, in time order; a message being sent has its nonce, a random UUID, for an ID.
const id = (n: number) => `01a15f8c-${String(n).padStart(4, "0")}-7000-8000-000000000000`;
const message = (n: number, author = "alice"): Message => ({
	id: id(n),
	content: `message ${n}`,
	type: MessageType.Text,
	author_id: author,
	author_name: author,
	author_avatar_url: null,
	author_is_bot: false,
	created_at: "",
	updated_at: "",
});
const sending = (nonce: string, author = "me"): Message => ({ ...message(0, author), id: nonce, nonce });
// Messages 1 to n, as a room's first page lists them: the newest first.
const page = (from: number, to: number, author?: (n: number) => string) =>
	Array.from({ length: to - from + 1 }, (_, i) => message(to - i, author?.(to - i)));
const arrived = (before: Message[], after: Message[]) => arrival(listEnd(before), listEnd(after));

describe("arrival", () => {
	test("a message from someone else, added at the end", () => {
		const list = page(31, 130);
		const theirs = message(131, "bob");
		expect(arrived(list, [...list, theirs])).toEqual({ message: theirs, sent: false });
	});

	test("a message the user sends from this window", () => {
		const list = page(31, 130);
		const mine = sending("f1d2c3b4-0000-4000-8000-000000000000");
		expect(arrived(list, [...list, mine])).toEqual({ message: mine, sent: true });
	});

	test("a message from someone else while one of the user's is being sent", () => {
		const list = [...page(31, 130), sending("f1d2c3b4-0000-4000-8000-000000000000")];
		const theirs = message(131, "bob");
		expect(arrived(list, [...list, theirs])).toEqual({ message: theirs, sent: false });
	});

	test("the user's message from another device isn't one this window sends", () => {
		const list = page(31, 130);
		const mine = { ...message(131, "me"), nonce: "0c1d2e3f-0000-4000-8000-000000000000" };
		expect(arrived(list, [...list, mine])).toEqual({ message: mine, sent: false });
	});

	test("nor is the user's pin notice", () => {
		const list = page(31, 130);
		const notice = { ...message(131, "me"), type: MessageType.PinNotice, content: "" };
		expect(arrived(list, [...list, notice])).toEqual({ message: notice, sent: false });
	});

	test("not the confirmation of a message being sent, which takes its place", () => {
		const list = page(31, 130);
		const nonce = "f1d2c3b4-0000-4000-8000-000000000000";
		const confirmed = { ...message(131, "me"), nonce };
		expect(arrived([...list, sending(nonce)], [...list, confirmed])).toBeNull();
	});

	test("not older messages, which a room adds after the ones it has", () => {
		// Message 1, the last one of the older page, is the user's: it must not pass for one they sent.
		const list = page(31, 130);
		const older = page(1, 30, (n) => (n === 1 ? "me" : "alice"));
		expect(arrived(list, [...list, ...older])).toBeNull();
	});

	test("not older messages, which a conversation adds before the ones it has", () => {
		const list = [...page(31, 130), message(131, "me")];
		expect(arrived(list, [...page(1, 30), ...list])).toBeNull();
	});

	test("not older messages while a message that failed to send is still listed", () => {
		const list = [...page(31, 130), sending("f1d2c3b4-0000-4000-8000-000000000000")];
		expect(arrived(list, [...list, ...page(1, 30)])).toBeNull();
	});

	test("not the first messages of a list", () => {
		expect(arrived([], page(31, 130))).toBeNull();
	});
});

describe("arrivalAction", () => {
	const list = page(31, 130);
	// What the list does for a message added to it, for a user reading further up or following its bottom.
	const action = (added: Message, following: boolean) => {
		const came = arrived(list, [...list, added]);
		return came && arrivalAction(came, "me", following);
	};
	const fromAnotherDevice = { ...message(131, "me"), nonce: "0c1d2e3f-0000-4000-8000-000000000000" };
	const pinNotice = { ...message(131, "me"), type: MessageType.PinNotice, content: "" };

	test("a message this window sends takes the list down to it, from wherever the user reads", () => {
		const mine = sending("f1d2c3b4-0000-4000-8000-000000000000");
		expect(action(mine, false)).toBe("bottom");
		expect(action(mine, true)).toBe("bottom");
	});

	test("the user's pin notice doesn't move them from further up", () => {
		expect(action(pinNotice, false)).toBeNull();
	});

	test("nor does their message from another device", () => {
		expect(action(fromAnotherDevice, false)).toBeNull();
	});

	test("someone else's message gets the unread divider further up", () => {
		expect(action(message(131, "bob"), false)).toBe("unread");
	});

	test("a list that follows its bottom stays there for any message", () => {
		expect(action(message(131, "bob"), true)).toBe("bottom");
		expect(action(pinNotice, true)).toBe("bottom");
		expect(action(fromAnotherDevice, true)).toBe("bottom");
	});

	// After a jump, the list shows the messages around it, and newer ones load below as the reader scrolls down.
	test("a page that loads below a jump leaves the reader where they are, at its bottom too, with no divider", () => {
		const jump = page(31, 130);
		const below = arrived(jump, [...jump, ...page(131, 230, () => "bob")])!;
		expect(arrivalAction(below, "me", true, true)).toBeNull();
		expect(arrivalAction(below, "me", false, true)).toBeNull();
	});

	test("a message this window sends there still takes the list down to it", () => {
		const mine = sending("f1d2c3b4-0000-4000-8000-000000000000");
		const came = arrived(list, [...list, mine])!;
		expect(arrivalAction(came, "me", false, true)).toBe("bottom");
	});
});
