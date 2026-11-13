import { describe, expect, test } from "bun:test";
import {
	callAcceptedAction,
	callDeclinedAction,
	callDeclinedNotice,
	callingFromAnotherDevice,
	callOngoingAction,
	callOnReady,
	callToRingOnReady,
	callVoiceStatesOf,
	missedCallNotice,
	ownCallsRingingOnReady,
	placeAgain,
	voiceEndedNotice,
	withCallVoiceState,
	withoutCallVoiceOf,
} from "$lib/calls";
import { REJOIN_WINDOW_MS } from "$lib/resend";
import type { CallState, CallVoiceState } from "$lib/stores.svelte";
import type { GatewayReadyActiveCall, VoiceStateUpdateEvent } from "$lib/types";

const ME = "01920000-0000-7000-8000-00000000b0b0";
const THEM = "01920000-0000-7000-8000-00000000a11c";
const OTHER = "01920000-0000-7000-8000-00000000b0b1";
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
const voice = (user_id: string, version = 1) => ({
	user_id,
	muted: false,
	deafened: false,
	screen_sharing: false,
	camera: false,
	version,
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

describe("callDeclinedNotice", () => {
	const members = [
		{ user_id: ME, user: { id: ME, username: "me", alias: null, avatar: null, banner: null } },
		{ user_id: THEM, user: { id: THEM, username: "ana", alias: "Ana", avatar: null, banner: null } },
		{ user_id: OTHER, user: { id: OTHER, username: "bob", alias: null, avatar: null, banner: null } },
	];

	test("the device placing the call hears who turned it down, by the name the app shows", () => {
		expect(callDeclinedNotice(call("calling"), declinedBy(THEM), ME, members)).toBe("Ana declined");
		expect(callDeclinedNotice(call("calling"), declinedBy(OTHER), ME, members)).toBe("bob declined");
	});

	test("someone the conversation doesn't list, as the call's members can outrun it, is 'they'", () => {
		expect(callDeclinedNotice(call("calling"), declinedBy(THEM), ME)).toBe("They declined");
		expect(callDeclinedNotice(call("calling"), declinedBy(THEM), ME, [])).toBe("They declined");
	});

	test("the user's own decline only stops the ringing on their other devices", () => {
		expect(callDeclinedNotice(call("ringing"), declinedBy(ME), ME, members)).toBeNull();
		expect(callDeclinedNotice(call("calling"), declinedBy(ME), ME, members)).toBeNull();
	});

	test("a device that isn't placing the call says nothing: the caller's others, and one with no call", () => {
		expect(callDeclinedNotice(null, declinedBy(THEM), ME, members)).toBeNull();
		expect(callDeclinedNotice(call("calling", OTHER_CONV), declinedBy(THEM), ME, members)).toBeNull();
		expect(callDeclinedNotice(call("ringing", OTHER_CONV), declinedBy(THEM), ME, members)).toBeNull();
	});

	test("once someone answered, a call goes on: a decline there says nothing", () => {
		expect(callDeclinedNotice(call("connected"), declinedBy(THEM), ME, members)).toBeNull();
	});
});

describe("missedCallNotice", () => {
	const fromBob = (conversation_id = OTHER_CONV) => ({
		conversation_id,
		initiator_id: OTHER,
		initiator_name: "bob",
		initiator_avatar: null,
	});

	test("a call that comes during another is missed, whatever the state of the one shown", () => {
		for (const state of ["ringing", "calling", "connected"] as const) {
			expect(missedCallNotice(call(state), fromBob())).toBe("Missed a call from bob");
		}
	});

	test("with no call shown it rings, and says nothing", () => {
		expect(missedCallNotice(null, fromBob())).toBeNull();
	});

	test("the very call this client shows isn't missed: calls that crossed, or READY's own call again", () => {
		for (const state of ["ringing", "calling", "connected"] as const) {
			expect(missedCallNotice(call(state), fromBob(CONV))).toBeNull();
		}
	});
});

describe("voiceEndedNotice", () => {
	test("without a reason a newer join of the user's took the voice, from another session", () => {
		expect(voiceEndedNotice({ room_id: CONV })).toBe("Your voice moved to another device");
	});

	test("with one, they can't be in that room any more: nothing moved anywhere", () => {
		expect(voiceEndedNotice({ room_id: CONV, reason: "permissions" })).toBe("You can't be in this voice room anymore");
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
	// A READY after a short silence, with nothing of this client's sent on its own connection.
	const soon = { silentMs: 5_000, sentOnThisConnection: false };
	const afterSleep = { silentMs: REJOIN_WINDOW_MS + 1, sentOnThisConnection: false };
	const sentHere = { silentMs: 5_000, sentOnThisConnection: true };

	test("a call the new session doesn't list is over, whatever its state here", () => {
		for (const state of ["ringing", "calling", "connected"] as const) {
			expect(callOnReady(call(state), [], soon)).toBe("end");
			expect(callOnReady(call(state), [listed({ conversation_id: OTHER_CONV })], soon)).toBe("end");
		}
	});

	test("but one placed or answered on READY's own connection stays: READY was built before the gateway got it", () => {
		expect(callOnReady(call("calling"), [], sentHere)).toBe("keep");
		expect(callOnReady(call("connected"), [], sentHere)).toBe("keep");
	});

	test("a call ringing here stops when READY says it no longer rings the user", () => {
		// They answered or declined it on another device while this one was away, or its ring window passed.
		expect(callOnReady(call("ringing"), [listed({ ringing: false })], soon)).toBe("dismiss");
	});

	test("a call ringing here rings on while READY says it still rings the user", () => {
		expect(callOnReady(call("ringing"), [listed({ ringing: true })], soon)).toBeNull();
	});

	test("a gateway that doesn't say whether it rings leaves it ringing, as before", () => {
		expect(callOnReady(call("ringing"), [listed()], soon)).toBeNull();
	});

	test("a call ringing here rings on when READY says someone else answered it: a group's, still the user's to answer", () => {
		// Joining it would open the mic in a call the user never answered.
		expect(callOnReady(call("ringing"), [listed({ ringing: true, answered: true })], soon)).toBeNull();
		expect(callOnReady(call("ringing"), [listed({ ringing: true, answered: true })], afterSleep)).toBeNull();
	});

	test("the call this client places joins when READY says someone answered it, as on the CALL_ACCEPTED it missed", () => {
		expect(callOnReady(call("calling"), [listed({ initiator_id: ME, ringing: false, answered: true })], soon)).toBe(
			"join",
		);
		// Its CALL_INITIATE answered someone else's call.
		expect(callOnReady(call("calling"), [listed({ ringing: false, answered: true })], soon)).toBe("join");
	});

	test("after a silence past the rejoin window it stops calling instead, and shows the call with Join", () => {
		expect(callOnReady(call("calling"), [listed({ initiator_id: ME, answered: true })], afterSleep)).toBe("dismiss");
		expect(
			callOnReady(call("calling"), [listed({ initiator_id: ME, answered: true })], {
				...soon,
				silentMs: REJOIN_WINDOW_MS,
			}),
		).toBe("join");
	});

	test("one placed on READY's own connection waits for the CALL_ACCEPTED that answers it", () => {
		expect(callOnReady(call("calling"), [listed({ answered: true })], sentHere)).toBeNull();
		expect(
			callOnReady(call("calling"), [listed({ answered: true })], { ...sentHere, silentMs: REJOIN_WINDOW_MS + 1 }),
		).toBeNull();
	});

	test("the call this client places calls on while nobody has answered it, or the gateway doesn't say", () => {
		expect(
			callOnReady(call("calling"), [listed({ initiator_id: ME, ringing: false, answered: false })], soon),
		).toBeNull();
		expect(callOnReady(call("calling"), [listed({ initiator_id: ME })], afterSleep)).toBeNull();
	});

	test("a call this client is in stays", () => {
		expect(callOnReady(call("connected"), [listed({ ringing: false, answered: true })], afterSleep)).toBeNull();
	});

	test("without a call here, nothing to do", () => {
		expect(callOnReady(null, [listed({ ringing: true })], soon)).toBeNull();
		expect(callOnReady(null, [], sentHere)).toBeNull();
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

describe("callingFromAnotherDevice", () => {
	const ringing = new Set([CONV]);

	test("the user's own call still ringing the others, on a device that isn't placing it", () => {
		expect(callingFromAnotherDevice(CONV, ringing, null)).toBe(true);
		// This client shows another call.
		expect(callingFromAnotherDevice(CONV, ringing, call("connected", OTHER_CONV))).toBe(true);
		expect(callingFromAnotherDevice(CONV, ringing, call("calling", OTHER_CONV))).toBe(true);
	});

	test("not on the device placing it, which the gateway tells too, nor on one in it", () => {
		expect(callingFromAnotherDevice(CONV, ringing, call("calling"))).toBe(false);
		expect(callingFromAnotherDevice(CONV, ringing, call("connected"))).toBe(false);
	});

	test("not once it no longer rings the others: answered, cancelled or ended", () => {
		expect(callingFromAnotherDevice(CONV, new Set(), null)).toBe(false);
		expect(callingFromAnotherDevice(CONV, new Set([OTHER_CONV]), null)).toBe(false);
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

describe("call voice states", () => {
	const state = (user_id: string, room_id = CONV, muted = false): CallVoiceState => ({
		room_id,
		user_id,
		muted,
		deafened: false,
		screen_sharing: false,
		camera: false,
		watching: [],
	});
	const update = (user_id: string, joined: boolean, muted = false, room_id = CONV): VoiceStateUpdateEvent => ({
		room_id,
		user_id,
		joined,
		muted,
		deafened: false,
		screen_sharing: false,
		camera: false,
		version: 2,
	});

	test("who is in a call, from READY or CALL_ONGOING, in the conversation's room", () => {
		expect(callVoiceStatesOf(CONV, [voice(THEM), voice(ME)])).toEqual([state(THEM), state(ME)]);
		expect(callVoiceStatesOf(CONV, null)).toEqual([]);
	});

	// gateway#152: a voice state says whose screen share each user watches; a gateway or client without it, none.
	test("call voice states carry who each one watches, none when the gateway leaves it out", () => {
		expect(callVoiceStatesOf(CONV, [{ ...voice(THEM), watching: [ME] }, voice(ME)])).toEqual([
			{ ...state(THEM), watching: [ME] },
			state(ME),
		]);
		expect(withCallVoiceState([state(ME)], { ...update(THEM, true), watching: [ME] })).toEqual([
			state(ME),
			{ ...state(THEM), watching: [ME] },
		]);
		expect(withCallVoiceState([{ ...state(THEM), watching: [ME] }], update(THEM, true))).toEqual([state(THEM)]);
	});

	test("someone joining a call is added; a change of theirs replaces their state", () => {
		const joined = withCallVoiceState([state(ME)], update(THEM, true));
		expect(joined).toEqual([state(ME), state(THEM)]);
		expect(withCallVoiceState(joined, update(THEM, true, true))).toEqual([state(ME), state(THEM, CONV, true)]);
	});

	test("someone leaving a call goes; one who wasn't in it changes nothing", () => {
		const states = [state(ME), state(THEM)];
		expect(withCallVoiceState(states, update(THEM, false))).toEqual([state(ME)]);
		expect(withCallVoiceState(states, update(THEM, false, false, OTHER_CONV))).toBe(states);
	});

	test("each call keeps its own: the same user in another call is another state", () => {
		const states = [state(THEM, OTHER_CONV)];
		expect(withCallVoiceState(states, update(THEM, true))).toEqual([state(THEM, OTHER_CONV), state(THEM)]);
	});

	test("hanging up takes the user out of that call only, and leaves the others in it", () => {
		const states = [state(ME), state(THEM), state(ME, OTHER_CONV)];
		expect(withoutCallVoiceOf(states, CONV, ME)).toEqual([state(THEM), state(ME, OTHER_CONV)]);
	});
});

describe("placeAgain", () => {
	const placed = (sentOn: number | null, answered = false, conversationId = CONV) => ({
		conversationId,
		memberIds: [ME, THEM],
		sentOn,
		answered,
	});

	test("a CALL_INITIATE from an earlier connection that nothing showed the gateway got goes again", () => {
		expect(placeAgain(placed(3), call("calling"), 4)).toBe("again");
		// It found no socket open.
		expect(placeAgain(placed(null), call("calling"), 4)).toBe("again");
	});

	test("not one sent on this connection, after its identify, nor one the gateway showed it has", () => {
		expect(placeAgain(placed(4), call("calling"), 4)).toBeNull();
		// Its CALL_OUTGOING, a decline, or READY listing the call came.
		expect(placeAgain(placed(3, true), call("calling"), 4)).toBeNull();
	});

	test("forgotten once this client no longer places that call: answered, cancelled or ended", () => {
		expect(placeAgain(placed(3), call("connected"), 4)).toBe("drop");
		expect(placeAgain(placed(3), null, 4)).toBe("drop");
		expect(placeAgain(placed(3), call("calling", OTHER_CONV), 4)).toBe("drop");
		expect(placeAgain(placed(3), call("ringing"), 4)).toBe("drop");
	});

	test("nothing placed, nothing to send", () => {
		expect(placeAgain(null, call("calling"), 4)).toBeNull();
	});
});
