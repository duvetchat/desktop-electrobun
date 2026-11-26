// A new device of a user who has an identity, set up with the recovery key (PLAN-E2E-CLIENTES.md, Task 26; decisions
// 22 and 24): the key checked as the core reads it before anything is asked of the API, then what the API keeps for
// recovery opened with it (GET …/identity/backup, recover). Then the device puts up its first list, with itself on it
// and its certificate, as a device another one approved does too (approval.ts).
import { FetchError } from "$lib/api/api";
import { listDevices } from "../cbor";
import { CoreError } from "../errors";
import { coreStatus } from "./bootstrap";
import { takenAway, unlessNothingKept } from "./devices";
import type { EngineParts } from "./engine";
import { observeOwn, servedIdentity } from "./identity";

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

/**
 * The recovery key as the core reads one (decision 22): its 48 characters, spaces and dashes aside, and their check. The
 * core reads the key before what it opens, so `recover` with nothing to open throws a mistyped key's `bad_command`
 * (`recovery_key`) before the API is asked for anything, and leaves the device as it was; a key that reads gets as far
 * as the nothing it was given to open.
 */
export async function checkRecoveryKey({ host }: EngineParts, recoveryKey: string): Promise<void> {
	const nothing = { wrapped_backup_key: "", encrypted_identity: "", device_list: "" };
	await host.handle({ cmd: "recover", recovery_key: recoveryKey, ...nothing }).catch((error: unknown) => {
		if (error instanceof CoreError && error.code === "bad_command" && error.field === "recovery_key") throw error;
	});
}

/**
 * A command given the backup keys from before a change of keys, which the API keeps, when it keeps some: run again
 * without them when they don't open with the backup key (the core's rule), as only the backup reads them (Task 32).
 */
export async function withPreviousKeys<T>(
	previous: string | null | undefined,
	run: (previous?: string) => Promise<T>,
): Promise<T> {
	if (!previous) return run();
	try {
		return await run(previous);
	} catch (error) {
		if (!(error instanceof CoreError && error.code === "decrypt_failed" && error.kind === "previous_backup_keys")) {
			throw error;
		}
		return run();
	}
}

/** This device takes the user's identity: what the API keeps for recovery, opened with the recovery key. */
export async function recoverIdentity(parts: EngineParts, recoveryKey: string): Promise<void> {
	const { device_list, encrypted_identity, wrapped_backup_key, wrapped_previous_backup_keys } =
		await parts.api.identityBackup();
	await withPreviousKeys(wrapped_previous_backup_keys, (previous) =>
		parts.host.handle({
			...{ cmd: "recover", recovery_key: recoveryKey, device_list, encrypted_identity, wrapped_backup_key },
			...(previous ? { wrapped_previous_backup_keys: previous } : {}),
		}),
	);
}

/** How a device's first list went: up, lost to another list there first, or waiting for the person's Finish to leave
 * these devices out. */
export type FirstList = "listed" | "lost" | { leavingOut: string[] };

/**
 * This device's first list, once it holds the identity (recovered, or approved) and the API doesn't list it yet: the
 * list it holds, with itself on it, signed again without the devices the API took away (a new password's remove_devices:
 * the API refuses a list that names them, step 3's ruling 23), goes up with this device's certificate on top of the
 * version served, and is confirmed only after its 200 (Review Focus 11), the own user observed after. Leaving devices
 * out is the person's act, which on the desktop Bun asks about in its own box: the page names them first, so only the
 * person's Finish signs (`signOff`), and their no rejects (`refused`). Another list there first (409) leaves this
 * device off for good (`lost`): no command adds a device to a list.
 */
export async function putFirstList(parts: EngineParts, signOff: boolean): Promise<FirstList> {
	const { api, host } = parts;
	const served = await servedIdentity(parts);
	if (!served) throw new Error("this user has no identity to list this device under");
	let status = await coreStatus(host);
	const held = (status.device_list && listDevices(status.device_list)) || [];
	const off = await takenAway(api, held, status.device_id);
	if (off.length) {
		if (!signOff) return { leavingOut: off };
		await host.handle({ cmd: "sign_device_list", remove: off });
		status = await coreStatus(host);
	}
	const { device_list, certificate } = status;
	if (!device_list || !certificate) throw new Error("this device holds no list or certificate of its user's");
	let version: number;
	try {
		({ version } = await api.putDeviceList({ device_list, base_version: served.device_list_version, certificate }));
	} catch (error) {
		if (statusOf(error) === 409) return "lost";
		throw error;
	}
	await host.handle({ cmd: "device_list_uploaded", version }).catch(unlessNothingKept);
	await observeOwn(parts, (await servedIdentity(parts)) ?? served);
	return "listed";
}
