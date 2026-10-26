/** A message to the gateway that waits for its answer (VOICE_JOIN, CALL_ACCEPT): the connection it went out on
 * (gatewayConnection; null when no socket was open), and whether its answer has come. */
export interface AwaitedSend {
	sentOn: number | null;
	answered: boolean;
}

/**
 * Whether a send still waiting for its answer goes again on a connection whose session just became known, resumed or
 * new. Not one that went out on this connection: after its identify, so the session has it. One that went out on an
 * earlier connection, which dropped, may never have reached the gateway: had it, a resumed session's replay, over by
 * then, would have brought its answer.
 */
export function sendAgain(send: AwaitedSend | null, connection: number): boolean {
	return send !== null && !send.answered && send.sentOn !== connection;
}

/** After this long without a word from the gateway (a sleep, say), a new session's READY doesn't take the user into
 * voice, which would open the mic by surprise: VoiceChat leaves instead of joining again, and a call still being placed
 * that was answered meanwhile stops calling instead of joining. A restart for a deploy takes well under it. */
export const REJOIN_WINDOW_MS = 3 * 60_000;
