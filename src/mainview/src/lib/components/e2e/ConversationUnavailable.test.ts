import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import type { EngineState } from "$lib/e2e/engine/engine";
import { NOTICES } from "$lib/e2e/notices";
import { tags } from "../server-render";

// What a direct message shows where this app can't open encrypted conversations (PLAN-E2E-CLIENTES.md, «El motor», its
// states, and Task 34): a desktop build that carries no core (an Intel Mac's, a Linux arm64 one), a browser without what
// the core needs, and a client the API answered 426. Its messages can't load there and its box can't send, so the
// conversation says why in their place, as the app's bottom bar does, which the person may have closed.
const { default: ConversationUnavailable, unavailableHere } = await import("./ConversationUnavailable.svelte");

/** What it draws for the engine's state, without the comments Svelte marks its blocks with. */
const drawn = (encryption: EngineState, web = false) =>
	render(ConversationUnavailable, { props: { encryption, web } }).body.replace(/<!--[^]*?-->/g, "");
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replaceAll("\r\n", "\n");

describe("a conversation this app can't open", () => {
	test("a platform without the library says so in its DMs", () => {
		// A desktop build without the core's library: the host's open answers unsupported.
		expect(unavailableHere({ name: "unsupported" })).toBe(true);
		expect(drawn({ name: "unsupported" })).toContain(NOTICES.no_e2e_here);
		// The API's 426 for such a platform names no minimum: the same words.
		expect(unavailableHere({ name: "update", minimum: null })).toBe(true);
		expect(drawn({ name: "update", minimum: null })).toContain(NOTICES.no_e2e_here);
		expect(drawn({ name: "update", minimum: null })).not.toContain(NOTICES.update);

		// The conversation's view draws it in place of its messages and its box, never "Couldn't load messages".
		const view = source("../ConversationView.svelte");
		expect(view).toContain("const unavailable = $derived(unavailableHere(encryption.state));");
		expect(view).toMatch(
			/\{#if unavailable\}\s*<div [^>]*>\s*<ConversationUnavailable encryption=\{encryption\.state\} web=\{!isElectrobunWindow\(\)\} \/>\s*<\/div>\s*\{:else\}\s*<Chat\b/,
		);
	});

	test("a browser without what the core needs says so in its own words, and an old client says to update", async () => {
		expect(drawn({ name: "unsupported" }, true)).toContain(NOTICES.unsupported_browser);
		expect(drawn({ name: "unsupported" }, true)).not.toContain(NOTICES.no_e2e_here);
		const old: EngineState = { name: "update", minimum: "1.2.0" };
		expect(drawn(old)).toContain(`>${NOTICES.update}<`);
		const links = (await tags(ConversationUnavailable, { encryption: old, web: false })).filter(
			(tag) => tag.name === "a",
		);
		expect(links.map((link) => link.attributes.href)).toEqual(["https://duvet.chat/download"]);
	});

	test("draws nothing, and the messages show, in every other state", () => {
		const others: EngineState[] = [
			{ name: "starting" },
			{ name: "first_device", recoveryKey: null, finishing: false },
			{ name: "new_device" },
			{ name: "ready" },
			{ name: "removed" },
			{ name: "locked" },
			{ name: "failed", lostKey: false },
		];
		for (const state of others) {
			expect(unavailableHere(state)).toBe(false);
			expect(drawn(state).trim()).toBe("");
		}
	});
});
