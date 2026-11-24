import { describe, expect, test } from "bun:test";
import { cardIconButtonClass } from "$lib/components/ui/recipes";
import { FRIEND_ROW_TRIGGER, MEMBER_ROW_TRIGGER } from "./recipes";

const classes = (list: string) => list.split(/\s+/);

describe("a person's row", () => {
	test("the members column's takes the row radius, its margin and the sidebar's hover", () => {
		expect(classes(MEMBER_ROW_TRIGGER)).toEqual(
			expect.arrayContaining(["mx-2", "h-10", "rounded-row", "px-2", "hover:bg-duvet-hover"]),
		);
	});

	test("the friends page's shares its row and draws the keys' focus mark", () => {
		expect(classes(FRIEND_ROW_TRIGGER)).toEqual(
			expect.arrayContaining([
				"rounded-row",
				"flex-1",
				"gap-3",
				"focus-visible:outline-2",
				"focus-visible:outline-duvet-accent",
			]),
		);
	});

	test("a friend's action is a card icon button, its removal in the danger ink", () => {
		expect(classes(cardIconButtonClass())).toEqual(
			expect.arrayContaining(["bg-duvet-card", "shadow-duvet-raised", "size-9", "rounded-row", "hover:text-duvet-ink"]),
		);
		expect(classes(cardIconButtonClass(true))).toEqual(
			expect.arrayContaining(["bg-duvet-card", "shadow-duvet-raised", "hover:text-duvet-danger"]),
		);
	});
});
