import { describe, expect, test } from "bun:test";
import { groupActions, newConversation } from "$lib/groups";

const ME = "01920000-0000-7000-8000-00000000b0b0";
const THEM = "01920000-0000-7000-8000-00000000a11c";
const OTHER = "01920000-0000-7000-8000-0000000000c3";

describe("groupActions", () => {
	test("a group's owner renames it and leaves it", () => {
		expect(groupActions({ type: 2, owner_id: ME }, ME)).toEqual({ rename: true, leave: true });
	});

	test("any other member only leaves it", () => {
		expect(groupActions({ type: 2, owner_id: THEM }, ME)).toEqual({ rename: false, leave: true });
	});

	test("a DM offers neither, whoever opened it: its owner_id is just that", () => {
		expect(groupActions({ type: 1, owner_id: ME }, ME)).toEqual({ rename: false, leave: false });
		expect(groupActions({ type: 1, owner_id: THEM }, ME)).toEqual({ rename: false, leave: false });
	});

	test("before the user is known, nobody owns a thing", () => {
		expect(groupActions({ type: 2, owner_id: ME }, undefined)).toEqual({ rename: false, leave: true });
	});
});

describe("newConversation", () => {
	test("one friend picked is the DM with them, with or without a name", () => {
		expect(newConversation([THEM], "")).toEqual({ kind: "dm", userId: THEM });
		expect(newConversation(new Set([THEM]), "Just us")).toEqual({ kind: "dm", userId: THEM });
	});

	test("two friends or more are a group, under the name typed", () => {
		expect(newConversation(new Set([THEM, OTHER]), "  Best friends ")).toEqual({
			kind: "group",
			name: "Best friends",
			userIds: [THEM, OTHER],
		});
	});

	test("a group needs its name", () => {
		expect(newConversation([THEM, OTHER], "   ")).toEqual({ kind: "refused", why: "Enter a group name" });
	});

	test("nobody picked is nothing to open, whatever name was typed", () => {
		expect(newConversation([], "Best friends")).toEqual({
			kind: "refused",
			why: "Add at least one friend to the group",
		});
	});
});
