// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "../server-render";
import { describe, expect, test } from "bun:test";
import { formatDate } from "$lib/i18n/format";
import { render } from "svelte/server";
import type { Device } from "$lib/api/e2e";
import type { BackupShown, EngineState } from "$lib/e2e/engine/engine";
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
	dropped,
	removalNotes,
	removalProblem,
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
/** A device another one took off, whose registration went with its name. */
const GONE = "0193b7c1-0000-7000-8000-0000000000a4";
/** What a device the API no longer lists is said with: the person's way out. */
const CANCEL = "If you didn't remove it or change your password, cancel.";

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

	// Task 26, from task 24's review (M2): a device this one approved has no certificate until its own list goes up, and a
	// list or a change of keys made meanwhile would leave it out.
	test("while a device this one approved sets up, offer no removal or change of keys, and say why", () => {
		const approval = { device: BROWSER.id, name: BROWSER.name, fingerprint: "0123 4567 89ab cdef", step: "confirmed" };
		const html = drawn({ encryption: { name: "ready", approval } });
		expect(buttons(html, en.e2e_device_remove)).toBe(0);
		expect(buttons(html, en.e2e_change_keys)).toBe(0);
		expect(html).toContain(en.e2e_approval_waits);
		expect(drawn()).not.toContain(en.e2e_approval_waits);
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
		expect(buttons(stuck, en.e2e_finish_without)).toBe(0);
		// duvetchat/e2e#49: one held by devices the API no longer has goes on without them, named by their IDs' start (their
		// names went with them); one another device's change made impossible says so, with nothing to press.
		const gone = drawn({ encryption: { name: "ready", rotation: { recoveryKey: null, stuck: true, gone: [GONE] } } });
		expect(gone).toContain(en.e2e_rotation_gone.replace("{devices}", GONE.slice(0, 8)));
		expect(buttons(gone, en.e2e_finish_without)).toBe(1);
		expect(buttons(gone, en.e2e_finish)).toBe(0);
		const relisted = drawn({
			encryption: { name: "ready", rotation: { recoveryKey: null, stuck: true, gone: [GONE], relisted: true } },
		});
		expect(relisted).toContain(en.e2e_rotation_relisted);
		expect(buttons(relisted, en.e2e_finish_without)).toBe(0);
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
		const alone = removalNotes(PHONE, { along: [], away: [] }, [THIS, PHONE, BROWSER]).join(" ");
		expect(alone).toContain(PHONE.id.slice(0, 8));
		expect(alone).not.toContain(BROWSER.name);
		const along = removalNotes(PHONE, { along: [BROWSER.id], away: [] }, [THIS, PHONE, BROWSER]).join(" ");
		expect(along).toContain(BROWSER.name);
	});

	// #575 (I2): on the web the dialog is the only question. A device the server no longer lists, which the list this
	// removal signs takes off too, is named there, and is what goes with the person's yes.
	test("name the devices the server no longer lists, which the list takes off too", () => {
		const notes = removalNotes(PHONE, { along: [], away: [GONE, PHONE.id] }, [THIS, PHONE, BROWSER]);
		const away = `Duvet no longer lists the device whose ID starts with ${GONE.slice(0, 8)}. ${CANCEL}`;
		expect(notes).toContain(away);
		expect(dropped({ along: [BROWSER.id], away: [GONE, PHONE.id] }, PHONE.id)).toEqual([BROWSER.id, GONE]);
		void askToChangeKeys([THIS, PHONE], { along: [], away: [GONE] }, async () => {});
		const message = confirmStore.pending?.message ?? "";
		confirmStore.cancel();
		expect(message).toContain(away);
	});

	// #575 (N-M7): a device the API no longer lists is named by what's known of it (its name, its client and when it was
	// added), by its ID only when nothing else is; and the words don't tell the server's story in the app's voice: if the
	// person removed nothing and changed no password, they cancel.
	test("name a device the API no longer lists by what's known of it, and say to cancel", () => {
		const known = { [GONE]: { name: "Galaxy Tab", client: "android/1.0.0", created_at: "2026-11-03T10:00:00Z" } };
		const date = formatDate(Date.parse("2026-11-03T10:00:00Z"), { dateStyle: "medium" });
		const named = `Duvet no longer lists Galaxy Tab (android/1.0.0, added ${date}). ${CANCEL}`;
		expect(removalNotes(PHONE, { along: [], away: [GONE], known }, [THIS, PHONE])).toContain(named);
		void askToChangeKeys([THIS, PHONE], { along: [], away: [GONE], known }, async () => {});
		const message = confirmStore.pending?.message ?? "";
		confirmStore.cancel();
		expect(message).toContain(named);
	});

	// R-M3: what names a device the API no longer lists is the API's last word on it. One it named otherwise since this
	// device first saw it is named both ways, its first first.
	test("name a device the API named anew by what it was first and what it was listed as later", () => {
		const first = { name: "Galaxy Tab", client: "android/1.0.0", created_at: "2026-11-03T10:00:00Z" };
		const known = {
			[GONE]: { name: "Old test phone", client: "web/1.0.0", created_at: "2026-11-20T10:00:00Z", first },
		};
		const date = (at: string) => formatDate(Date.parse(at), { dateStyle: "medium" });
		const was = `Galaxy Tab (android/1.0.0, added ${date(first.created_at)})`;
		const later = `Old test phone (web/1.0.0, added ${date("2026-11-20T10:00:00Z")})`;
		const named = `Duvet no longer lists ${was} (listed later as ${later}). ${CANCEL}`;
		expect(removalNotes(PHONE, { along: [], away: [GONE], known }, [THIS, PHONE])).toContain(named);
		void askToChangeKeys([THIS, PHONE], { along: [], away: [GONE], known }, async () => {});
		const message = confirmStore.pending?.message ?? "";
		confirmStore.cancel();
		expect(message).toContain(named);
	});

	// R-M3, both apps' wording: «This also removes …» names each device as the no-longer-listed sentence does, by what's
	// known of it, its first words too where the API named it otherwise since, and by the start of its ID where nothing is.
	test("name what an earlier removal takes along as the no-longer-listed sentence names a device", () => {
		const first = { name: "Galaxy Tab", client: "android/1.0.0", created_at: "2026-11-03T10:00:00Z" };
		const known = {
			[GONE]: { name: "Old test phone", client: "web/1.0.0", created_at: "2026-11-20T10:00:00Z", first },
		};
		const date = (at: string) => formatDate(Date.parse(at), { dateStyle: "medium" });
		const both = `Galaxy Tab (android/1.0.0, added ${date(first.created_at)}) (listed later as Old test phone (web/1.0.0, added ${date("2026-11-20T10:00:00Z")}))`;
		const notes = removalNotes(PHONE, { along: [GONE], away: [], known }, [THIS, PHONE]);
		expect(notes).toContain(`This also removes ${both}, whose earlier removal didn't finish.`);
		const bare = removalNotes(PHONE, { along: [GONE], away: [] }, [THIS, PHONE]);
		expect(bare).toContain(
			`This also removes the device whose ID starts with ${GONE.slice(0, 8)}, whose earlier removal didn't finish.`,
		);
	});

	// The core's R1: after a change of keys that went on without devices, one of them may hold the keys still.
	test("offer another change of keys after one that went on without devices", () => {
		expect(drawn({ encryption: { name: "ready", keysAgain: true } })).toContain(en.e2e_keys_again);
		expect(drawn()).not.toContain(en.e2e_keys_again);
		expect(buttons(drawn({ encryption: { name: "ready", keysAgain: true } }), en.e2e_change_keys)).toBe(1);
	});

	test("ask before changing the keys, naming what an earlier removal takes along", () => {
		void askToChangeKeys([THIS, PHONE, BROWSER], { along: [], away: [] }, async () => {});
		expect(confirmStore.pending?.message).toBe(en.e2e_change_keys_confirm);
		confirmStore.cancel();
		void askToChangeKeys([THIS, PHONE, BROWSER], { along: [PHONE.id], away: [] }, async () => {});
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

	// Review I1: the API's refusal of a list naming a device this one approved that never finished, in words.
	test("say in words why a removal failed", async () => {
		const { FetchError } = await import("$lib/api/api");
		const { CoreError } = await import("$lib/e2e/errors");
		const refused = (error: string) =>
			new FetchError(
				"Request failed with status 400",
				{},
				{
					...{ data: { error }, status: 400, statusText: "Bad Request" },
					headers: new Headers(),
				},
			);
		expect(
			removalProblem(refused("the list names device 0193a4b2-0000, which has no certificate of this identity")),
		).toBe(en.e2e_device_unfinished);
		expect(removalProblem(new CoreError("approval_waits", ""))).toBe(en.e2e_approval_waits);
		expect(removalProblem(new TypeError("fetch failed"))).toBe("fetch failed");
	});

	test("say how the encrypted backup is on a ready device: up to date, going up, restoring, or paused and why", () => {
		const ready = (backup?: BackupShown) => drawn(backup ? { backup } : {});
		// Until the engine says it's up to date, it isn't (Task 32's review, I3).
		const told = ready();
		expect(told).toContain(NOTICES.backup);
		expect(told).toContain(NOTICES.backup_uploading);
		expect(told).not.toContain(NOTICES.backup_up_to_date);
		expect(ready({ state: "up_to_date" })).toContain(NOTICES.backup_up_to_date);
		expect(ready({ state: "uploading" })).toContain(NOTICES.backup_uploading);
		expect(ready({ state: "uploading" })).not.toContain(NOTICES.backup_up_to_date);
		expect(ready({ state: "restoring", done: 12, total: 340 })).toContain("Restoring your messages: 12 of 340");
		expect(ready({ state: "paused", reason: "full" })).toContain(NOTICES.backup_paused);
		expect(ready({ state: "paused", reason: "too_large" })).toContain(NOTICES.backup_too_large);
		// A device not set up has no backup of its own to tell of.
		expect(drawn({ encryption: { name: "new_device" }, backup: { state: "up_to_date" } })).not.toContain(
			NOTICES.backup,
		);
	});

	// Review 27's M4: the core's refusal of a change of keys keeping a device this one approved that never finished.
	test("say a change of keys a device that never finished setting up holds in the removal's words", async () => {
		const { CoreError } = await import("$lib/e2e/errors");
		const unfinished = new CoreError("bad_command", "a device that stays has no certificate", {
			field: "certificates",
		});
		expect(removalProblem(unfinished)).toBe(en.e2e_device_unfinished);
		void askToChangeKeys([THIS, PHONE], { along: [], away: [] }, () => Promise.reject(unfinished));
		await confirmStore.execute();
		const said = confirmStore.error;
		confirmStore.cancel();
		expect(said).toBe(en.e2e_device_unfinished);
	});
});
