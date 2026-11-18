import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGE_TEXT } from "./message-styles";
import { SPECKS, STILL, driftSpecksOnScreen, type Speck } from "./spoiler-specks";

type Entry = { target: Speck; isIntersecting: boolean };

function spoiler(connected = true) {
	const attributes = new Set<string>();
	const element = {
		isConnected: connected,
		toggleAttribute: (name: string, on: boolean) => (on ? attributes.add(name) : attributes.delete(name)),
	};
	return { element, attributes, raw: element };
}

function setup() {
	const page = new EventTarget();
	const watched = new Set<Speck>();
	let seen: (entries: Entry[]) => void = () => {};
	let disconnected = false;
	const stop = driftSpecksOnScreen(page, (callback) => {
		seen = callback;
		return {
			observe: (el) => void watched.add(el),
			unobserve: (el) => void watched.delete(el),
			disconnect: () => void (disconnected = true),
		};
	});
	const start = (target: Speck, animationName: string) => {
		const event = new Event("animationstart");
		Object.defineProperties(event, { animationName: { value: animationName }, target: { value: target } });
		page.dispatchEvent(event);
	};
	return { stop, watched, start, see: (entries: Entry[]) => seen(entries), gone: () => disconnected };
}

describe("a closed spoiler's specks", () => {
	test("are watched from the moment they start to drift, and no other animation is", () => {
		const { watched, start } = setup();
		const one = spoiler();
		start(one.element, "pop");
		expect(watched.size).toBe(0);
		start(one.element, SPECKS);
		start(one.element, SPECKS);
		expect([...watched]).toEqual([one.element]);
	});

	test("hold still out of view and drift again in view", () => {
		const { start, see } = setup();
		const one = spoiler();
		start(one.element, SPECKS);
		see([{ target: one.element, isIntersecting: false }]);
		expect(one.attributes.has(STILL)).toBe(true);
		see([{ target: one.element, isIntersecting: true }]);
		expect(one.attributes.has(STILL)).toBe(false);
	});

	test("are let go once their spoiler has left the page", () => {
		const { watched, start, see } = setup();
		const one = spoiler();
		start(one.element, SPECKS);
		one.raw.isConnected = false;
		see([{ target: one.element, isIntersecting: false }]);
		expect(watched.size).toBe(0);
		expect(one.attributes.has(STILL)).toBe(false);
	});

	test("stop being watched when it is stopped, and nothing starts without an observer", () => {
		const { stop, watched, start, gone } = setup();
		stop();
		expect(gone()).toBe(true);
		start(spoiler().element, SPECKS);
		expect(watched.size).toBe(0);
		expect(driftSpecksOnScreen(new EventTarget(), null)).toBeInstanceOf(Function);
	});

	test("the styles pause a still spoiler, the keyframes carry the name, and the layout starts it", () => {
		expect(MESSAGE_TEXT).toContain("[&_.msg-spoiler[data-still]]:[animation-play-state:paused]");
		expect(STILL).toBe("data-still");
		const src = join(import.meta.dir, "..");
		expect(readFileSync(join(src, "app.css"), "utf8")).toContain(`--animate-specks: ${SPECKS} 3s linear infinite`);
		expect(readFileSync(join(src, "routes", "+layout.svelte"), "utf8")).toContain("driftSpecksOnScreen(document)");
	});
});
