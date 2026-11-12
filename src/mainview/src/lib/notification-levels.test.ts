import { describe, expect, test } from "bun:test";
import { applyNotificationUpdate, conversationLevel, roomLevel, spaceLevel } from "$lib/notification-levels";

const SPACE = "01920000-0000-7000-8000-0000000000a1";
const ROOM = "01920000-0000-7000-8000-0000000000b1";
const CONV = "01920000-0000-7000-8000-0000000000c1";

describe("the level that applies in a place", () => {
	test("a room's own level wins over its Space's", () => {
		expect(roomLevel({ [ROOM]: 0, [SPACE]: 2 }, ROOM, SPACE, 1)).toBe(0);
	});

	test("a room without one follows its Space's", () => {
		expect(roomLevel({ [SPACE]: 2 }, ROOM, SPACE, 0)).toBe(2);
	});

	test("a Space without one follows its default", () => {
		expect(spaceLevel({}, SPACE, 0)).toBe(0);
		expect(roomLevel({}, ROOM, SPACE, 0)).toBe(0);
	});

	test("a Space whose default didn't come (an older gateway) is only mentions, never every message", () => {
		expect(spaceLevel({}, SPACE, undefined)).toBe(1);
		expect(roomLevel({}, ROOM, SPACE, undefined)).toBe(1);
	});

	test("a conversation without one is every message", () => {
		expect(conversationLevel({}, CONV)).toBe(0);
		expect(conversationLevel({ [CONV]: 2 }, CONV)).toBe(2);
	});
});

describe("NOTIFICATION_SETTINGS_UPDATE", () => {
	test("a level sets the place's", () => {
		expect(applyNotificationUpdate({}, { target_id: ROOM, target_type: 1, level: 2 })).toEqual({ [ROOM]: 2 });
	});

	test("null puts the place back on its default, leaving the others", () => {
		const levels = { [ROOM]: 2, [SPACE]: 0 } as const;
		expect(applyNotificationUpdate(levels, { target_id: ROOM, target_type: 1, level: null })).toEqual({ [SPACE]: 0 });
		expect(levels[ROOM]).toBe(2);
	});
});
