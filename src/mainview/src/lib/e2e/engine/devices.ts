// The user's devices (PLAN-E2E-CLIENTES.md, Task 24; decisions 13 and 52): those not seen in 45 days, which the app
// tells of once each; another device taken off the account, off the list by a list signed without it, or with new
// keys (rotate_keys) for one that was lost; and the devices the API took away though the signed list still names them
// (a new password's remove_devices, step 3's ruling 23), which no list or change of keys of this device's names again.
// This device never takes itself off the list: the API takes no list without the session's device.
import { FetchError } from "$lib/api/api";
import type { Device, E2eApi } from "$lib/api/e2e";
import type { UserDevice } from "$lib/types";
import { listDevices } from "../cbor";
import { CoreError } from "../errors";
import { coreStatus, type CoreStatus } from "./bootstrap";
import type { EngineParts, EngineState } from "./engine";
import { observeOwn, servedIdentity } from "./identity";
import { KEPT_ROTATION, TOLD_ADDED, TOLD_INACTIVE, type EngineStore } from "./store";

/** How long a device goes unseen before Settings marks it and the app tells of it once (decisions 13 and 52). */
export const INACTIVE_MS = 45 * 24 * 3600 * 1000;
/** The most devices the record keeps as told of being added: the newest. */
const TOLD_KEPT = 50;
/** How many lists a removal signs when each loses its race to another device's. */
const ROUNDS = 3;

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

/** A refusal the core gives when there's nothing kept of what it's told: the upload was confirmed already. */
export const unlessNothingKept = (error: unknown) => {
	if (!(error instanceof CoreError && error.code === "not_found" && error.what === "upload")) throw error;
};

/** Not seen in 45 days, by when the API last saw it. */
export const inactiveDevice = (device: UserDevice, now = Date.now()) =>
	now - Date.parse(device.last_seen_at) > INACTIVE_MS;

/** This device has data to delete (decision 13): a database that opened, or whose key is lost. Not while another window
 * holds it (locked), before the engine knows (starting), nor where there's no core (unsupported). */
export const hasDeviceData = ({ name }: EngineState) =>
	["first_device", "new_device", "ready", "removed", "failed", "update"].includes(name);

/** This device is the user's one on the list: deleting its data loses what only the recovery key brings back. */
export const onlyDevice = (devices: readonly Device[]) =>
	devices.some(({ current, listed }) => current && listed) &&
	!devices.some(({ current, listed }) => !current && listed);

/** The device IDs the record keeps under `key`. */
function toldIn(store: EngineStore, key: string): string[] {
	const kept = store.read<unknown>(key);
	return Array.isArray(kept) ? kept.filter((id): id is string => typeof id === "string") : [];
}

/** The user's other devices not seen in 45 days that the app hasn't told of yet, now kept as told (each one once). */
export function inactiveToTell(store: EngineStore, devices: readonly Device[], now = Date.now()): Device[] {
	const told = toldIn(store, TOLD_INACTIVE);
	const due = devices.filter((device) => !device.current && inactiveDevice(device, now) && !told.includes(device.id));
	if (due.length) {
		// The devices since removed are forgotten: they never come back (their IDs aren't given again).
		const still = told.filter((id) => devices.some((device) => device.id === id));
		store.write(TOLD_INACTIVE, [...still, ...due.map(({ id }) => id)]);
	}
	return due;
}

/** Whether to tell of a device added to the user's account: once each, as its registration and then its listing come. */
export function addedToTell(store: EngineStore, device: UserDevice): boolean {
	const told = toldIn(store, TOLD_ADDED);
	if (told.includes(device.id)) return false;
	store.write(TOLD_ADDED, [...told, device.id].slice(-TOLD_KEPT));
	return true;
}

/**
 * The devices a list this device holds names that the API no longer registers, never this one: it took them away
 * (remove_devices), and refuses a list that names them. A device it still registers stays though it has no certificate
 * yet (one this device approved, whose own list hasn't gone up: task 24's review, M2), as GET …/devices tells: the
 * Android twin's rule (task 25).
 */
export async function takenAway(api: E2eApi, held: readonly string[], self: string | undefined): Promise<string[]> {
	const registered = new Set((await api.devices()).map(({ id }) => id));
	return held.filter((id) => id !== self && !registered.has(id));
}

/** The devices the list this device holds of its user names. */
const heldDevices = (status: CoreStatus) => (status.device_list && listDevices(status.device_list)) || [];

/**
 * What a list signed now would leave out beside the devices asked for (#575): those the served list names that the list
 * this device holds doesn't (`along`: an earlier list of its own the API never took, which the next one is signed on
 * top of), and those the held list names that the API no longer registers (`away`, takenAway). The person is shown
 * each of them before a list goes.
 */
export interface Drops {
	along: string[];
	away: string[];
}

