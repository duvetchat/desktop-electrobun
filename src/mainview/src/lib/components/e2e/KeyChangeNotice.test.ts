import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import { notice, NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// A contact's changed key over a conversation's message box (PLAN-E2E-CLIENTES.md, Task 28; decision 25): the plain
// notice, or the strong one of a contact the person had verified, each with the way to their security number and a
// close.
const { default: KeyChangeNotice } = await import("./KeyChangeNotice.svelte");

const props = (verified: boolean) => ({ name: "Bo", verified, onVerify: () => {}, onClose: () => {} });
const drawn = (verified: boolean) =>
	render(KeyChangeNotice, { props: props(verified) })
		.body.replace(/<!--[^]*?-->/g, "")
		.replaceAll("&#39;", "'");
const buttons = async (verified: boolean) =>
	(await tags(KeyChangeNotice, props(verified))).filter((tag) => tag.name === "button");

describe("a changed key's notice", () => {
	test("says whose key changed, with their security number to check and a close", async () => {
		const html = drawn(false);
		expect(html).toContain(notice("key_changed", { name: "Bo" }));
		expect(html).not.toContain(notice("key_changed_verified", { name: "Bo" }));
		expect(html).toMatch(/<button [^>]*>\s*Verify security number\s*<\/button>/);
		const close = (await buttons(false)).find((button) => button.attributes["aria-label"] === en.e2e_key_changed_close);
		expect(close).toBeDefined();
		expect((await tags(KeyChangeNotice, props(false)))[0]?.attributes.role).toBe("status");
	});

	test("a contact the person had verified: the strong notice, which says to check before sending", () => {
		const html = drawn(true);
		expect(html).toContain(notice("key_changed", { name: "Bo" }));
		expect(html).toContain(notice("key_changed_verified", { name: "Bo" }));
	});

	test("says it in the notices' words", () => {
		expect(en.e2e_key_changed).toBe(NOTICES.key_changed);
		expect(en.e2e_key_changed_verified).toBe(NOTICES.key_changed_verified);
		expect(en.e2e_verify_number).toBe(NOTICES.verify_number);
	});
});
