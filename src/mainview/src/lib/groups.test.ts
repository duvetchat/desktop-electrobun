import { describe, expect, test } from "bun:test";
import { groupActions, newConversation, type NewConversation } from "$lib/groups";
import { t } from "$lib/i18n";

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

	// A refusal's words, as the dialog draws them from its key.
	const refusal = (plan: NewConversation) => (plan.kind === "refused" ? t(plan.why) : plan.kind);

	test("a group needs its name", () => {
		expect(refusal(newConversation([THEM, OTHER], "   "))).toBe("Enter a group name");
	});

	test("a group has 20 members at most, its owner among them: refused before anything is asked", () => {
		const picked = (count: number) => Array.from({ length: count }, (_, n) => `friend-${n}`);
		expect(newConversation(picked(19), "Twenty")).toEqual({ kind: "group", name: "Twenty", userIds: picked(19) });
		expect(newConversation(picked(20), "Twenty-one")).toEqual({
			kind: "refused",
			why: "A group can have 20 members at most.",
		});
	});

	test("nobody picked is nothing to open, whatever name was typed", () => {
		expect(refusal(newConversation([], "Best friends"))).toBe("Add at least one friend to the group");
	});
});
