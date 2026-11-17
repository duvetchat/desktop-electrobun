import { expect, test } from "bun:test";
import { statusDotClass } from "$lib/status";
import { tags, type Tag } from "./server-render";

const { default: StatusDot } = await import("./StatusDot.svelte");

const classes = (tag: Tag) => tag.attributes.class!.split(/\s+/);
// As the DM list places and rings it.
const placed = "text-duvet-sunk absolute -right-0.5 -bottom-0.5 w-3 border-2";

test("draws a round dot in the status's colour, ringed in the class's text colour", async () => {
	const [dot, ...rest] = await tags(StatusDot, { status: "online", class: placed });
	expect(dot!.name).toBe("span");
	expect(rest).toEqual([]);
	expect(classes(dot!)).toEqual(
		expect.arrayContaining([
			"aspect-square",
			"rounded-full",
			statusDotClass("online"),
			"border-current",
			...placed.split(" "),
		]),
	);
});

// Someone connected only from the mobile app shows as a phone instead (#82), as the mobile app draws it (mobile#177):
// as wide as the dot and half as tall again, ringed as the dot is, in the status's colour, its screen in the ring's.
test("draws a phone in the dot's place for someone only on mobile", async () => {
	const [phone, body, screen, ...rest] = await tags(StatusDot, { status: "online", mobileOnly: true, class: placed });
	expect(classes(phone!)).toEqual(
		expect.arrayContaining(["aspect-[2/3]", "border-current", "bg-current", ...placed.split(" ")]),
	);
	expect(classes(phone!)).not.toContain(statusDotClass("online"));
	// The phone in the status's colour, with a deeper edge below its screen than above.
	expect(classes(body!)).toEqual(expect.arrayContaining([statusDotClass("online"), "pt-[20%]", "pb-[45%]"]));
	// Its screen in the ring's colour, with nothing on it while online.
	expect(classes(screen!)).toContain("bg-current");
	expect(rest).toEqual([]);
});

test("puts the do-not-disturb bar across the phone's screen, so shape tells it from online", async () => {
	const [, body, screen, bar, ...rest] = await tags(StatusDot, { status: "dnd", mobileOnly: true, class: placed });
	expect(classes(body!)).toContain(statusDotClass("dnd"));
	expect(classes(screen!)).toContain("bg-current");
	expect(classes(bar!)).toEqual(expect.arrayContaining([statusDotClass("dnd"), "h-0.5"]));
	expect(rest).toEqual([]);
});

test("draws the dot, not the phone, unless told the user is only on mobile", async () => {
	const [dot, ...rest] = await tags(StatusDot, { status: "dnd", mobileOnly: false, class: placed });
	expect(classes(dot!)).toEqual(expect.arrayContaining(["rounded-full", statusDotClass("dnd")]));
	expect(rest).toEqual([]);
});
