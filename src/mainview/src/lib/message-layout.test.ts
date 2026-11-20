import { expect, test } from "bun:test";
import { defaultMessageLayout, MESSAGE_LAYOUT_KEY, parseMessageLayout } from "./message-layout";

test("bubbles are the default on macOS and iOS, flat rows everywhere else", () => {
	expect(defaultMessageLayout("mac")).toBe("bubbles");
	expect(defaultMessageLayout("ios")).toBe("bubbles");
	expect(defaultMessageLayout("windows")).toBe("flat");
	expect(defaultMessageLayout("linux")).toBe("flat");
	expect(defaultMessageLayout("other")).toBe("flat");
});

test("with nothing saved, or something this build doesn't know, the platform's default", () => {
	expect(parseMessageLayout(null, "mac")).toBe("bubbles");
	expect(parseMessageLayout("", "ios")).toBe("bubbles");
	expect(parseMessageLayout("compact", "mac")).toBe("bubbles");
	expect(parseMessageLayout(null, "linux")).toBe("flat");
	expect(parseMessageLayout("rows", "windows")).toBe("flat");
});

test("a saved layout is a choice, which is kept", () => {
	expect(parseMessageLayout("flat", "mac")).toBe("flat");
	expect(parseMessageLayout("bubbles", "linux")).toBe("bubbles");
});

test("it is saved apart from the shell's layout prefs", () => {
	expect(MESSAGE_LAYOUT_KEY).toBe("duvet.messages.layout.v1");
});
