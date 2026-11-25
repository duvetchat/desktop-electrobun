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

/** A device's public keys, as create_device gives them: kept, as a registration names them again at each sign-in. */
interface DeviceKeys {
	signature_key: string;
	hpke_key: string;
}

const keysOf = (kept: unknown): DeviceKeys | null => {
	if (typeof kept !== "object" || kept === null || !("signature_key" in kept) || !("hpke_key" in kept)) return null;
	const { signature_key, hpke_key } = kept;
	return typeof signature_key === "string" && typeof hpke_key === "string" ? { signature_key, hpke_key } : null;
};

/**
 * The user's database's device, made the first time with an ID of the client's (a UUIDv7), and its keys: kept in the
 * record, or just made (a record that refused them still registers the new device).
 */
export async function ownDevice({
	host,
	store,
	user,
}: EngineParts): Promise<{ status: CoreStatus; keys: DeviceKeys | null }> {
	const status = await coreStatus(host);
	if (status.device_id) return { status, keys: keysOf(store.read(DEVICE_KEYS)) };
	const keys = keysOf(await host.handle({ cmd: "create_device", user_id: user, device_id: uuidv7() }));
	store.write(DEVICE_KEYS, keys);
	return { status: await coreStatus(host), keys };
}

/**
 * Binds the session to the device: at once when the API says it is (`current`), else over a new challenge, by
 * registering its keys again, which binds a device the API has (200) and registers one it hasn't (201); by its bind
 * route when its keys weren't kept. False when the API took the device away: its ID refused (409 `device id in use`, a
 * removed device's never comes back) or unknown to the bind (404).
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
		if (keys) await api.registerDevice({ device_id: deviceId, name: deviceName, ...keys, proof });
		else await api.bindDevice(deviceId, proof);
	} catch (error) {
		if (error instanceof FetchError && error.response?.status === (keys ? 409 : 404)) return false;
		throw error;
	}
	return true;
}
