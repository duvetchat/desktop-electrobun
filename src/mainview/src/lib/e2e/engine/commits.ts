// A device's commits (PLAN-E2E-CLIENTES.md, «Qué se manda», its commit rows): each goes to its route, and the core is
// told the API's word on it, only once the API gave one (Review Focus 11). Taken (2xx) is `accepted`, with its number.
// Only the validator's refusal (422) is `invalid`: it never entered («Restricciones globales»). Any other answer that
// didn't take it is `accepted: false`, which leaves the queue to settle it: another commit took the epoch (409), or the
// request was refused, which a resend whose first send entered can be too (a 403 once the device left its list). A
// request without an answer says nothing: its caller keeps the bytes and sends them again, and the API answers the same
// bytes as it did («Un commit sin respuesta»).
import { FetchError, UpdateRequiredError } from "$lib/api/api";
import type { CommitTaken } from "$lib/api/e2e";
import type { CoreHost } from "../host";

/**
 * What came of a commit's request: taken; another commit took its epoch (lost); the validator refused it (invalid); the
 * API refused the request otherwise (refused), which the queue settles as it does a lost one; or no answer yet.
 */
export type Sent = "accepted" | "lost" | "invalid" | "refused" | "unanswered";

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
		const invalid = status === 422;
		await host.handle({
			...{ cmd: "commit_result", conversation_id: conversationId, accepted: false },
			...(invalid ? { invalid: true } : {}),
		});
		return invalid ? "invalid" : status === 409 ? "lost" : "refused";
	}
	await host.handle({ cmd: "commit_result", conversation_id: conversationId, accepted: true, seq: taken.seq });
	return "accepted";
}
