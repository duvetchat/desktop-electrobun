// A device's commits (PLAN-E2E-CLIENTES.md, «Qué se manda», its commit rows): each goes to its route, and the core is
// told the API's word on it, only once the API gave one (Review Focus 11). Taken (2xx) is `accepted`, with its number;
// another commit took the epoch (409), `accepted: false`, which leaves the queue to settle it; refused (a 422, or any
// other refusal of the request), `invalid`: it never entered. A request without an answer says nothing: its caller keeps
// the bytes and sends them again, and the API answers the same bytes as it did («Un commit sin respuesta»).
import { FetchError, UpdateRequiredError } from "$lib/api/api";
import type { CommitTaken } from "$lib/api/e2e";
import type { CoreHost } from "../host";

/** What came of a commit's request: taken, another took its epoch, refused, or no answer yet. */
export type Sent = "accepted" | "lost" | "refused" | "unanswered";

/** Answers that say nothing of the commit itself: a session's renewal, a rate limit, the pause, the server. */
const passing = (status: number | undefined) =>
	status === undefined || status === 401 || status === 408 || status === 429 || status >= 500;

/**
 * Sends a commit the core made (`send`: its request, always with the same bytes) and tells the core the API's word. A
 * client too old to send it (426) is thrown, the commit kept for after the update. Unanswered, the core is told nothing.
 */
export async function sendCommit(
	host: CoreHost,
	conversationId: string,
	send: () => Promise<CommitTaken>,
): Promise<Sent> {
	let taken: CommitTaken;
	try {
		taken = await send();
	} catch (error) {
		if (error instanceof UpdateRequiredError) throw error;
		const status = error instanceof FetchError ? error.response?.status : undefined;
		if (passing(status)) return "unanswered";
		const lost = status === 409;
		await host.handle({
			...{ cmd: "commit_result", conversation_id: conversationId, accepted: false },
			...(lost ? {} : { invalid: true }),
		});
		return lost ? "lost" : "refused";
	}
	await host.handle({ cmd: "commit_result", conversation_id: conversationId, accepted: true, seq: taken.seq });
	return "accepted";
}
