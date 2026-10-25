import { describe, expect, test } from "bun:test";
import {
	callAcceptedAction,
	callDeclinedAction,
	callOngoingAction,
	callOnReady,
	callToRingOnReady,
	ownCallsRingingOnReady,
} from "$lib/calls";
import type { CallState } from "$lib/stores.svelte";
import type { GatewayReadyActiveCall } from "$lib/types";

const ME = "01920000-0000-7000-8000-00000000b0b0";
const THEM = "01920000-0000-7000-8000-00000000a11c";
const CONV = "01920000-0000-7000-8000-0000000000c1";
const OTHER_CONV = "01920000-0000-7000-8000-0000000000c2";
// The call this client shows, and a CALL_ACCEPTED or CALL_DECLINED: who answered which conversation's call.
const call = (state: CallState, conversationId = CONV) => ({ conversationId, state });
const acceptedBy = (user_id: string, conversation_id = CONV) => ({ conversation_id, user_id });
const declinedBy = acceptedBy;
const ongoing = (conversation_id = CONV) => ({ conversation_id, initiator_id: THEM, voice_states: null });
// A call as READY lists it. A gateway from before calls followed users across devices sends neither ringing,
// answered, nor the caller's name and avatar.
const listed = (fields: Partial<GatewayReadyActiveCall> = {}): GatewayReadyActiveCall => ({
	conversation_id: CONV,
	initiator_id: THEM,
	voice_states: null,
	...fields,
});

describe("callAcceptedAction", () => {
	test("the call this client placed joins once someone answers it", () => {
		expect(callAcceptedAction(call("calling"), acceptedBy(THEM), ME)).toBe("join");
	});

	test("the call this client placed joins on its user's own answer: their call crossed another, or rejoined it", () => {
		// Two people who call each other at once: the second CALL_INITIATE answers the first call. And a caller
		// calling again the call they left, once it's answered: CALL_ACCEPTED with their own user_id.
		expect(callAcceptedAction(call("calling"), acceptedBy(ME), ME)).toBe("join");
	});

	test("a call ringing here goes when the user answered it on another device", () => {
		expect(callAcceptedAction(call("ringing"), acceptedBy(ME), ME)).toBe("dismiss");
	});

	test("someone else answering a call that rings here leaves it ringing", () => {
		expect(callAcceptedAction(call("ringing"), acceptedBy(THEM), ME)).toBeNull();
	});

	test("a call this client is in already stays as it is", () => {
		expect(callAcceptedAction(call("connected"), acceptedBy(THEM), ME)).toBeNull();
		expect(callAcceptedAction(call("connected"), acceptedBy(ME), ME)).toBeNull();
	});

	test("without a call here, or with another one, the user stays where they are", () => {
		expect(callAcceptedAction(null, acceptedBy(THEM), ME)).toBeNull();
		expect(callAcceptedAction(null, acceptedBy(ME), ME)).toBeNull();
		expect(callAcceptedAction(call("calling", OTHER_CONV), acceptedBy(THEM), ME)).toBeNull();
		expect(callAcceptedAction(call("ringing", OTHER_CONV), acceptedBy(ME), ME)).toBeNull();
	});
});

describe("callDeclinedAction", () => {
	test("a call ringing here goes when the user declined it on another device", () => {
		expect(callDeclinedAction(call("ringing"), declinedBy(ME), ME)).toBe("dismiss");
	});

	test("someone else's decline, which the caller hears, leaves their call ringing the others", () => {
		expect(callDeclinedAction(call("calling"), declinedBy(THEM), ME)).toBeNull();
		expect(callDeclinedAction(call("ringing"), declinedBy(THEM), ME)).toBeNull();
	});

	test("a call this client is in stays", () => {
		expect(callDeclinedAction(call("connected"), declinedBy(ME), ME)).toBeNull();
	});

	test("without a call here, or with another one, nothing changes", () => {
		expect(callDeclinedAction(null, declinedBy(ME), ME)).toBeNull();
		expect(callDeclinedAction(call("ringing", OTHER_CONV), declinedBy(ME), ME)).toBeNull();
	});
});

