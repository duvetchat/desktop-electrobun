import { describe, expect, test } from "bun:test";
import { openUrl, parseOpenUrl } from "./notification-links";

const SPACE = "01920000-0000-7000-8000-0000000005a0";
const ROOM = "01920000-0000-7000-8000-0000000005a1";
const DM = "01920000-0000-7000-8000-00000000d001";
const MESSAGE = "01a15f8c-0001-7000-8000-000000000000";

describe("a notification's link", () => {
	test("opens a room's message, and a conversation's, there and back", () => {
		const room = { spaceId: SPACE, roomId: ROOM, messageId: MESSAGE };
		const conversation = { spaceId: "", roomId: "", conversationId: DM, messageId: MESSAGE };
		expect(openUrl("duvet-dev", room)).toBe(`duvet-dev://open/?space=${SPACE}&room=${ROOM}&message=${MESSAGE}`);
		expect(parseOpenUrl(openUrl("duvet-dev", room), "duvet-dev")).toEqual(room);
		expect(parseOpenUrl(openUrl("duvet-dev", conversation), "duvet-dev")).toEqual(conversation);
	});

	test("takes it with or without the slash Windows adds, and without a message", () => {
		expect(parseOpenUrl(`duvet-dev://open?space=${SPACE}&room=${ROOM}`, "duvet-dev")).toEqual({
			spaceId: SPACE,
			roomId: ROOM,
		});
	});

	test("refuses anything else: another scheme or path, an ID that isn't one, a room without its Space", () => {
		const good = `space=${SPACE}&room=${ROOM}&message=${MESSAGE}`;
		expect(parseOpenUrl(`duvet://open/?${good}`, "duvet-dev")).toBeNull();
		expect(parseOpenUrl(`duvet-dev://close/?${good}`, "duvet-dev")).toBeNull();
		expect(parseOpenUrl(`duvet-dev://open/x?${good}`, "duvet-dev")).toBeNull();
		expect(parseOpenUrl(`duvet-dev://open/?space=${SPACE}&room=../../x`, "duvet-dev")).toBeNull();
		expect(parseOpenUrl(`duvet-dev://open/?room=${ROOM}`, "duvet-dev")).toBeNull();
		expect(parseOpenUrl(`duvet-dev://open/?conversation=${DM}&message=x`, "duvet-dev")).toBeNull();
		expect(parseOpenUrl("not a url", "duvet-dev")).toBeNull();
	});
});
