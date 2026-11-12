import { describe, expect, test } from "bun:test";
import { notificationKind, type NotificationInput } from "./notifications";

// Someone else's message in a place at every message, with Duvet focused on another chat, where a system notification
// can show: each test changes what it's about.
const base: NotificationInput = {
	own: false,
	notice: false,
	level: 0,
	mention: false,
	dnd: false,
	focused: true,
	onScreen: false,
	system: true,
};
const kind = (change: Partial<NotificationInput>) => notificationKind({ ...base, ...change });

describe("what a message notifies", () => {
	test("nothing for the user's own messages, Duvet's notices, do not disturb, or a level of nothing", () => {
		expect(kind({ own: true })).toBe("none");
		expect(kind({ notice: true })).toBe("none");
		expect(kind({ dnd: true, mention: true })).toBe("none");
		expect(kind({ level: 2, mention: true })).toBe("none");
	});

	test("at only mentions, a mention alone", () => {
		expect(kind({ level: 1 })).toBe("none");
		expect(kind({ level: 1, mention: true })).toBe("notice");
	});

	test("focused: Duvet's notice for another chat, nothing for the chat on screen", () => {
		expect(kind({})).toBe("notice");
		expect(kind({ onScreen: true })).toBe("none");
	});

	test("without the focus: the system's notification where there is one, else Duvet's notice", () => {
		expect(kind({ focused: false })).toBe("system");
		expect(kind({ focused: false, system: false })).toBe("notice");
		// A chat on screen in a window without the focus isn't being looked at: it notifies too.
		expect(kind({ focused: false, onScreen: true })).toBe("system");
	});
});
