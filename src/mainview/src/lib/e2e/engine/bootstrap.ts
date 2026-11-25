// «Arranque» (PLAN-E2E-CLIENTES.md, «El motor»), its steps 2 and 3: this installation's device in the user's database,
// made the first time, and the session bound to it with a proof over the session's challenge (decision 13).
import { FetchError } from "$lib/api/api";
import type { CoreHost } from "../host";
import { uuidv7 } from "../uuid";
import type { EngineParts } from "./engine";
import { DEVICE_KEYS } from "./store";

/** What `status` answers (the core's contract): this device, the identity it holds, and what waits for its upload. */
export interface CoreStatus {
	device_id?: string;
	identity_key?: string;
	certificate?: string;
	device_list?: string;
	waiting_upload?: "create_identity" | "rotate_keys";
	has_identity: boolean;
}

export const coreStatus = (host: CoreHost) => host.handle<CoreStatus>({ cmd: "status" });

/** A device's public keys, as create_device gives them: kept with its ID, as a sign-in registers them again. */
interface DeviceKeys {
	signature_key: string;
	hpke_key: string;
}

/** The keys the record kept for this device: never another device's, which would sign a proof they don't match. */
const keysOf = (kept: unknown, deviceId: string): DeviceKeys | null => {
	if (typeof kept !== "object" || kept === null) return null;
	if (!("device_id" in kept) || !("signature_key" in kept) || !("hpke_key" in kept)) return null;
	const { device_id, signature_key, hpke_key } = kept;
	if (device_id !== deviceId || typeof signature_key !== "string" || typeof hpke_key !== "string") return null;
	return { signature_key, hpke_key };
};

/**
 * The user's database's device, made the first time with an ID of the client's (a UUIDv7), and its keys: kept in the
 * record with its ID, or just made (a record that refused them still registers the new device).
 */
export async function ownDevice({
	host,
	store,
	user,
}: EngineParts): Promise<{ status: CoreStatus; keys: DeviceKeys | null }> {
	const status = await coreStatus(host);
	if (status.device_id) return { status, keys: keysOf(store.read(DEVICE_KEYS), status.device_id) };
	const device_id = uuidv7();
	const keys = keysOf(
		{ device_id, ...(await host.handle<object>({ cmd: "create_device", user_id: user, device_id })) },
		device_id,
	);
	store.write(DEVICE_KEYS, keys && { device_id, ...keys });
	return { status: await coreStatus(host), keys };
}

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

/**
 * Binds the session to the device: at once when the API says it is (`current`), else over a new challenge, by
 * registering its keys again, which binds a device the API has (200) and registers one it hasn't (201). Without its
 * keys, or with its ID refused (409: a device of the user's deleted, the same ID with other keys, or another user's),
 * by the bind route, whose 404 alone says the API took the device away: false. Any other refusal is thrown, which the
 * engine takes for good.
 */
export async function bindSession(
	{ api, host, deviceName }: EngineParts,
	deviceId: string,
	keys: DeviceKeys | null,
): Promise<boolean> {
	if ((await api.devices()).some((device) => device.current && device.id === deviceId)) return true;
	const { device_challenge } = await api.deviceChallenge();
	const { proof } = await host.handle<{ proof: string }>({ cmd: "bind_proof", challenge: device_challenge });
	try {
		if (keys) {
			try {
				await api.registerDevice({ device_id: deviceId, name: deviceName, ...keys, proof });
				return true;
			} catch (error) {
				// A refused registration spends no challenge: the same proof binds.
				if (statusOf(error) !== 409) throw error;
			}
		}
		await api.bindDevice(deviceId, proof);
	} catch (error) {
		if (statusOf(error) === 404) return false;
		throw error;
	}
	return true;
}