/**
 * A list goes only with what the person was shown (#575): any device it would leave out that's neither asked for nor
 * named (`shown`), as GET …/devices or the lists changed since the question, and nothing is signed.
 */
function shownAll(dropped: readonly string[], shown: readonly string[]) {
	if (dropped.some((id) => !shown.includes(id))) {
		throw new CoreError("devices_changed", "the list would leave out a device the person wasn't shown");
	}
}

/** The own user, as served now, observed: after an upload, taken or not, before another is signed. */
async function observeServed(parts: EngineParts): Promise<void> {
	const served = await servedIdentity(parts);
	if (served) await observeOwn(parts, served);
}

/** The API took the list of this version: confirmed, then the own user observed (the core's rules after it, N2, N3). */
async function confirmList(parts: EngineParts, version: number): Promise<void> {
	await parts.host.handle({ cmd: "device_list_uploaded", version }).catch(unlessNothingKept);
	await observeServed(parts);
}

/**
 * Takes `device` off the user's list: a list signed without it, and without the devices the API took away, goes up on
 * top of the version it was signed from, and is confirmed only after its 200 (Review Focus 11); one that lost its race
 * (409) is observed, and signed again. A list of this device's that the API never took, already without it, goes up as
 * it is (the core signs none on top of it without what it lacks). Taken or not, the own user is observed after.
 * Nothing goes that leaves out a device the person wasn't shown beside it (`named`, #575): the question names what
 * alsoDropped gives. `alone` signs off that device and no other: an approval's way out, which takes nothing off on the
 * API's word (desktop-electrobun#542).
 */
export async function signWithout(
	parts: EngineParts,
	device: string,
	{ alone = false, named = [] }: { alone?: boolean; named?: readonly string[] } = {},
): Promise<void> {
	const { api, host } = parts;
	for (let round = 1; ; round++) {
		const served = await servedIdentity(parts);
		if (!served) throw new Error("this user has no identity to sign a device list with");
		await observeOwn(parts, served);
		const listed = listDevices(served.device_list);
		if (!listed) throw new Error("the device list the API serves doesn't read");
		const status = await coreStatus(host);
		const held = heldDevices(status);
		// On neither list: done. On this device's alone, an approval of its own that never finished (task 26's I1).
		if (!listed.includes(device) && !held.includes(device)) return;
		const away = alone ? [] : await takenAway(api, held, status.device_id);
		if (!alone) shownAll([...away, ...listed.filter((id) => !held.includes(id))], [device, ...named]);
		const off = [...new Set([device, ...away])].filter((id) => held.includes(id));
		const device_list = off.length
			? (await host.handle<{ device_list: string }>({ cmd: "sign_device_list", remove: off })).device_list
			: status.device_list;
		if (!device_list) throw new Error("this device holds no device list of its user's");
		let version: number;
		try {
			({ version } = await api.putDeviceList({ device_list, base_version: served.device_list_version }));
		} catch (error) {
			if (statusOf(error) === 409 && round < ROUNDS) continue;
			await observeServed(parts).catch((failed: unknown) =>
				console.error("[e2e] The own user wasn't observed:", failed),
			);
			throw error;
		}
		return confirmList(parts, version);
	}
}

/**
 * What the next list or change of keys would leave out beside the devices asked for (Drops), the own user observed
 * first: the devices the served list names that the list this device holds doesn't, as an earlier list of its own that
 * the API never took left them out and the core signs on top of it (M3), and those the API no longer registers (#575).
 * None while a change of keys waits, whose list is another identity's.
 */
export async function alsoDropped(parts: EngineParts): Promise<Drops> {
	const served = await servedIdentity(parts);
	if (!served) return { along: [], away: [] };
	await observeOwn(parts, served);
	const status = await coreStatus(parts.host);
	if (status.waiting_upload === "rotate_keys") return { along: [], away: [] };
	const held = heldDevices(status);
	const along = (listDevices(served.device_list) ?? []).filter((id) => !held.includes(id));
	return { along, away: await takenAway(parts.api, held, status.device_id) };
}

/**
 * Takes another device of the user's off their account: one off the list by its registration, which the API deletes
 * (one listed meanwhile, 409, goes by a list), and one on it by a list without it, which leaves out nothing beside it
 * that the person wasn't shown (`named`).
 */
export async function removeDevice(parts: EngineParts, device: Device, named: readonly string[] = []): Promise<void> {
	if (!device.listed) {
		try {
			return await parts.api.deleteDevice(device.id);
		} catch (error) {
			if (statusOf(error) === 404) return;
			if (statusOf(error) !== 409) throw error;
		}
	}
	await signWithout(parts, device.id, { named });
}

/** What rotate_keys answers (the core's contract): what goes up, a transfer for each device that stays, and the new
 * recovery key the person saves before anything goes; and the identity it replaces, as the API served it. */
