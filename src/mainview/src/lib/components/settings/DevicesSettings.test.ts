// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "../server-render";
import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import type { Device } from "$lib/api/e2e";
import type { EngineState } from "$lib/e2e/engine/engine";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";

// Settings → Devices (PLAN-E2E-CLIENTES.md, Task 24; decisions 13 and 52): the user's devices, each one's client and
// when it was last seen, this one, those not seen in 45 days; removing another, changing the keys, and deleting this
// one's data, each where it can be done. Its dialogs only a browser draws.
// The confirmation's store, a .svelte.ts module, uses $state, which only Svelte's compiler knows: here it's the value
// itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const {
	default: DevicesSettings,
	askToChangeKeys,
	askToDeleteThisDevice,
	removalNotes,
} = await import("./DevicesSettings.svelte");
const { confirmStore } = await import("$lib/stores/confirm.svelte");

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse("2026-11-25T12:00:00Z");
const seen = (days: number) => new Date(NOW - days * DAY).toISOString();
const device = (id: string, name: string, more: Partial<Device> = {}): Device => ({
	...{ id, name, client: "web/1.2.0", listed: true, current: false },
	...{ created_at: seen(60), last_seen_at: seen(1) },
	...more,
});
const THIS = device("0193a4b2-0000-7000-8000-0000000000a1", "Duvet for Windows", {
	client: "desktop-windows/1.2.0",
	current: true,
});
const PHONE = device("0193a4b2-0000-7000-8000-0000000000a2", "Pixel 8 Pro", {
	client: "android/1.1.0",
	last_seen_at: seen(50),
});
const BROWSER = device("0193a4b2-0000-7000-8000-0000000000a3", "Firefox on Linux", { listed: false });

const props = (more: Record<string, unknown> = {}) => ({
	devices: [THIS, PHONE, BROWSER],
	failed: false,
	encryption: { name: "ready" } as EngineState,
	web: false,
	storageKept: null,
	now: NOW,
	onReload: () => {},
	onRemove: async () => {},
	onChangeKeys: async () => {},
	onRemoveThis: async () => {},
	...more,
});
const drawn = (more: Record<string, unknown> = {}) =>
	render(DevicesSettings, { props: props(more) }).body.replace(/<!--[^]*?-->/g, "");
const buttons = (html: string, label: string) =>
	[...html.matchAll(/<button [^>]*>\s*(?:<svg[^]*?<\/svg>\s*)?([^<]*?)\s*<\/button>/g)].filter(
		(match) => match[1] === label,
	).length;
const count = (html: string, text: string) => html.split(text).length - 1;

