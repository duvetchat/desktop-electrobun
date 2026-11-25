import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import type { EngineState } from "$lib/e2e/engine/engine";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// What the app says of its encrypted conversations by the engine's state (PLAN-E2E-CLIENTES.md, «El motor», its states):
// nothing while it starts or once it's ready; else a bar with the state's notice and, where the person can do
// something, its button. The first device's recovery key is a dialog of its own, which only a browser draws.
const { default: EncryptionGate } = await import("./EncryptionGate.svelte");

const props = (state: EngineState, web = false) => ({
	encryption: state,
	web,
	onMakeIdentity: async () => {},
	onKeySaved: async () => {},
	onStartOver: async () => {},
});
const drawn = (state: EngineState, web = false) =>
	render(EncryptionGate, { props: props(state, web) }).body.replace(/<!--[^]*?-->/g, "");
const buttons = async (state: EngineState, web = false) =>
	(await tags(EncryptionGate, props(state, web))).filter((tag) => tag.name === "button");

describe("the encryption gate", () => {
	test("says nothing while the engine starts, nor once it's ready", () => {
		expect(drawn({ name: "starting" }).trim()).toBe("");
		expect(drawn({ name: "ready" }).trim()).toBe("");
	});

	test("asks a first device to set up encryption, or to finish it, by the person's tap", async () => {
		const first = drawn({ name: "first_device", recoveryKey: null, finishing: false });
		expect(first).toContain(en.e2e_first_device);
		expect(first).toMatch(/<button [^>]*>\s*Set up\s*<\/button>/);
		const finishing = drawn({ name: "first_device", recoveryKey: null, finishing: true });
		expect(finishing).toContain(en.e2e_first_device_finish);
		expect(finishing).toMatch(/<button [^>]*>\s*Finish\s*<\/button>/);
	});

	test("with the key made, draws no bar: the key's dialog has the screen", () => {
		expect(drawn({ name: "first_device", recoveryKey: "1".repeat(48), finishing: false })).not.toContain(
			en.e2e_first_device,
		);
	});

	test("says what each other state means, and offers what the person can do", async () => {
		expect(drawn({ name: "new_device" })).toContain(en.e2e_new_device);
		const removed = drawn({ name: "removed" });
		expect(removed).toContain(NOTICES.removed_device);
		expect(removed).toMatch(/<button [^>]*>\s*Set up again\s*<\/button>/);
		expect(drawn({ name: "locked" })).toContain(NOTICES.locked);
		expect(drawn({ name: "unsupported" }, true)).toContain(NOTICES.unsupported_browser);
		expect(drawn({ name: "unsupported" })).toContain(NOTICES.no_e2e_here);
		const lost = drawn({ name: "failed", lostKey: true });
		expect(lost).toContain(en.e2e_lost_key);
		expect(lost).toContain(NOTICES.delete_device);
		const passing = drawn({ name: "failed", lostKey: false });
		expect(passing).toContain(en.e2e_failed);
		// Only a dismissal: the engine tries again by itself.
		expect(
			(await buttons({ name: "failed", lostKey: false })).map((button) => button.attributes["aria-label"]),
		).toEqual(["Dismiss"]);
		expect(drawn({ name: "update", minimum: "1.2.0" })).toContain(NOTICES.update);
	});

	test("says it in the notices' words", () => {
		expect(en.e2e_removed_device).toBe(NOTICES.removed_device);
		expect(en.e2e_locked).toBe(NOTICES.locked);
		expect(en.e2e_unsupported_browser).toBe(NOTICES.unsupported_browser);
		expect(en.e2e_delete_device).toBe(NOTICES.delete_device);
	});
});
