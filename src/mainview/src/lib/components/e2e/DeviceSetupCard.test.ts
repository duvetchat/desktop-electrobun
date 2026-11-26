import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import type { DeviceSetup } from "$lib/e2e/engine/engine";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "../server-render";

// A new device's setup (PLAN-E2E-CLIENTES.md, Task 26; decisions 24 and 47): with the recovery key, with another device
// of the person's, or by starting over, which says what's lost before anything runs.
// The confirmation's store, a .svelte.ts module, uses $state, which only Svelte's compiler knows: here it's the value
// itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { default: DeviceSetupCard } = await import("./DeviceSetupCard.svelte");

const props = (setup?: DeviceSetup) => ({
	setup,
	onRecover: async () => {},
	onUseCode: async () => {},
	onAcceptCode: async () => {},
	onReset: async () => {},
});
const drawn = (setup?: DeviceSetup) =>
	render(DeviceSetupCard, { props: props(setup) }).body.replace(/<!--[^]*?-->/g, "");
const source = readFileSync(join(import.meta.dir, "DeviceSetupCard.svelte"), "utf8").replaceAll("\r\n", "\n");

describe("a new device's setup", () => {
	test("offers the recovery key, another device and starting over", () => {
		const html = drawn({ way: "qr", qr: "omRib2R5WJ6mYXYB" });
		for (const heading of [en.e2e_setup_key_heading, en.e2e_setup_approve_heading, en.e2e_setup_start_over_heading]) {
			expect(html).toContain(heading);
		}
		expect(html).toContain(en.e2e_recovery_key_use);
		expect(html).toContain('role="img"');
		expect(html).toMatch(new RegExp(`<button [^>]*>\\s*${en.e2e_start_over}\\s*</button>`));
	});

	test("starting over says what's lost, and asks, before it runs", () => {
		// The history can't be read any more, and contacts see the identity change (decision 47).
		expect(NOTICES.start_over_warning).toMatch(/history/);
		expect(NOTICES.start_over_warning).toMatch(/contacts/);
		expect(en.e2e_start_over_warning).toBe(NOTICES.start_over_warning);
		expect(source).toContain('confirmAction(t("e2e_start_over_warning"), t("e2e_start_over"), onReset)');
		expect(source).not.toMatch(/onclick=\{[^}]*onReset/);
	});
});
