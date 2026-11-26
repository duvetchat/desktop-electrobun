// Starting over (PLAN-E2E-CLIENTES.md, Task 26; decision 47): a new device with neither the recovery key nor another
// device makes a new identity for the user (reset_identity, which the core runs as it runs create_identity), shows its
// recovery key until it's saved, and uploads it in the place of the identity the API serves, with `reset`
// (identity.ts' publishIdentity): the devices before stay registered and off the new list, the user's contacts see the
// identity change, and the identity before keeps its backup 30 days, in case its key turns up. Its conversations take
// this device back once another member commits the removal of the devices before (sync.ts, `wait_rejoin`).
import { CoreError } from "../errors";
import type { EngineParts } from "./engine";
import type { IdentityMade } from "./identity";
import { KEPT_RESET, type EngineStore } from "./store";

/** The identity a start over under way replaces, as the record keeps it; null when none is under way. */
export function replacedByReset(store: EngineStore): string | null {
	const replaces = store.read<{ replaces?: unknown }>(KEPT_RESET)?.replaces;
	return typeof replaces === "string" ? replaces : null;
}

/**
 * The new identity, on the person's tap after the page's warning (and on the desktop after Bun's box, whose no throws
 * `refused`), in the place of `replaces`: kept in the record first, so a start that finds the core's identity waiting
 * for its upload knows it for a start over and not a first device's. Run again before its upload, the core gives the
 * same identity and key. A no the first time leaves nothing to finish.
 */
export async function makeReset({ host, store }: EngineParts, replaces: string, again: boolean): Promise<IdentityMade> {
	store.write(KEPT_RESET, { replaces });
	try {
		return await host.handle<IdentityMade>({ cmd: "reset_identity" });
	} catch (error) {
		if (!again && error instanceof CoreError && error.code === "refused") store.write(KEPT_RESET, null);
		throw error;
	}
}
