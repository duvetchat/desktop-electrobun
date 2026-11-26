import { describe, expect, test } from "bun:test";

// The host reaches the app's stores, whose module uses $state, which only Svelte's compiler knows: here it's the value
// itself (as test-gateway.ts).
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { parseMessageLayout, parseSavedSpace, withSavedSpace } = await import("$lib/settings-host");
import { defaultMessageLayout } from "$lib/message-layout";
import { parseSettingsSection, SETTINGS_SECTIONS } from "$lib/settings-sections";

describe("a Space's saved overview", () => {
	const space = (id: string, level: 0 | 1) => ({
		id,
		name: "Old",
		description: null as string | null,
		locale: null as string | null,
		banner: null as string | null,
		icon: null as string | null,
		default_notifications: level,
		roles: [id],
	});
	const spaces = [space("s1", 0), space("s2", 1)];

	test("shows in its Space at once, and in no other", () => {
		const saved = {
			name: "New",
			description: "About",
			locale: "en",
			banner: "b",
			icon: "i",
			default_notifications: 1 as const,
		};
		const next = withSavedSpace(spaces, "s1", saved);
		expect(next[0]).toEqual({ ...spaces[0]!, ...saved });
		expect(next[1]).toBe(spaces[1]!);
	});

	// A gateway from before the default leaves it out of its answer: the Space keeps what it had.
	test("keeps the Space's default when the answer has none", () => {
		const next = withSavedSpace(spaces, "s1", {
			name: "New",
			description: null,
			locale: null,
			banner: null,
			icon: null,
		});
		expect(next[0]!.default_notifications).toBe(0);
		expect(next[0]!.name).toBe("New");
	});

	test("crosses the windows with its fields, and is refused when it isn't one", () => {
		expect(
			parseSavedSpace({ name: "New", description: "d", locale: 3, banner: null, default_notifications: 0 }),
		).toEqual({
			name: "New",
			description: "d",
			locale: null,
			banner: null,
			icon: null,
			default_notifications: 0,
		});
		expect(parseSavedSpace({ name: "New", default_notifications: 7 })).toEqual({
			name: "New",
			description: null,
			locale: null,
			banner: null,
			icon: null,
		});
		expect(parseSavedSpace({ description: "no name" })).toBeNull();
		expect(parseSavedSpace(null)).toBeNull();
	});
});

test("messages follow the platform's default unless a layout is saved", () => {
	const fallback = defaultMessageLayout();
	expect(parseMessageLayout("flat")).toBe("flat");
	expect(parseMessageLayout("bubbles")).toBe("bubbles");
	expect(parseMessageLayout(null)).toBe(fallback);
	expect(parseMessageLayout("rows")).toBe(fallback);
});

describe("the section Settings opens on", () => {
	test("is the one saved, when it is one", () => {
		for (const section of SETTINGS_SECTIONS) expect(parseSettingsSection(section, true)).toBe(section);
	});

	test("is My account for nothing saved, or anything else", () => {
		expect(parseSettingsSection(null, true)).toBe("account");
		expect(parseSettingsSection("privacy", true)).toBe("account");
		expect(parseSettingsSection(3, true)).toBe("account");
	});

	// Only the desktop app has Activity privacy.
	test("is My account for Activity privacy outside the desktop app", () => {
		expect(parseSettingsSection("activity", false)).toBe("account");
		expect(parseSettingsSection("audio", false)).toBe("audio");
	});

	test("keeps the app's sections, in their order", () => {
		expect([...SETTINGS_SECTIONS]).toEqual([
			"account",
			"attachments",
			"security",
			"audio",
			"voice-video",
			"appearance",
			"activity",
			"buckets",
			"developer",
			"devices",
		]);
	});
});

// The control in Settings and the chats share one value (#357): the host reads and writes the chats' own store, so a
// change shows in every chat on screen at once, and is saved under the chats' key.
test("the page's host sets the chats' message layout, which saves it", async () => {
	const { pageSettingsHost, MESSAGE_LAYOUT_KEY } = await import("$lib/settings-host");
	const { messageLayout } = await import("$lib/stores/message-layout.svelte");
	const before = messageLayout.value;
	pageSettingsHost.setMessageLayout("flat");
	expect(messageLayout.value).toBe("flat");
	expect(pageSettingsHost.messageLayout()).toBe("flat");
	if (typeof localStorage !== "undefined") expect(localStorage.getItem(MESSAGE_LAYOUT_KEY)).toBe("flat");
	pageSettingsHost.setMessageLayout("bubbles");
	expect(messageLayout.value).toBe("bubbles");
	messageLayout.value = before;
});
