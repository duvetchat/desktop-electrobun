import { describe, expect, test } from "bun:test";
import { canQuote, quoteIn, takeQuotes } from "./quotes";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no DOM here: objects stand in for nodes, only compared.
const node = () => ({}) as unknown as Node & Element;
// An element as the quotes read it: whether another is inside it.
const el = (...inside: Node[]) => ({ contains: (other: Node | null) => !!other && inside.includes(other) });

describe("Quote in reply", () => {
	test("goes to the list the selection is in, for a message that list takes", () => {
		const at = node();
		const quoted: string[] = [];
		const stop = takeQuotes({
			el: el(at),
			takes: (id) => id === "m1",
			quote: (id, text) => void quoted.push(`${id}: ${text}`),
		});
		expect(canQuote(at, "m1")).toBe(true);
		expect(canQuote(at, "m2")).toBe(false);
		quoteIn(at, "m1", "hello");
		expect(quoted).toEqual(["m1: hello"]);
		stop();
		expect(canQuote(at, "m1")).toBe(false);
	});

	test("nowhere for a selection outside every list (a thread's sheet, a profile)", () => {
		const elsewhere = node();
		const stop = takeQuotes({ el: el(), takes: () => true, quote: () => {} });
		expect(canQuote(elsewhere, "m1")).toBe(false);
		stop();
	});
});
