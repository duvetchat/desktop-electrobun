// The user's identity (PLAN-E2E-CLIENTES.md, «El motor»: «Arranque» step 5, and «Qué se manda», its identity's row): a
// first device publishes the one it made, once the person saved its recovery key (decision 23), and confirms it only
// after the API took it; every device holds itself to the one the API serves.
import { FetchError } from "$lib/api/api";
import type { Identity } from "$lib/api/e2e";
import { listDevices } from "../cbor";
import { CoreError } from "../errors";
import { coreStatus, type CoreStatus } from "./bootstrap";
import type { Observation } from "./contacts";
import type { EngineParts, EngineState } from "./engine";

/** What create_identity answers: what goes up, and the recovery key the person saves first. */
export interface IdentityMade {
	identity_key: string;
	certificate: string;
	device_list: string;
	recovery_key: string;
	wrapped_backup_key: string;
	encrypted_identity: string;
}

const statusOf = (error: unknown) => (error instanceof FetchError ? error.response?.status : undefined);

/** The user's identity as the API serves it today, or null without one (404). */
export async function servedIdentity({ api, user }: EngineParts): Promise<Identity | null> {
	try {
		return await api.identity(user);
	} catch (error) {
		if (statusOf(error) === 404) return null;
		throw error;
	}
}

/**
 * observe_user of each user, as the API serves their identities, 50 at a time: one it doesn't serve stays as it was.
 * What the core answers of each goes to the contacts (`observed`, contacts.ts), where a changed key leaves its
 * notice.
 */
export async function observeUsers({ api, host, contacts }: EngineParts, users: string[]): Promise<void> {
	for (let at = 0; at < users.length; at += 50) {
		for (const { user_id, identity_key, device_list, certificates } of await api.identities(users.slice(at, at + 50))) {
			const seen = await host.handle<Observation>({
				...{ cmd: "observe_user", user_id, identity_key, device_list, certificates },
			});
			contacts?.observed(user_id, seen);
		}
	}
}

/**
 * A command that may first ask for users' identities (`needs_identities`): they're observed, and it runs again. Three
 * rounds at most: the core asks once for what it knows of each user, and goes on with that the next time.
 */
export async function withIdentities<T>(parts: EngineParts, run: () => Promise<T>): Promise<T> {
	for (let round = 1; ; round++) {
		try {
			return await run();
		} catch (error) {
			const asked = error instanceof CoreError && error.code === "needs_identities" ? error.users : undefined;
			if (!asked?.length || round >= 3) throw error;
			await observeUsers(parts, asked);
		}
	}
}

/** observe_user of the user's own identity, as served: what the core made of it (`not_own_identity`, an identity this
 * device doesn't hold). */
export async function observeOwn({ host, user }: EngineParts, served: Identity): Promise<string | undefined> {
	const { identity_key, device_list, certificates } = served;
	const seen = await host.handle<{ state: string; reason?: string }>({
		cmd: "observe_user",
		...{ user_id: user, identity_key, device_list, certificates },
	});
	return seen.reason;
}

/**
 * Whether this device took the identity the API serves (recovered, or approved: Task 26) and the API's list doesn't name
 * it yet: its first list, with its certificate, is what's left of its setup (recover.ts).
 */
export const firstListWaits = (served: Identity, status: CoreStatus) =>
	status.has_identity &&
	status.device_id !== undefined &&
	served.identity_key === status.identity_key &&
	!listDevices(served.device_list)?.includes(status.device_id);

/**
 * What the user's identity, as served, makes of this device (step 5): none yet, a first device; one this device
 * doesn't hold, or holds without being on its list yet (its first list still to go up), a new device; its own, ready.
 * Served one this device doesn't hold while it holds another, a rotation's transfer for it may wait in the inbox
 * (`takeInbox`): without one, the user's devices went on without this one, which is off the list (`removed`; a
 * rotation off it removes it, and starting over leaves it unlisted).
 */
export async function identityState(parts: EngineParts, takeInbox: () => Promise<unknown>): Promise<EngineState> {
	let served = await servedIdentity(parts);
	if (!served) return { name: "first_device", recoveryKey: null, finishing: false };
	const status = await coreStatus(parts.host);
	if (!status.has_identity) return { name: "new_device" };
	// A rotation of this device's own, cut before its upload, holds the new identity the API doesn't serve yet: it goes
	// up again as the same rotation (Task 24, which keeps what it removes), never read as this device being off the list.
	if (status.waiting_upload === "rotate_keys") return { name: "ready" };
	if (firstListWaits(served, status)) return { name: "new_device" };
	if ((await observeOwn(parts, served)) !== "not_own_identity") return { name: "ready" };
	await takeInbox();
	served = (await servedIdentity(parts)) ?? served;
	return (await observeOwn(parts, served)) === "not_own_identity" ? { name: "removed" } : { name: "ready" };
}

/**
 * The first device's identity goes up (PUT …/identity) with the list naming this device alone, or a start over's in the
 * place of the identity it `replaces` (`reset`, decision 47). Only after the API's 200 is it confirmed:
 * identity_uploaded, device_list_uploaded with the version the API answered, then the own user observed (the core's
 * rules after an upload, N2 and N3). False on a 409: another identity is there now (another first device published
 * first, or the one a start over replaces changed).
 */
export async function publishIdentity(
	parts: EngineParts,
	made: IdentityMade,
	replaces: string | null = null,
): Promise<boolean> {
	const { api, host } = parts;
	const { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key } = made;
	let version: number;
	try {
		const published = await api.putIdentity({
			...{ identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key },
			replaces,
			...(replaces ? { reset: true } : {}),
		});
		version = published.device_list_version;
	} catch (error) {
		if (statusOf(error) === 409) return false;
		throw error;
	}
	// Nothing kept for an upload: a confirmation cut after it took this one, before the list's.
	await host.handle({ cmd: "identity_uploaded" }).catch((error: unknown) => {
		if (!(error instanceof CoreError && error.code === "not_found" && error.what === "upload")) throw error;
	});
	await host.handle({ cmd: "device_list_uploaded", version });
	const served = await servedIdentity(parts);
	if (served) await observeOwn(parts, served);
	return true;
}