describe("callOngoingAction", () => {
	test("a call ringing here stops once it goes on without ringing the user", () => {
		expect(callOngoingAction(call("ringing"), ongoing())).toBe("dismiss");
	});

	test("a call this client places or is in stays: the gateway let the user in as they called or joined it", () => {
		expect(callOngoingAction(call("calling"), ongoing())).toBeNull();
		expect(callOngoingAction(call("connected"), ongoing())).toBeNull();
	});

	test("without a call here, or with another one, nothing changes", () => {
		expect(callOngoingAction(null, ongoing())).toBeNull();
		expect(callOngoingAction(call("ringing", OTHER_CONV), ongoing())).toBeNull();
	});
});

describe("callOnReady", () => {
	test("a call the new session doesn't list is over, whatever its state here", () => {
		for (const state of ["ringing", "calling", "connected"] as const) {
			expect(callOnReady(call(state), [])).toBe("end");
			expect(callOnReady(call(state), [listed({ conversation_id: OTHER_CONV })])).toBe("end");
		}
	});

	test("a call ringing here stops when READY says it no longer rings the user", () => {
		// They answered or declined it on another device while this one was away, or its ring window passed.
		expect(callOnReady(call("ringing"), [listed({ ringing: false })])).toBe("dismiss");
	});

	test("a call ringing here rings on while READY says it still rings the user", () => {
		expect(callOnReady(call("ringing"), [listed({ ringing: true })])).toBeNull();
	});

	test("a gateway that doesn't say whether it rings leaves it ringing, as before", () => {
		expect(callOnReady(call("ringing"), [listed()])).toBeNull();
	});

	test("a call this client places or is in stays: it never rings the user", () => {
		expect(callOnReady(call("calling"), [listed({ initiator_id: ME, ringing: false })])).toBeNull();
		expect(callOnReady(call("connected"), [listed({ ringing: false })])).toBeNull();
	});

	test("without a call here, nothing to do", () => {
		expect(callOnReady(null, [listed({ ringing: true })])).toBeNull();
	});
});

describe("callToRingOnReady", () => {
	test("the first call READY says still rings the user, with its caller's name and avatar", () => {
		const ringing = listed({
			conversation_id: OTHER_CONV,
			ringing: true,
			initiator_name: "them",
			initiator_avatar: null,
		});
		expect(callToRingOnReady([listed({ ringing: false }), ringing])).toBe(ringing);
	});

	test("none for calls that don't ring the user: their own, answered or declined elsewhere, or past their window", () => {
		expect(callToRingOnReady([listed({ ringing: false }), listed({ initiator_id: ME, ringing: false })])).toBeNull();
	});

	test("none from a gateway that doesn't say whether calls ring, which never rang at READY", () => {
		expect(callToRingOnReady([listed(), listed({ conversation_id: OTHER_CONV })])).toBeNull();
		expect(callToRingOnReady([])).toBeNull();
	});
});

describe("ownCallsRingingOnReady", () => {
	test("the user's own calls that nobody has answered yet", () => {
		const calls = [
			listed({ initiator_id: ME, answered: false }),
			listed({ conversation_id: OTHER_CONV, initiator_id: ME, answered: true }),
		];
		expect(ownCallsRingingOnReady(calls, ME)).toEqual(new Set([CONV]));
	});

	test("not someone else's call, answered or not", () => {
		expect(ownCallsRingingOnReady([listed({ answered: false })], ME)).toEqual(new Set());
	});

	test("none from a gateway that doesn't say whether calls are answered: Join shows, as before", () => {
		expect(ownCallsRingingOnReady([listed({ initiator_id: ME })], ME)).toEqual(new Set());
	});
});
