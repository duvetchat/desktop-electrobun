import { describe, expect, test } from "bun:test";
import { clockTime, dayLabel, groupShapes, headTime, joinsPrevious, sameDay, shortClockTime } from "./message-groups";
import { MessageFlag, MessageType, type Message } from "$lib/types";

// The system's languages: the first says how its clock writes a message's time, whatever the app's language. None
// until a test sets them, and then the runtime's own.
const system = (...languages: string[]) =>
	Object.defineProperty(globalThis.navigator, "languages", { value: languages, configurable: true });

// Local times, so the days are this machine's whatever its zone.
const at = (day: number, hour: number, minute: number, second = 0) =>
	new Date(2026, 10, day, hour, minute, second).toISOString();
const from = (author: string, created: string, more: Partial<Message> = {}): Message => ({
	id: `${author}-${created}`,
	content: "hello",
	author_id: author,
	author_name: author,
	author_avatar_url: null,
	author_is_bot: false,
	created_at: created,
	updated_at: created,
	type: MessageType.Text,
	...more,
});
const quoted: NonNullable<Message["referenced_message"]> = {
	type: 0,
	message_id: "m",
	room_id: null,
	space_id: null,
	content: "the one before",
	author_id: "bob",
	author_name: "bob",
	author_avatar: null,
	created_at: at(10, 8, 0),
};

describe("a group of messages", () => {
	test("is one author's, each no more than five minutes after the one before", () => {
		expect(joinsPrevious(from("ana", at(10, 9, 0)), from("ana", at(10, 9, 5)))).toBe(true);
		expect(joinsPrevious(from("ana", at(10, 9, 0)), from("ana", at(10, 9, 5, 1)))).toBe(false);
		expect(joinsPrevious(from("ana", at(10, 9, 0)), from("bob", at(10, 9, 1)))).toBe(false);
	});

	test("the five minutes are counted from the message before, not from the group's first", () => {
		const a = from("ana", at(10, 9, 0));
		const b = from("ana", at(10, 9, 4));
		const c = from("ana", at(10, 9, 8));
		expect(joinsPrevious(a, b)).toBe(true);
		expect(joinsPrevious(b, c)).toBe(true);
	});

	test("ends at midnight: the next day's first message starts its own, under that day's separator", () => {
		expect(joinsPrevious(from("ana", at(10, 23, 58)), from("ana", at(11, 0, 1)))).toBe(false);
		expect(joinsPrevious(from("ana", at(11, 0, 1)), from("ana", at(11, 0, 3)))).toBe(true);
	});

	test("starts with the first message of a chat", () => {
		expect(joinsPrevious(undefined, from("ana", at(10, 9, 0)))).toBe(false);
	});

	test("isn't joined across the new-messages line", () => {
		expect(joinsPrevious(from("ana", at(10, 9, 0)), from("ana", at(10, 9, 1)), true)).toBe(false);
	});

	test("a notice breaks it, on either side", () => {
		const pin = from("ana", at(10, 9, 0), { type: MessageType.PinNotice });
		expect(joinsPrevious(pin, from("ana", at(10, 9, 1)))).toBe(false);
		expect(joinsPrevious(from("ana", at(10, 9, 0)), from("ana", at(10, 9, 1), { type: MessageType.Call }))).toBe(false);
	});

	test("a reply and a bot's answer to an interaction each start one", () => {
		const reply = from("ana", at(10, 9, 1), { referenced_message: quoted });
		expect(joinsPrevious(from("ana", at(10, 9, 0)), reply)).toBe(false);
		const answer = from("bot", at(10, 9, 1), {
			interaction_metadata: {
				id: "i",
				type: 2,
				name: "roll",
				user: { id: "ana", username: "ana", alias: null, avatar: null },
			},
		});
		expect(joinsPrevious(from("bot", at(10, 9, 0)), answer)).toBe(false);
	});

	test("a bot's messages to the user alone group apart from the room's", () => {
		const ephemeral = from("bot", at(10, 9, 1), { flags: MessageFlag.Ephemeral });
		expect(joinsPrevious(from("bot", at(10, 9, 0)), ephemeral)).toBe(false);
		expect(joinsPrevious(ephemeral, from("bot", at(10, 9, 2), { flags: MessageFlag.Ephemeral }))).toBe(true);
	});

	test("a webhook's messages under another name start a new one", () => {
		const first = from("hook", at(10, 9, 0), { author_name: "Tide table" });
		expect(joinsPrevious(first, from("hook", at(10, 9, 1), { author_name: "Harbour log" }))).toBe(false);
	});
});

