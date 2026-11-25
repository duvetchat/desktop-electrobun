import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "../server-render";

// A conversation's row this device doesn't hold yet (PLAN-E2E-CLIENTES.md, «La vista de una conversación»): it says it
// waits, and why, in the notices' words; so do the lines above a conversation and a send the API refused.
const { default: WaitingMessage } = await import("./WaitingMessage.svelte");

describe("a message that waits", () => {
	test("says it waits for the sender's device", () => {
		const drawn = render(WaitingMessage, { props: {} }).body.replaceAll("&#39;", "'");
		expect(drawn).toContain(NOTICES.waiting);
		expect(drawn).toContain(NOTICES.waiting_detail);
	});

	test("says it in the notices' words", () => {
		expect(en.e2e_waiting).toBe(NOTICES.waiting);
		expect(en.e2e_waiting_detail).toBe(NOTICES.waiting_detail);
		expect(en.e2e_cutover).toBe(NOTICES.cutover);
		expect(en.e2e_before_joining).toBe(NOTICES.before_joining);
		expect(en.e2e_paused).toBe(NOTICES.paused);
		expect(en.e2e_too_long).toBe(NOTICES.too_long);
		expect(en.e2e_shared_by).toBe(NOTICES.shared_by);
	});
});