export interface KeysMade {
	identity_key: string;
	certificate: string;
	device_list: string;
	recovery_key: string;
	wrapped_backup_key: string;
	encrypted_identity: string;
	wrapped_previous_backup_keys?: string | null;
	transfers: { device_id: string; certificate: string; transfer: string }[];
	replaces: string;
}

/**
 * The devices a change of keys under way takes off: as the record kept them, else as the core says (status'
 * waiting_remove: a record the page's storage lost). Never the served list's that its new list lacks, which also names
 * what an earlier list of this device's left out, when the change was signed on top of one the API never took (task
 * 25's review, M5).
 */
function rotationRemoves(store: EngineStore, status: CoreStatus): string[] {
	const kept = store.read<{ remove?: unknown }>(KEPT_ROTATION)?.remove;
	if (Array.isArray(kept) && kept.every((id) => typeof id === "string")) return kept;
	return status.waiting_remove ?? [];
}

/**
 * The devices a change of keys that waits keeps and the API's list no longer names, never this one (duvetchat/e2e#49):
 * another device took them off with a list of the identity this change replaces, and the API no longer serves their
 * certificates, so the change can't run again with them (`bad_command` `certificates`), nor go up (its transfer to one
 * is the API's 400). Its run again goes on without them (`gone`), on the person's yes. None when nothing waits, or when
 * the API serves the change's own identity: its upload landed, its answer lost, which only its confirmation is left of.
 */
export async function goneDevices(parts: EngineParts): Promise<string[]> {
	const status = await coreStatus(parts.host);
	if (status.waiting_upload !== "rotate_keys") return [];
	const served = await servedIdentity(parts);
	if (!served || served.identity_key === status.identity_key) return [];
	const listed = listDevices(served.device_list) ?? [];
	return heldDevices(status).filter((id) => id !== status.device_id && !listed.includes(id));
}

/**
 * New keys (rotate_keys), taking `remove` off the list, with the devices the API took away, only once the person was
 * shown each device it leaves out (`named`, #575): the own user observed first, so the new list leaves out no device
 * listed since, and each device that stays sealed to as its certificate is served. The devices it takes off are kept in the record until its upload is confirmed, as only the same ones run it
 * again. While a change of keys waits for its upload, it's that one again, whatever `remove` says (Review Focus 3); run
 * so with `gone` (goneDevices, which the person said yes to), its list is signed again without them, the list the API
 * serves its proof (duvetchat/e2e#49).
 */
export async function makeKeys(
	parts: EngineParts,
	remove: readonly string[],
	gone: readonly string[] = [],
	named: readonly string[] = [],
): Promise<KeysMade> {
	const { host, store } = parts;
	const served = await servedIdentity(parts);
	if (!served) throw new Error("this user has no identity to change");
	let status = await coreStatus(host);
	let removing: string[];
	const again = status.waiting_upload === "rotate_keys";
	if (again) removing = rotationRemoves(store, status);
	else {
		await observeOwn(parts, served);
		status = await coreStatus(host);
		const held = heldDevices(status);
		const asked = remove.filter((id) => held.includes(id));
		const away = await takenAway(parts.api, held, status.device_id);
		const along = (listDevices(served.device_list) ?? []).filter((id) => !held.includes(id));
		shownAll([...away, ...along], [...remove, ...named]);
		removing = [...new Set([...asked, ...away])];
		store.write(KEPT_ROTATION, { remove: removing });
	}
	const made = await host.handle<Omit<KeysMade, "replaces">>({
		cmd: "rotate_keys",
		remove: removing,
		certificates: served.certificates,
		...(again && gone.length ? { gone, served_list: served.device_list } : {}),
	});
	return { ...made, replaces: served.identity_key };
}

/** The API holds the new keys: confirmed (identity_uploaded, then the list's version), the record let go of, and the
 * own user observed. */
export async function confirmKeys(parts: EngineParts, version: number): Promise<void> {
	await parts.host.handle({ cmd: "identity_uploaded" }).catch(unlessNothingKept);
	await parts.host.handle({ cmd: "device_list_uploaded", version }).catch(unlessNothingKept);
	parts.store.write(KEPT_ROTATION, null);
	await observeServed(parts);
}

/**
 * The new keys go up (PUT …/identity: a rotation of the identity they replace, with each staying device's transfer),
 * once the person saved the recovery key, and only after the API's 200 are they confirmed. The same bytes again, its
 * answer lost the first time, are the identity the API has: 200 again.
 */
export async function publishKeys(parts: EngineParts, made: KeysMade): Promise<void> {
	const { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key, replaces } = made;
	const previous = made.wrapped_previous_backup_keys;
	const published = await parts.api.putIdentity({
		...{ identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key, replaces },
		...(previous ? { wrapped_previous_backup_keys: previous } : {}),
		transfers: made.transfers.map(({ device_id, certificate: its, transfer }) => ({
			...{ device_id, certificate: its, message: transfer },
		})),
	});
	await confirmKeys(parts, published.device_list_version);
}
