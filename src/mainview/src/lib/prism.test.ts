import { describe, expect, test } from "bun:test";
import {
	mentionCentre,
	PRISM_BUBBLE,
	PRISM_RIM,
	PRISM_WASH,
	PRISM_WASH_RUN,
	placePrismsIn,
	prismScale,
	prismSides,
	prismSlide,
	slidePrismsIn,
} from "./prism";

describe("Prism's lights", () => {
	test("scale with the bubble's width, full size from 270 px and never under four tenths", () => {
		expect(prismScale(270)).toBe(1);
		expect(prismScale(540)).toBe(1);
		expect(prismScale(135)).toBe(0.5);
		expect(prismScale(40)).toBe(0.4);
	});

	test("the side lights slide as the bubble moves up the list", () => {
		// A list 600 px tall whose top is at 100.
		expect(prismSlide(700, 100, 600)).toBe(0);
		expect(prismSlide(400, 100, 600)).toBe(0.5);
		expect(prismSlide(100, 100, 600)).toBe(1);
		// Out of view, above or below, they stay at their ends.
		expect(prismSlide(-50, 100, 600)).toBe(1);
		expect(prismSlide(900, 100, 600)).toBe(0);
		expect(prismSlide(400, 100, 0)).toBe(0);
	});

	test("the cool light runs from 70 to 220 px and the warm one from 30 to 120, times the scale", () => {
		expect(prismSides(0, 1)).toEqual({ cx: 70, wx: 30 });
		expect(prismSides(1, 1)).toEqual({ cx: 220, wx: 120 });
		expect(prismSides(1, 0.5)).toEqual({ cx: 110, wx: 60 });
	});

	test("the main light is centred on the mention, within its bubble", () => {
		const bubble = { left: 200, top: 300, width: 270, height: 60 };
		expect(mentionCentre(bubble, { left: 260, top: 330, width: 40, height: 20 })).toEqual({ mx: 80, my: 40 });
	});

	test("with no mention in the text (a reply that pinged the user), it sits near the text's start", () => {
		expect(mentionCentre({ left: 200, top: 300, width: 270, height: 60 }, null)).toEqual({ mx: 40, my: 20 });
	});
});

// The rim is a gradient with all but its 1 px edge masked away. The cut-out has to be part of the mask shorthand: as a
// class of its own it sat before the shorthand in the stylesheet, which reset it, and the gradient filled the bubble.
describe("Prism's classes", () => {
	test("the rim's mask carries its own cut-out, with no class a shorthand can reset", () => {
		expect(PRISM_RIM).toContain("_content-box_exclude,");
		expect(PRISM_RIM).not.toContain("[mask-composite:");
		expect(PRISM_RIM.match(/\[mask:/g)).toHaveLength(1);
		expect(PRISM_RIM).toContain("p-px");
	});

	test("a lit bubble and a lit row write their mentions in the violet that holds on the light", () => {
		for (const classes of [PRISM_BUBBLE, PRISM_WASH, PRISM_WASH_RUN])
			expect(classes).toContain("[--mention-ink:var(--duvet-mention-lit)]");
		// The bubble itself stays the card: the light is the layer under its text, not its fill.
		expect(PRISM_BUBBLE.split(" ")).toContain("bg-duvet-card");
	});
});

// The test runs without a page: what escapes a selector's value stands in for the browser's.
if (typeof CSS === "undefined") Object.assign(globalThis, { CSS: { escape: (value: string) => value } });

// A stand-in for an element: its box, and a log of every read and write in the order they came.
function fake(log: string[], name: string, box: { left: number; top: number; width: number; height: number }) {
	const set: Record<string, string> = {};
	const mention = { getBoundingClientRect: () => ({ left: box.left + 60, top: box.top + 30, width: 40, height: 20 }) };
	const element = {
		getBoundingClientRect: () => (log.push(`read ${name}`), box),
		querySelector: (selector: string) => (log.push(`find ${name} ${selector}`), mention),
		style: { setProperty: (key: string, value: string) => (log.push(`write ${name}`), (set[key] = value)) },
	};
	return { element, set };
}

describe("the lights of a list's bubbles", () => {
	const view = { left: 0, top: 100, width: 800, height: 600 };

	test("slide for the bubbles in view only, every box read before anything is written", () => {
		const log: string[] = [];
		const list = fake(log, "list", view).element;
		const top = fake(log, "top", { left: 200, top: 100, width: 270, height: 60 });
		const above = fake(log, "above", { left: 200, top: -400, width: 270, height: 60 });
		const bottom = fake(log, "bottom", { left: 200, top: 640, width: 135, height: 60 });
		const below = fake(log, "below", { left: 200, top: 900, width: 270, height: 60 });
		slidePrismsIn([top.element, above.element, bottom.element, below.element], list);

		expect(log.filter((line) => line === "read list")).toHaveLength(1);
		const firstWrite = log.findIndex((line) => line.startsWith("write"));
		expect(log.slice(firstWrite).every((line) => line.startsWith("write"))).toBe(true);
		expect(log.slice(0, firstWrite).filter((line) => line.startsWith("read"))).toHaveLength(5);
		// Out of view: untouched.
		expect(above.set).toEqual({});
		expect(below.set).toEqual({});
		// In view: where prismSides puts them for the bubble's place and width.
		const at = (centre: number, scale: number) => prismSides(prismSlide(centre, view.top, view.height), scale);
		expect(at(130, 1)).toEqual({ cx: 212.5, wx: 115.5 });
		expect(top.set).toEqual({ "--cx": "212.5px", "--wx": "115.5px" });
		// Half as wide: half the scale, to a tenth of a pixel.
		expect(at(670, 0.5)).toEqual({ cx: 38.75, wx: 17.25 });
		expect(bottom.set).toEqual({ "--cx": "38.8px", "--wx": "17.3px" });
	});

	test("are all placed for each bubble given, in view or not, the reads first", () => {
		const log: string[] = [];
		const list = fake(log, "list", view).element;
		const one = fake(log, "one", { left: 200, top: 300, width: 270, height: 60 });
		const far = fake(log, "far", { left: 200, top: -900, width: 135, height: 60 });
		placePrismsIn(
			[
				[one.element, "42"],
				[far.element, "42"],
			],
			list,
		);
		expect(log).toContain('find one .msg-mention[data-user-id="42"]');
		const firstWrite = log.findIndex((line) => line.startsWith("write"));
		expect(log.slice(firstWrite).every((line) => line.startsWith("write"))).toBe(true);
		expect(one.set).toMatchObject({ "--mx": "80px", "--my": "40px", "--ps": "1" });
		expect(Object.keys(one.set).sort()).toEqual(["--cx", "--mx", "--my", "--ps", "--wx"]);
		expect(far.set).toMatchObject({ "--mx": "80px", "--my": "40px", "--ps": "0.5", "--cx": "110px", "--wx": "60px" });
	});
});
