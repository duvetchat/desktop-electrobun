// The conversation as a page draws it against a real API, for the live and interop suites' engines (EngineParts'
// shown): its last listing, as the app's store keeps READY's, listed again when asked fresh or when it lacks the
// conversation, as the page takes a conversation it didn't draw. A listing on every call would pass the API's 64
// requests a minute per route, as the engine reads the drawing after each turn and before each send.
import type { Conversation } from "$lib/api/conversations";
import type { E2eApi } from "$lib/api/e2e";
import type { EngineParts } from "../engine/engine";

export function listedTo(api: E2eApi): EngineParts["shown"] {
	let listed: Promise<Conversation[]> | null = null;
	return async (id, fresh) => {
		const kept = !fresh && listed ? (await listed).find((conv) => conv.id === id) : undefined;
		if (kept) return kept;
		const listing = api.conversations();
		listed = listing;
		// A listing that failed isn't kept: the next call lists again.
		listing.catch(() => {
			if (listed === listing) listed = null;
		});
		return (await listing).find((conv) => conv.id === id) ?? null;
	};
}
