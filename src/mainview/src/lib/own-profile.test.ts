import { describe, expect, test } from "bun:test";

// The module puts a profile in the app's stores, whose module uses $state, which only Svelte's compiler knows: here
// it's the value itself (as test-gateway.ts).
Object.assign(globalThis, { $state: <T>(value: T) => value });
const {
	parseSavedProfile,
	profileInConversations,
	profileInDirectMessages,
	profileInRoomMessages,
	profileInSpaces,
	withProfile,
} = await import("$lib/own-profile");

const saved = { id: "u1", username: "tamsin", alias: "Tamsin", avatar: "a2", banner: "b2", custom: "new bio" };
const user = (id: string) => ({
	id,
	username: `old-${id}`,
	alias: null as string | null,
	avatar: "a1" as string | null,
	banner: null as string | null,
	custom: "old",
});

describe("a saved profile shows everywhere at once", () => {
	test("the user themselves takes every field, and a field the API left out is cleared", () => {
		expect(withProfile(user("u1"), saved)).toEqual({ ...saved });
		expect(withProfile(user("u1"), { id: "u1", username: "tamsin" })).toEqual({
			id: "u1",
			username: "tamsin",
			alias: null,
			avatar: null,
			banner: null,
			custom: "",
		});
	});

	test("each Space's member list has the new profile for them, their picture by its address, and nobody else's", () => {
		const spaces = [
			{ id: "s1", users: [user("u1"), user("u2")] },
			{ id: "s2", users: [user("u2")] },
		];
		const next = profileInSpaces(spaces, saved, "https://host/a2");
		expect(next[0]!.users[0]).toEqual({ ...saved, avatar: "https://host/a2" });
		expect(next[0]!.users[1]).toBe(spaces[0]!.users[1]!);
		expect(next[1]!.users).toEqual(spaces[1]!.users);
		expect(next[0]!.id).toBe("s1");
	});

	test("their messages in rooms carry the new name and picture: the display name, or the username without one", () => {
		const rooms = {
			r1: [
				{ id: "m1", author_id: "u1", author_name: "old", author_avatar_url: "x" },
				{ id: "m2", author_id: "u2", author_name: "other", author_avatar_url: "y" },
			],
		};
		const next = profileInRoomMessages(rooms, saved, "https://host/a2");
		expect(next.r1![0]).toEqual({
			id: "m1",
			author_id: "u1",
			author_name: "Tamsin",
			author_avatar_url: "https://host/a2",
		});
		expect(next.r1![1]).toBe(rooms.r1[1]!);
		expect(profileInRoomMessages(rooms, { id: "u1", username: "tamsin" }, null).r1![0]!.author_name).toBe("tamsin");
	});

	test("their direct messages carry it too, and a message without its author's user is left as it is", () => {
		type Author = { username: string; alias: string | null; avatar: string | null; banner: string | null };
		const author = (username: string, avatar: string): Author => ({ username, alias: null, avatar, banner: null });
		const chats: Record<string, { id: string; author_id: string; user: Author | null }[]> = {
			c1: [
				{ id: "d1", author_id: "u1", user: author("old", "x") },
				{ id: "d2", author_id: "u1", user: null },
				{ id: "d3", author_id: "u2", user: author("other", "y") },
			],
		};
		const next = profileInDirectMessages(chats, saved, "https://host/a2");
		expect(next.c1![0]!.user).toEqual({ username: "tamsin", alias: "Tamsin", avatar: "https://host/a2", banner: "b2" });
		expect(next.c1![1]).toBe(chats.c1![1]!);
		expect(next.c1![2]).toBe(chats.c1![2]!);
	});

	test("the members of their conversations have it", () => {
		const member = (id: string) => {
			const { id: userId, ...rest } = user(id);
			return { user_id: userId, user: rest };
		};
		const chats = [{ id: "c1", members: [member("u1"), member("u2")] }];
		const next = profileInConversations(chats, saved, "https://host/a2");
		expect(next[0]!.members[0]!.user).toEqual({
			username: "tamsin",
			alias: "Tamsin",
			avatar: "https://host/a2",
			banner: "b2",
			custom: "new bio",
		});
		expect(next[0]!.members[1]).toBe(chats[0]!.members[1]!);
	});
});

describe("a saved profile that crossed the windows", () => {
	test("is taken with its fields, the missing ones as none", () => {
		expect(parseSavedProfile({ id: "u1", username: "tamsin", alias: "Tamsin", extra: 1 })).toEqual({
			id: "u1",
			username: "tamsin",
			alias: "Tamsin",
			avatar: null,
			banner: null,
			custom: null,
		});
	});

	test("is refused when it isn't one", () => {
		for (const value of [null, "u1", {}, { id: 1, username: "x" }, { id: "u1" }]) {
			expect(parseSavedProfile(value)).toBeNull();
		}
	});
});
