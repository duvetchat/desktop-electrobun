import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import api from "$lib/api/api";
import { toggleReaction } from "$lib/api/reactions";

const ME = "0190a3b2-0000-7000-8000-00000000000a";
const X = "0190a3b2-0000-7000-8000-0000000000e1";
const Y = "0190a3b2-0000-7000-8000-0000000000e2";
const answer = { data: null, status: 204, statusText: "", headers: new Headers() };
let put: ReturnType<typeof spyOn<typeof api, "put">>;
let removed: ReturnType<typeof spyOn<typeof api, "delete">>;

beforeEach(() => {
	put = spyOn(api, "put").mockResolvedValue(answer);
	removed = spyOn(api, "delete").mockResolvedValue(answer);
});

afterEach(() => {
	put.mockRestore();
	removed.mockRestore();
});

// A custom emoji's reaction is its ID's: two Spaces can each have a "blob", and the user's own is taken back by its
// emoji's ID, leaving the other.
describe("toggleReaction", () => {
	const room = { spaceId: "s", channelId: "r" };
	const message = {
		id: "m",
		reactions: [
			{ emoji_name: "blob", emoji_id: X, count: 1, users: [ME] },
			{ emoji_name: "blob", emoji_id: Y, count: 1, users: ["ana"] },
		],
	};

	test("takes back a custom reaction by its emoji's ID", async () => {
		await toggleReaction(room, message, ME, "blob", X);
		expect(removed).toHaveBeenCalledWith(`/api/rooms/r/messages/m/reactions/${X}`);
		expect(put).not.toHaveBeenCalled();
	});

	test("and adds the other one of the same name", async () => {
		await toggleReaction(room, message, ME, "blob", Y);
		expect(put).toHaveBeenCalledWith("/api/rooms/r/messages/m/reactions", { emoji_name: "blob", emoji_id: Y });
		expect(removed).not.toHaveBeenCalled();
	});

	test("a Unicode emoji by its name, in a conversation too", async () => {
		const fire = { id: "m", reactions: [{ emoji_name: "🔥", count: 1, users: [ME] }] };
		await toggleReaction({ spaceId: "", channelId: "c" }, fire, ME, "🔥");
		expect(removed).toHaveBeenCalledWith("/api/users/@me/conversations/c/messages/m/reactions/%F0%9F%94%A5");
	});
});
