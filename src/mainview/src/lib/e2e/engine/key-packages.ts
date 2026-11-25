// A device's key packages (PLAN-E2E-CLIENTES.md, «Qué se manda», its key packages row): the core's whole live set goes
// up in place of the one the API keeps. The API's answer names those of the set it handed out already (handed_out),
// which the core takes as spent, making others in their place; that second upload starts no third, as what it names
// the answer to the next upload the client starts names again (Task 9b, api#356; Task 3b).
import type { KeyPackageUpload } from "$lib/api/e2e";
import { CoreError } from "../errors";
import type { CoreHost } from "../host";
import type { EngineParts } from "./engine";

/** The core's live set: with `spent`, those it's told were handed out leave it, others in their place. */
async function liveSet(host: CoreHost, spent?: string[]): Promise<KeyPackageUpload[]> {
	try {
		const made = await host.handle<{ key_packages: KeyPackageUpload[] }>({
			cmd: "key_packages",
			...(spent ? { spent } : {}),
		});
		return made.key_packages;
	} catch (error) {
		// A spent list the core refuses (more than 200 IDs, or IDs that don't read) goes without it.
		const refused = error instanceof CoreError && (error.code === "bad_command" || error.code === "too_large");
		if (spent && refused) return liveSet(host);
		throw error;
	}
}

/** An upload the client started: the set, then once more what the core makes in place of those handed out. */
export async function uploadKeyPackages({ api, host }: EngineParts): Promise<void> {
	const { handed_out } = await api.putKeyPackages(await liveSet(host));
	if (handed_out.length > 0) await api.putKeyPackages(await liveSet(host, handed_out));
}
