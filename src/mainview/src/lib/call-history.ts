import { get, writable } from "svelte/store";
import { CALLS_PAGE_SIZE, getCallHistory, type Conversation, type DirectMessage } from "$lib/api/conversations";
import { callNoticeLine, type CallNoticeLine } from "$lib/call-notices";
import { callingFromAnotherDevice } from "$lib/calls";
import { getAvatarURL } from "$lib/common/common";
import { conversationTitle, otherMember } from "$lib/pane";
import type { ActiveCallInfo } from "$lib/stores.svelte";
import { directMessageToMessage, MessageType } from "$lib/types";

/** The user's calls as far as they're loaded: the call notices of the conversations they're in, the newest first, as the
 * API lists them (by ID, minted as each call ended). */
export interface LoadedCalls {
	calls: DirectMessage[];
	/** The notice ID the next page starts before: the last of the last page loaded (null: none loaded yet). */
	before: string | null;
	/** Whether another page may follow. */
	more: boolean;
}

/**
 * The call history, as the Friends view's Calls tab shows it, once it started loading (null until then): the pages
 * loaded so far, kept current by the call notices that come and go (DM_MESSAGE_CREATE, DM_MESSAGE_DELETE) and by the
 * conversations the user leaves. A new gateway session forgets it, as the events of the time away never came: the tab
 * loads it anew as it next shows.
 */
export const callHistory = writable<LoadedCalls | null>(null);

const EMPTY: LoadedCalls = { calls: [], before: null, more: true };

const isCallNotice = (m: DirectMessage) => m.type === MessageType.Call && !!m.call && !!m.conversation_id;

/** A list with a call notice in it, in its place by ID. One it has stays as it is: a notice isn't edited. */
export function withCall(list: LoadedCalls, notice: DirectMessage): LoadedCalls {
	if (list.calls.some((c) => c.id === notice.id)) return list;
	const at = list.calls.findIndex((c) => c.id < notice.id);
	const calls = [...list.calls];
	calls.splice(at === -1 ? calls.length : at, 0, notice);
	return { ...list, calls };
}

/** A list without the notices `gone` picks: the same list when it has none of them. */
export function withoutCalls(list: LoadedCalls, gone: (notice: DirectMessage) => boolean): LoadedCalls {
	const calls = list.calls.filter((c) => !gone(c));
	return calls.length === list.calls.length ? list : { ...list, calls };
}

/** What went while a page was on its way: the notices deleted, and the conversations the user left. */
export interface Gone {
	ids: Set<string>;
	conversations: Set<string>;
}

/**
 * A list with a page in it (`count`, what it asked for), each call notice in its place, but those that went while it was
 * on its way. The next page starts before this one's last, and there's one only when this one was full and went further
 * back than the list had: an API that ignored the cursor would otherwise be asked for the same page again and again.
 */
export function withPage(
	list: LoadedCalls,
	page: readonly DirectMessage[],
	count: number,
	gone: Gone = { ids: new Set(), conversations: new Set() },
): LoadedCalls {
	let next = list;
	for (const notice of page) {
		if (isCallNotice(notice) && !gone.ids.has(notice.id) && !gone.conversations.has(notice.conversation_id ?? "")) {
			next = withCall(next, notice);
		}
	}
	const last = page.at(-1)?.id;
	const further = last !== undefined && (list.before === null || last < list.before);
	return { ...next, before: further ? last : list.before, more: further && page.length >= count };
}

// A load that started before the history was forgotten is dropped as it lands.
let epoch = 0;
let loading: Promise<void> | null = null;
// What went while each page was on its way.
const onTheWay = new Set<Gone>();

/**
 * Loads the history's next page, or its first. The list is there from the start, so the notices that come while a page
 * is on its way go in, and those that go stay out of it. One page at a time: a call while one is on its way waits for
 * it. Fails as the request does, leaving the list as it was.
 */
export function loadCalls(): Promise<void> {
	if (!loading) {
		const load = loadPage().finally(() => {
			if (loading === load) loading = null;
		});
		loading = load;
	}
	return loading;
}

async function loadPage() {
	let list = get(callHistory);
	if (!list) callHistory.set((list = EMPTY));
	const at = epoch;
	const gone: Gone = { ids: new Set(), conversations: new Set() };
	onTheWay.add(gone);
	try {
		const page = await getCallHistory(list.before);
		if (epoch !== at) return;
		callHistory.update((now) => now && withPage(now, page, CALLS_PAGE_SIZE, gone));
	} finally {
		onTheWay.delete(gone);
	}
}

