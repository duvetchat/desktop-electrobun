import { afterEach, describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import { tags } from "../server-render";
import { restarting, updateOffer } from "$lib/app-update";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";

// What a direct message says once the API answered 426 (PLAN-E2E-CLIENTES.md, «El motor», its state update, and its
// notices): update Duvet, from its download page or, in the desktop app with a version ready, from the title bar's
// Restart to update; or, where the platform has no end-to-end encryption yet (the API names no minimum), that.
const { default: UpdateNotice } = await import("./UpdateNotice.svelte");

/** What it draws, without the comments Svelte marks its blocks with. */
const drawn = (minimum: string | null) =>
	render(UpdateNotice, { props: { minimum } }).body.replace(/<!--[^]*?-->/g, "");
const named = (minimum: string | null, name: string) =>
	tags(UpdateNotice, { minimum }).then((found) => found.filter((tag) => tag.name === name));

afterEach(() => {
	updateOffer.set(null);
	restarting.set(false);
});

describe("a DM's update notice", () => {
	test("says to update Duvet, with the link to its download page", async () => {
		const html = drawn("1.2.0");
		expect(html).toContain(">Update Duvet<");
		expect(html).toMatch(/<a [^>]*>\s*(?:<svg[^]*<\/svg>\s*)?duvet\.chat\/download\s*<\/a>/);
		const links = await named("1.2.0", "a");
		expect(links.map((link) => link.attributes.href)).toEqual(["https://duvet.chat/download"]);
		expect(links[0]?.attributes).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
		expect(await named("1.2.0", "button")).toEqual([]);
	});

	test("in the desktop app with a version ready, offers the title bar's Restart to update instead", async () => {
		updateOffer.set({ version: "1.2.0", how: "restart" });
		expect(drawn("1.2.0")).toContain(">Update Duvet<");
		expect(drawn("1.2.0")).toMatch(/<button [^>]*>\s*(?:<svg[^]*<\/svg>\s*)?Restart to update\s*<\/button>/);
		expect(await named("1.2.0", "a")).toEqual([]);
		const [button] = await named("1.2.0", "button");
		expect(button?.attributes).toMatchObject({ type: "button" });
		expect(button?.attributes).not.toHaveProperty("disabled");

		// Pressed, it waits for the app to close, as the title bar's does.
		restarting.set(true);
		expect(drawn("1.2.0")).toContain("Restarting…");
		expect((await named("1.2.0", "button"))[0]?.attributes).toHaveProperty("disabled");
	});

	// Bun downloads a version it can't apply in that app folder (lib/app-update.ts): the page gives it.
	test("for a version Bun can't apply, links to the download page", async () => {
		updateOffer.set({ version: "1.2.0", how: "download" });
		expect((await named("1.2.0", "a")).map((link) => link.attributes.href)).toEqual(["https://duvet.chat/download"]);
		expect(await named("1.2.0", "button")).toEqual([]);
	});

	test("says the platform has no encrypted conversations yet when the API names no minimum", async () => {
		updateOffer.set({ version: "1.2.0", how: "restart" });
		expect(drawn(null)).toContain("Direct messages aren't available in this app yet. Use Duvet on the web.");
		expect(drawn(null)).not.toContain("Update Duvet");
		expect(await named(null, "a")).toEqual([]);
		expect(await named(null, "button")).toEqual([]);
	});

	// Both apps say the notices word for word (lib/e2e/notices.ts, which the mobile app's test holds to the same table).
	test("says it in the notices' words", () => {
		expect(en.e2e_update).toBe(NOTICES.update);
		expect(en.e2e_no_e2e_here).toBe(NOTICES.no_e2e_here);
	});
});
