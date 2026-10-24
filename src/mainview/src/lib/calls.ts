import type { ActiveCallInfo } from "$lib/stores.svelte";
import type { CallAcceptedEvent } from "$lib/types";

/**
 * What this client does when a call is accepted (CALL_ACCEPTED), which the gateway tells every member of the call, on
 * each of their sessions. The call this client placed and is waiting on was answered: its voice joins ("join"). A
 * call ringing here that the user answered on another device goes ("dismiss"), since that device has it. Anything
 * else leaves the user where they are: in their voice room, in the call already, or with a call ringing that someone
 * else answered (a group's, which they can still answer).
 */
export function callAcceptedAction(
	call: Pick<ActiveCallInfo, "conversationId" | "state"> | null,
	accepted: CallAcceptedEvent,
	me: string | undefined,
): "join" | "dismiss" | null {
	if (!call || call.conversationId !== accepted.conversation_id) return null;
	if (call.state === "calling") return "join";
	if (call.state === "ringing" && accepted.user_id === me) return "dismiss";
	return null;
}
