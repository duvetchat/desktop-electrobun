import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import type { EngineState } from "$lib/e2e/engine/engine";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// What the app says of its encrypted conversations by the engine's state (PLAN-E2E-CLIENTES.md, «El motor», its states):
// nothing while it starts or once it's ready; else a bar with the state's notice and, where the person can do
// something, its button. The first device's recovery key is a dialog of its own, which only a browser draws.
// The confirmation's store, a .svelte.ts module, uses $state, which only Svelte's compiler knows: here it's the value
// itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { default: EncryptionGate } = await import("./EncryptionGate.svelte");

const props = (state: EngineState, web = false) => ({
	encryption: state,
	web,
	onMakeIdentity: async () => {},
	onKeySaved: async () => {},
	onLater: async () => {},
	onStartOver: async () => {},
	onFinishKeys: async () => {},
	setupActions: {
		recover: async () => {},
		beginApproval: async () => {},
		useCode: async () => {},
		acceptCode: async () => {},
		endApproval: async () => {},
		resetIdentity: async () => {},
		finishSetup: async () => {},
	},
	approvalActions: { approve: async () => {}, decline: async () => {}, confirm: async () => {} },
});
const drawn = (state: EngineState, web = false) =>
	render(EncryptionGate, { props: props(state, web) }).body.replace(/<!--[^]*?-->/g, "");
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replaceAll("\r\n", "\n");
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

	// Task 24: a rotation's new recovery key is a dialog of its own; one cut before its upload waits for the person's tap.
	test("a rotation's new key has the screen, and one cut before its upload is finished by the person's tap", () => {
		expect(drawn({ name: "ready", rotation: { recoveryKey: "1".repeat(48) } })).not.toContain(en.e2e_rotation_finish);
		const finishing = drawn({ name: "ready", rotation: { recoveryKey: null } });
		expect(finishing).toContain(en.e2e_rotation_finish);
		expect(finishing).toMatch(/<button [^>]*>\s*Finish\s*<\/button>/);
	});

	// I1: a change of keys a removal elsewhere left unable to finish says why, and the two ways out.
	test("a change of keys that can't finish says why and what to do, and offers no Finish", () => {
		const stuck = drawn({ name: "ready", rotation: { recoveryKey: null, stuck: true } });
		expect(stuck).toContain(en.e2e_rotation_stuck);
		expect(stuck).not.toMatch(/<button [^>]*>\s*Finish\s*<\/button>/);
	});

	test("says it in the notices' words", () => {
		expect(en.e2e_removed_device).toBe(NOTICES.removed_device);
		expect(en.e2e_locked).toBe(NOTICES.locked);
		expect(en.e2e_unsupported_browser).toBe(NOTICES.unsupported_browser);
		expect(en.e2e_delete_device).toBe(NOTICES.delete_device);
	});

	// M6: starting over destroys the device's database, its keys with it.
	test("what deletes the device's data asks first, saying what goes", () => {
		const gate = source("EncryptionGate.svelte");
		expect(gate).toContain(
			'const confirmed = (label: string) => () => confirmAction(t("e2e_start_over_confirm"), label, onStartOver);',
		);
		expect(gate).toContain('label: t("e2e_set_up_again"), run: confirmed(t("e2e_set_up_again")) }');
		expect(gate).toContain('label: t("e2e_delete_device"), run: confirmed(t("e2e_delete_device")) }');
		// Nothing else runs it.
		expect(gate.match(/onStartOver\b/g)).toHaveLength(3);
		expect(en.e2e_start_over_confirm).toContain("Delete this device's encrypted conversations and their keys");
	});

	// Task 26: a new device is set up in a card of its own, from its bar; one whose setup waits to finish says so.
	test("a new device's bar opens its setup, and one that waits to finish has Finish", () => {
		expect(drawn({ name: "new_device" })).toMatch(/<button [^>]*>\s*Set up\s*<\/button>/);
		// The card's ways shown, the bar stays as it was.
		expect(drawn({ name: "new_device", setup: { way: "qr", qr: "omRib2R5" } })).toContain(en.e2e_new_device);
		const listing = drawn({ name: "new_device", setup: { way: "finishing" } });
		expect(listing).toContain(en.e2e_new_device_finish);
		expect(listing).toMatch(/<button [^>]*>\s*Finish\s*<\/button>/);
		const reset = drawn({ name: "new_device", setup: { way: "reset", recoveryKey: null, finishing: true } });
		expect(reset).toContain(en.e2e_reset_finish);
		expect(reset).toMatch(/<button [^>]*>\s*Finish\s*<\/button>/);
		// Starting over's new key has the screen, as a first device's.
		const key = drawn({ name: "new_device", setup: { way: "reset", recoveryKey: "1".repeat(48), finishing: false } });
		expect(key).not.toContain(en.e2e_new_device);
		const gate = source("EncryptionGate.svelte");
		expect(gate).toMatch(/<Sheet\b[^>]*>\s*<DeviceSetupCard\b/);
	});

	test("another device's request to be approved is a question of its own, never a bar", () => {
		const approval = {
			...{ device: "01a2161e-0000-7000-8000-000000000001", name: "Chrome on Linux" },
			...{ fingerprint: "0123 4567 89ab cdef", step: "asked" as const },
		};
		expect(drawn({ name: "ready", approval }).trim()).toBe("");
		expect(drawn({ name: "ready", approval: { ...approval, step: "confirmed" } }).trim()).toBe("");
		const gate = source("EncryptionGate.svelte");
		expect(gate).toMatch(/<Dialog\b[^>]*title=\{approvalTitle\(/);
		expect(gate).toContain("<ApprovalPrompt");
	});

	// M1: one stack for the app's bottom bars, which neither places by itself.
	test("its bar is in the page's stack of bottom bars, with the notification permission's", async () => {
		const [bar] = (await tags(EncryptionGate, props({ name: "new_device" }))).filter(
			(tag) => tag.attributes.role === "region",
		);
		expect(bar?.attributes.class).not.toMatch(/\bfixed\b/);
		expect(source("../NotificationPermissionBar.svelte")).not.toMatch(/\bfixed\b/);
		expect(source("../../../routes/app/+page.svelte")).toMatch(
			/<div class="fixed [^"]*\bflex-col\b[^"]*">\s*<NotificationPermissionBar \/>\s*<EncryptionGate\b/,
		);
	});

	// Review M6: a first list that leaves out devices names them before Bun's box asks.
	test("a first list that leaves devices out names them, by their IDs' start, with Finish", () => {
		const html = drawn({ name: "new_device", setup: { way: "finishing", leavingOut: ["01a21626", "01a21627"] } });
		expect(html).toContain(en.e2e_first_list_leaves_out.replace("{devices}", "01a21626 and 01a21627"));
		expect(html).toMatch(/<button [^>]*>\s*Finish\s*<\/button>/);
	});
});
