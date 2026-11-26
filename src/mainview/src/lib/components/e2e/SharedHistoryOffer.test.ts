import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import type { SharedOffer } from "$lib/e2e/engine/engine";
import { notice, NOTICES } from "$lib/e2e/notices";
import { tags } from "../server-render";

// What other members shared of a conversation's history with this person (PLAN-E2E-CLIENTES.md, Task 30), over its
// message box: who shared how far back, Add to this device, which takes it in only on the person's word (Ruling 22),
// and Dismiss, which lets it go for good; the engine gives its newest three.
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
	onDismiss: async () => {},
});
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replaceAll("\r\n", "\n");
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
		expect(html).toMatch(/<button [^>]*>\s*Dismiss\s*<\/button>/);
		// One whose range isn't one of the four reads as the whole history.
		expect(drawn([offer(null)])).toContain(notice("shared_with_you", { a: "Ana", range: NOTICES.range_all }));
		// Each offer its own row and its own buttons.
		const buttons = (await tags(SharedHistoryOffer, props([offer("day"), offer("all")]))).filter(
			(tag) => tag.name === "button",
		);
		expect(buttons).toHaveLength(4);
	});

	test("is a conversation's, which hands it the person's Add and Dismiss, and draws the rows an import brought", () => {
		const view = source("../ConversationView.svelte");
		expect(view).toContain("onAdd={(shareId) => importShared(conversation.id, shareId).then(() => {})}");
		expect(view).toContain("onDismiss={(shareId) => dismissShared(conversation.id, shareId)}");
		// An import tells the view the conversation's rows changed (history.test.ts); the rows from before the person
		// joined it, which it brought, show as the list's rows change, and the pages before them are asked for again.
		const older = view.slice(view.indexOf("let olderHeld = $state(false);"));
		expect(older.slice(0, older.indexOf("heldBeforeEncrypted(convId, oldest)"))).toContain("void drawn.rows.length;");
	});
});
