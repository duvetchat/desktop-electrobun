import { describe, expect, test } from "bun:test";
import { voiceKey, voiceKeyLabel, voiceKeyLabels } from "$lib/voice-keys";

// The mute and deafen shortcuts of the desktop app (#357), in the main window and in the pop-out.
const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
	key: k,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...mods,
});

describe("on macOS", () => {
	test("⇧⌘M mutes and ⇧⌘D deafens, whatever the letter's case", () => {
		expect(voiceKey(key("M", { metaKey: true, shiftKey: true }), true)).toBe("mute");
		expect(voiceKey(key("m", { metaKey: true, shiftKey: true }), true)).toBe("mute");
		expect(voiceKey(key("D", { metaKey: true, shiftKey: true }), true)).toBe("deafen");
	});

	test("Ctrl isn't the modifier there, nor ⌘ with it", () => {
		expect(voiceKey(key("M", { ctrlKey: true, shiftKey: true }), true)).toBeNull();
		expect(voiceKey(key("M", { metaKey: true, ctrlKey: true, shiftKey: true }), true)).toBeNull();
	});
});

describe("on Windows and Linux", () => {
	test("Ctrl Shift M mutes and Ctrl Shift D deafens", () => {
		expect(voiceKey(key("M", { ctrlKey: true, shiftKey: true }), false)).toBe("mute");
		expect(voiceKey(key("d", { ctrlKey: true, shiftKey: true }), false)).toBe("deafen");
	});

	test("the Windows key isn't the modifier", () => {
		expect(voiceKey(key("M", { metaKey: true, shiftKey: true }), false)).toBeNull();
	});
});

describe("everywhere", () => {
	test("typing stays typing: no modifier, Shift alone, the modifier without Shift, or with Alt", () => {
		for (const isMac of [true, false]) {
			const primary = isMac ? { metaKey: true } : { ctrlKey: true };
			expect(voiceKey(key("m"), isMac)).toBeNull();
			expect(voiceKey(key("M", { shiftKey: true }), isMac)).toBeNull();
			expect(voiceKey(key("m", primary), isMac)).toBeNull();
			expect(voiceKey(key("M", { ...primary, shiftKey: true, altKey: true }), isMac)).toBeNull();
			expect(voiceKey(key("K", { ...primary, shiftKey: true }), isMac)).toBeNull();
		}
	});

	test("the shortcuts are written the app's way", () => {
		expect(voiceKeyLabel("mute", true)).toBe("⇧⌘M");
		expect(voiceKeyLabel("deafen", true)).toBe("⇧⌘D");
		expect(voiceKeyLabels(false)).toEqual({ mute: "Ctrl Shift M", deafen: "Ctrl Shift D" });
	});
});
