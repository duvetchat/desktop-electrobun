import { describe, expect, test } from "bun:test";
import { mentionCentre, prismScale, prismSides, prismSlide } from "./prism";

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
