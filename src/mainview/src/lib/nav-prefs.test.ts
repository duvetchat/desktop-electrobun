import { expect, test } from "bun:test";
import { OLD_PINNED_SPACES_KEY, PINS_KEY, parsePins } from "$lib/nav";

// The module uses $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
// What a build from before #416 left on this device: two pinned Spaces, under the old key.
localStorage.setItem(OLD_PINNED_SPACES_KEY, '["s1", "s2"]');
const { navPrefs, togglePinned, togglePinnedChat } = await import("$lib/nav-prefs.svelte");

const saved = () => JSON.parse(localStorage.getItem(PINS_KEY) ?? "null") as unknown;

// #416: a chat (a direct message or a group) is pinned as a Space is, and both are saved in one list of keys.
test("the pinned Spaces and chats are saved together, each kind in the order pinned", () => {
	// The Spaces pinned before chats could be are still pinned.
	expect(navPrefs.pinned).toEqual(["s1", "s2"]);
	expect(navPrefs.pinnedChats).toEqual([]);
	expect(saved()).toBeNull();

	togglePinnedChat("c1");
	togglePinnedChat("c2");
	expect(navPrefs.pinnedChats).toEqual(["c1", "c2"]);
	expect(saved()).toEqual(["space:s1", "space:s2", "conv:c1", "conv:c2"]);

	// Unpinning takes one out; pinning it again puts it last.
	togglePinnedChat("c1");
	togglePinned("s1");
	expect(saved()).toEqual(["space:s2", "conv:c2"]);
	togglePinnedChat("c1");
	togglePinned("s3");
	expect(navPrefs.pinned).toEqual(["s2", "s3"]);
	expect(navPrefs.pinnedChats).toEqual(["c2", "c1"]);
	expect(saved()).toEqual(["space:s2", "space:s3", "conv:c2", "conv:c1"]);

	// The next start reads what was saved, not the old key, which is left as it was.
	expect(parsePins(localStorage.getItem(PINS_KEY), localStorage.getItem(OLD_PINNED_SPACES_KEY))).toEqual({
		spaces: ["s2", "s3"],
		chats: ["c2", "c1"],
	});
	expect(localStorage.getItem(OLD_PINNED_SPACES_KEY)).toBe('["s1", "s2"]');
});