describe("Settings' devices", () => {
	test("list each device with its client and when it was last seen, this one and one not seen in 45 days marked", () => {
		const html = drawn();
		for (const { name, client } of [THIS, PHONE, BROWSER]) {
			expect(html).toContain(name);
			expect(html).toContain(client);
		}
		expect(count(html, en.e2e_this_device)).toBe(1);
		expect(count(html, NOTICES.inactive_device)).toBe(1);
		expect(html.indexOf(NOTICES.inactive_device)).toBeGreaterThan(html.indexOf(PHONE.name));
		expect(count(html, en.e2e_device_not_set_up)).toBe(1);
		expect(html.indexOf(en.e2e_device_not_set_up)).toBeGreaterThan(html.indexOf(BROWSER.name));
	});

	test("offer to remove the other devices and to change the keys only while this one is ready", () => {
		const ready = drawn();
		expect(buttons(ready, en.e2e_device_remove)).toBe(2);
		expect(buttons(ready, en.e2e_change_keys)).toBe(1);
		for (const encryption of [{ name: "new_device" }, { name: "ready", rotation: { recoveryKey: null } }]) {
			const html = drawn({ encryption });
			expect(buttons(html, en.e2e_device_remove)).toBe(0);
			expect(buttons(html, en.e2e_change_keys)).toBe(0);
		}
	});

	test("offer to delete this device's data where it has some", () => {
		expect(buttons(drawn(), NOTICES.delete_device)).toBe(1);
		expect(buttons(drawn({ encryption: { name: "new_device" } }), NOTICES.delete_device)).toBe(1);
		for (const name of ["unsupported", "locked", "starting"]) {
			expect(buttons(drawn({ encryption: { name } }), NOTICES.delete_device)).toBe(0);
		}
	});

	test("say, on the web, when the browser didn't agree to keep this device's data", () => {
		expect(drawn({ web: true, storageKept: false })).toContain(en.e2e_storage_not_kept);
		expect(drawn({ web: true, storageKept: true })).not.toContain(en.e2e_storage_not_kept);
		expect(drawn({ web: true, storageKept: null })).not.toContain(en.e2e_storage_not_kept);
		expect(drawn({ web: false, storageKept: false })).not.toContain(en.e2e_storage_not_kept);
	});

	test("say when they're loading, and when they couldn't be read, with Try again", () => {
		expect(drawn({ devices: null })).toContain(en.e2e_devices_loading);
		const failed = drawn({ devices: null, failed: true });
		expect(failed).toContain(en.e2e_devices_failed);
		expect(buttons(failed, en.e2e_try_again)).toBe(1);
	});

	// M1 and I1: a change that waits, with no key on screen, is finished from here too; one that can't finish says so.
	test("offer to finish a change of keys that waits, or say why it can't and what to do", () => {
		const waiting = drawn({ encryption: { name: "ready", rotation: { recoveryKey: null } } });
		expect(waiting).toContain(en.e2e_finish_keys);
		expect(buttons(waiting, en.e2e_finish)).toBe(1);
		const stuck = drawn({ encryption: { name: "ready", rotation: { recoveryKey: null, stuck: true } } });
		expect(stuck).toContain(en.e2e_rotation_stuck);
		expect(buttons(stuck, en.e2e_finish)).toBe(0);
		// A key on screen is its own dialog's.
		const shown = drawn({ encryption: { name: "ready", rotation: { recoveryKey: "1".repeat(48) } } });
		expect(shown).not.toContain(en.e2e_finish_keys);
		expect(drawn()).not.toContain(en.e2e_finish_keys);
	});

	// I2 and M6: the confirmation says what's lost for each case, and names the recovery key on every listed device.
	test("ask before deleting this device's data in its case's words", () => {
		const asked = (devices: Device[] | null) => {
			void askToDeleteThisDevice(devices, async () => {});
			const message = confirmStore.pending?.message;
			confirmStore.cancel();
			return message;
		};
		expect(asked([THIS, BROWSER])).toBe(en.e2e_delete_only_device_confirm);
		expect(asked([THIS, PHONE, BROWSER])).toBe(en.e2e_delete_listed_device_confirm);
		expect(asked([{ ...THIS, listed: false }, PHONE])).toBe(en.e2e_delete_device_confirm);
		expect(asked(null)).toBe(en.e2e_delete_only_device_confirm);
		for (const listed of [en.e2e_delete_only_device_confirm, en.e2e_delete_listed_device_confirm]) {
			expect(listed).toContain("recovery key");
		}
		expect(en.e2e_delete_listed_device_confirm).toContain("device list");
	});

	// M7 and M3: the dialog names the device as Bun's box does, by its ID, and what an earlier removal takes along.
	test("name a device in its removal by its ID's start, and what an earlier removal takes along", () => {
		const alone = removalNotes(PHONE, [], [THIS, PHONE, BROWSER]).join(" ");
		expect(alone).toContain(PHONE.id.slice(0, 8));
		expect(alone).not.toContain(BROWSER.name);
		const along = removalNotes(PHONE, [BROWSER.id], [THIS, PHONE, BROWSER]).join(" ");
		expect(along).toContain(BROWSER.name);
	});

	test("ask before changing the keys, naming what an earlier removal takes along", () => {
		void askToChangeKeys([THIS, PHONE, BROWSER], [], async () => {});
		expect(confirmStore.pending?.message).toBe(en.e2e_change_keys_confirm);
		confirmStore.cancel();
		void askToChangeKeys([THIS, PHONE, BROWSER], [PHONE.id], async () => {});
		const message = confirmStore.pending?.message ?? "";
		confirmStore.cancel();
		expect(message).toContain(en.e2e_change_keys_confirm);
		expect(message).toContain(PHONE.name);
	});

	// Both apps say the notices word for word (lib/e2e/notices.ts, which the mobile app's test holds to the same table).
	test("say it in the notices' words", () => {
		expect(en.e2e_inactive_device).toBe(NOTICES.inactive_device);
		expect(en.e2e_inactive_warning).toBe(NOTICES.inactive_warning);
		expect(en.e2e_device_added).toBe(NOTICES.device_added);
		expect(en.e2e_delete_device).toBe(NOTICES.delete_device);
		expect(en.e2e_removed_device).toBe(NOTICES.removed_device);
	});
});