describe("a list's groups, newest first", () => {
	const flags = (shapes: ReturnType<typeof groupShapes>) =>
		shapes.map((s) => `${s.first ? "F" : "-"}${s.last ? "L" : "-"}${s.newDay ? "D" : "-"}`);

	test("a group's first and last are marked, and each day's first message", () => {
		const list = [
			from("bob", at(11, 0, 2)),
			from("ana", at(11, 0, 1)),
			from("ana", at(10, 23, 59)),
			from("ana", at(10, 23, 58)),
			from("ana", at(10, 23, 57)),
		];
		// bob alone; ana after midnight alone, on a new day; then ana's three of the day before, oldest first of them.
		expect(flags(groupShapes(list))).toEqual(["FL-", "FLD", "-L-", "---", "F-D"]);
	});

	test("the new-messages line splits a group in two", () => {
		const list = [from("ana", at(10, 9, 3)), from("ana", at(10, 9, 2)), from("ana", at(10, 9, 1))];
		expect(flags(groupShapes(list))).toEqual(["-L-", "---", "F-D"]);
		// Two unread: the line sits above the second.
		expect(flags(groupShapes(list, 2))).toEqual(["-L-", "F--", "FLD"]);
		// All of them unread, or none: no line among them.
		expect(flags(groupShapes(list, 3))).toEqual(["-L-", "---", "F-D"]);
		expect(flags(groupShapes(list, 0))).toEqual(["-L-", "---", "F-D"]);
	});

	test("agrees with joinsPrevious on every pair", () => {
		const list = [
			from("ana", at(10, 9, 20)),
			from("ana", at(10, 9, 14, 1)),
			from("ana", at(10, 9, 9)),
			from("bob", at(10, 9, 8)),
			from("ana", at(10, 9, 7), { type: MessageType.PinNotice }),
			from("ana", at(10, 9, 6)),
		];
		const shapes = groupShapes(list);
		list.forEach((message, i) => expect(shapes[i]!.first).toBe(!joinsPrevious(list[i + 1], message)));
	});

	test("an empty list has none", () => {
		expect(groupShapes([])).toEqual([]);
	});
});

describe("a day's separator", () => {
	const now = new Date(2026, 10, 18, 12, 41);

	test("says Today and Yesterday", () => {
		expect(dayLabel(at(18, 0, 1), now)).toBe("Today");
		expect(dayLabel(at(17, 23, 59), now)).toBe("Yesterday");
	});

	test("names the weekday within the week, then the whole date", () => {
		expect(dayLabel(at(16, 10, 0), now)).toBe("Monday");
		expect(dayLabel(at(12, 10, 0), now)).toBe("Thursday");
		expect(dayLabel(at(11, 10, 0), now)).toBe("Wednesday, November 11");
	});

	test("says the year of a day of another year", () => {
		expect(dayLabel(new Date(2025, 11, 31, 10, 0).toISOString(), now)).toBe("Wednesday, December 31, 2025");
	});

	test("two moments are the same day by the calendar, not by 24 hours", () => {
		expect(sameDay(at(10, 0, 0), at(10, 23, 59))).toBe(true);
		expect(sameDay(at(10, 23, 59), at(11, 0, 0))).toBe(false);
	});
});

describe("a message's time", () => {
	test("is the clock's, in the system's format", () => {
		system("en-US");
		expect(clockTime(at(10, 9, 14))).toBe("9:14 AM");
		system("en-GB");
		expect(clockTime(at(10, 21, 14))).toBe("21:14");
		system();
	});

	test("is the same asked again, and each system's language keeps its own format", () => {
		for (let i = 0; i < 3; i++) {
			system("en-US");
			expect(clockTime(at(10, 9, 14))).toBe("9:14 AM");
			expect(shortClockTime(at(10, 9, 14))).toBe("9:14");
			system("en-GB");
			expect(clockTime(at(10, 21, 14))).toBe("21:14");
		}
		system();
		// The system's format is what the browser's own gives.
		const iso = at(10, 21, 14);
		expect(clockTime(iso)).toBe(new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
	});

	test("keeps the system's format on a system in another language than the app's", () => {
		system("de-DE");
		expect(clockTime(at(10, 21, 14))).toBe("21:14");
		expect(shortClockTime(at(10, 21, 14))).toBe("21:14");
		expect(headTime(at(18, 21, 14), new Date(2026, 10, 18, 22, 0))).toBe("Today at 21:14");
		system();
	});

	test("has no AM or PM in a flat row's gutter", () => {
		system("en-US");
		expect(shortClockTime(at(10, 9, 14))).toBe("9:14");
		expect(shortClockTime(at(10, 21, 14))).toBe("9:14");
		system("en-GB");
		expect(shortClockTime(at(10, 21, 14))).toBe("21:14");
		system();
	});

	test("a flat row's head says Today for a message of today, the time alone otherwise", () => {
		const now = new Date(2026, 10, 18, 12, 41);
		system("en-US");
		expect(headTime(at(18, 9, 14), now)).toBe("Today at 9:14 AM");
		expect(headTime(at(17, 9, 14), now)).toBe("9:14 AM");
		system();
	});
});
