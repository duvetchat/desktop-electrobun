import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import type { SharedOffer } from "$lib/e2e/engine/engine";
import { notice, NOTICES } from "$lib/e2e/notices";
import { tags } from "../server-render";

// What other members shared of a conversation's history with this person (PLAN-E2E-CLIENTES.md, Task 30), over its
// message box: who shared how far back, and Add to this device, which takes it in only on the person's word (Ruling 22).
const { default: SharedHistoryOffer } = await import("./SharedHistoryOffer.svelte");

const ANA = "0190a3b2-0000-7000-8000-00000000000a";
const NAMES: Record<string, string> = { [ANA]: "Ana" };
const offer = (range: SharedOffer["range"]): SharedOffer => ({
	...{ share_id: crypto.randomUUID(), conversation_id: "0190a3b2-0000-7000-8000-00000000c0c0", from_user_id: ANA },
	...{ range, starts_at: "2026-11-19T12:00:00Z" },
});
const props = (offers: SharedOffer[]) => ({
	offers,
	nameOf: (userId: string) => NAMES[userId] ?? userId,
	onAdd: async () => {},
});
const drawn = (offers: SharedOffer[]) =>
	render(SharedHistoryOffer, { props: props(offers) })
		.body.replace(/<!--[^]*?-->/g, "")
		.replaceAll("&#39;", "'");

describe("a shared history's offer", () => {
	test("says nothing without one", () => {
		expect(drawn([]).trim()).toBe("");
	});

	test("names who shared how far back with the person, beside Add to this device", async () => {
		const html = drawn([offer("week")]);
		expect(html).toContain(notice("shared_with_you", { a: "Ana", range: NOTICES.range_week }));
		expect(html).toMatch(/<button [^>]*>\s*Add to this device\s*<\/button>/);
		// One whose range isn't one of the four reads as the whole history.
		expect(drawn([offer(null)])).toContain(notice("shared_with_you", { a: "Ana", range: NOTICES.range_all }));
		// Each offer its own row and its own button.
		const buttons = (await tags(SharedHistoryOffer, props([offer("day"), offer("all")]))).filter(
			(tag) => tag.name === "button",
		);
		expect(buttons).toHaveLength(2);
	});
});