// Changes the history, if it's loaded.
function change(next: (list: LoadedCalls) => LoadedCalls) {
	const list = get(callHistory);
	const changed = list && next(list);
	if (changed && changed !== list) callHistory.set(changed);
}

/** A message came in a conversation (DM_MESSAGE_CREATE): a call notice goes into the history, if it's loaded. */
export function callNoticeCame(message: DirectMessage) {
	if (isCallNotice(message)) change((list) => withCall(list, message));
}

/** A message was deleted in a conversation (DM_MESSAGE_DELETE): a call notice goes from the history, and stays out of
 * the page on its way. */
export function callNoticeDeleted(id: string) {
	for (const gone of onTheWay) gone.ids.add(id);
	change((list) => withoutCalls(list, (c) => c.id === id));
}

/** The user left a conversation (conversationLeft): its calls go from the history, and stay out of the page on its way. */
export function conversationCallsGone(conversationId: string) {
	for (const gone of onTheWay) gone.conversations.add(conversationId);
	change((list) => withoutCalls(list, (c) => c.conversation_id === conversationId));
}

/** Forgets the history, and the page on its way: a new gateway session, whose events of the time away never came. */
export function forgetCalls() {
	epoch++;
	loading = null;
	callHistory.set(null);
}

/** A row of the history: a call, in its conversation, as the user saw it. */
export interface CallRow {
	/** The call's notice. */
	id: string;
	conversationId: string;
	/** A DM's other person, or a group's name, as the DM list names them; "Chat" for one this client doesn't know. */
	title: string;
	/** Whether it's drawn with the group's mark rather than a face: a group, which has no picture, or a conversation this
	 * client doesn't know, as their tabs draw them (#376). */
	group: boolean;
	/** A DM's other person's avatar (null without one: their face is made from their name). */
	avatar: string | null;
	/** The notice's own sentence for the user, and whether they missed the call (its phone is red). */
	line: CallNoticeLine;
	/** When it started ringing. */
	at: string;
}

/** A call notice's row for the user me, in its conversation (undefined: one this client doesn't know); null for anything
 * but a call notice. Its sentence goes by when they joined the conversation, as its notice's in the chat does. */
export function callRow(
	notice: DirectMessage,
	conversation: Conversation | undefined,
	me: string | undefined,
): CallRow | null {
	const joined = conversation?.members.find((m) => m.user_id === me)?.id;
	const message = directMessageToMessage(notice, conversation?.members ?? []);
	const line = message && callNoticeLine(message, me, joined);
	if (!line || !notice.call || !notice.conversation_id) return null;
	const other = conversation && otherMember(conversation, me);
	return {
		id: notice.id,
		conversationId: notice.conversation_id,
		title: conversation ? conversationTitle(conversation, me) : "Chat",
		group: !other,
		avatar: other ? getAvatarURL(other.user_id, other.user?.avatar) : null,
		line,
		at: notice.call.started_at,
	};
}

/**
 * What a row's call button does in its conversation, as the mobile app's Calls tab does: join the call going on there,
 * as the conversation's banner does ("join"), or call it ("call"). Nothing while the user is in a call, places one or one
 * rings them, as the conversation's own call button; nor while their own call there still rings the others from another
 * device (callingFromAnotherDevice), which has nothing to join until someone answers.
 */
export function callBackAction(
	conversationId: string,
	withCalls: ReadonlySet<string>,
	ownRinging: ReadonlySet<string>,
	call: Pick<ActiveCallInfo, "conversationId" | "state"> | null,
): "join" | "call" | null {
	if (call || callingFromAnotherDevice(conversationId, ownRinging, call)) return null;
	return withCalls.has(conversationId) ? "join" : "call";
}

const userLocale = typeof navigator !== "undefined" ? navigator.language : "en-US";

/**
 * When a call rang, as the history's rows say it, the mobile app's way: its time today, "Yesterday", the day of the week
 * within a week, and its date before that, with the year when it isn't this one. Times and dates in the user's locale,
 * as the messages' are, and words in English, as the app's are.
 */
export function callTime(iso: string, now = new Date(), locale = userLocale): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	// Rounded: a day across a change of the clocks lasts 23 or 25 hours.
	const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
	if (days === 0) return at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
	if (days === 1) return "Yesterday";
	if (days > 1 && days < 7) return at.toLocaleDateString("en-US", { weekday: "short" });
	return at.toLocaleDateString(locale, {
		day: "numeric",
		month: "numeric",
		...(at.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" }),
	});
}
