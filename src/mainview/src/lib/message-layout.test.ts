import { expect, test } from "bun:test";
import { defaultMessageLayout, MESSAGE_LAYOUT_KEY, parseMessageLayout } from "./message-layout";

test("bubbles are the default: with nothing saved, or something this build doesn't know", () => {
	expect(defaultMessageLayout).toBe("bubbles");
	expect(parseMessageLayout(null)).toBe("bubbles");
	expect(parseMessageLayout("")).toBe("bubbles");
	expect(parseMessageLayout("compact")).toBe("bubbles");
});

test("flat rows are a choice, which is kept", () => {
	expect(parseMessageLayout("flat")).toBe("flat");
	expect(parseMessageLayout("bubbles")).toBe("bubbles");
});

test("it is saved apart from the shell's layout prefs", () => {
	expect(MESSAGE_LAYOUT_KEY).toBe("duvet.messages.layout.v1");
});
