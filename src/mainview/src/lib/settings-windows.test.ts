import { describe, expect, test } from "bun:test";
import {
	askedSection,
	bansKey,
	gotoFor,
	parseSettingsArgs,
	parseWrite,
	spaceKey,
	syncChannel,
	syncKey,
} from "$lib/settings-windows";

describe("the channels of the values the windows share", () => {
	test("a key's channel names it, and gives it back", () => {
		expect(syncChannel("theme")).toBe("sync:theme");
		expect(syncKey(syncChannel(spaceKey("s1")))).toBe("space:s1");
		expect(syncKey(syncChannel(bansKey("s1")))).toBe("bans:s1");
	});

	test("another channel's state is no shared value", () => {
		expect(syncKey("media")).toBeNull();
		expect(syncKey("settings:goto")).toBeNull();
	});
});

describe("what Bun tells a Settings window", () => {
	test("its Space and the section asked for", () => {
		expect(parseSettingsArgs({ spaceId: "s1", section: "roles" })).toEqual({ spaceId: "s1", section: "roles" });
		expect(parseSettingsArgs({ spaceId: null, section: null })).toEqual({ spaceId: null, section: null });
	});

	test("nothing, in a page Bun told nothing", () => {
		for (const value of [undefined, null, "x", {}, { spaceId: 3, section: "" }]) {
			expect(parseSettingsArgs(value)).toEqual({ spaceId: null, section: null });
		}
	});

	test("Settings opens on the section asked for, or on the one viewed last when none was", () => {
		expect(askedSection({ spaceId: null, section: "appearance" })).toBe("appearance");
		expect(askedSection({ spaceId: null, section: null })).toBeUndefined();
		// Not one of Settings': My account.
		expect(askedSection({ spaceId: null, section: "privacy" })).toBe("account");
	});
});

describe("an open window asked for a section", () => {
	test("takes the one meant for it", () => {
		expect(gotoFor({ spaceId: null, section: "audio" }, null)).toBe("audio");
		expect(gotoFor({ spaceId: "s1", section: "roles" }, "s1")).toBe("roles");
	});

	test("leaves another window's", () => {
		expect(gotoFor({ spaceId: "s1", section: "roles" }, null)).toBeNull();
		expect(gotoFor({ spaceId: null, section: "audio" }, "s1")).toBeNull();
		expect(gotoFor({ spaceId: "s2", section: "roles" }, "s1")).toBeNull();
	});

	test("and anything that names no section", () => {
		expect(gotoFor({ spaceId: null, section: null }, null)).toBeNull();
		expect(gotoFor(null, null)).toBeNull();
	});
});

test("a window's write carries its key and its value", () => {
	expect(parseWrite({ key: "theme", value: "light" })).toEqual({ key: "theme", value: "light" });
	expect(parseWrite({ key: "buckets" })).toEqual({ key: "buckets", value: null });
	expect(parseWrite({ value: 1 })).toBeNull();
	expect(parseWrite({ key: 3, value: 1 })).toBeNull();
	expect(parseWrite(null)).toBeNull();
});
