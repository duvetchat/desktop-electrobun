import { FetchError } from "$lib/api/api";
import { getSpaceMembers, MEMBERS_PAGE_SIZE, type SpaceMemberWithUser } from "$lib/api/spaces";
import { gatewaySpaces } from "$lib/stores.svelte";
import type { GatewaySpace } from "$lib/types";

// A Space's members, a page at a time (#357). The members popover of every pane and the list of a Space share one
// pager per Space, so two of them open at once ask for a page once, and the faces in a pane's bar have the first page
// before the popover opens.

/** How long a list of every member leaves between its pages, in ms (#380): the API takes 50 requests a second from a
 *  user across its routes, and 64 a minute of a Space's members, and back to back a large Space's pages would take a
 *  fast link past both. */
export const EVERY_PAGE_GAP = 100;

/** How many times a page is asked for while the API turns it away for its rate (429), each after the wait it asks for. */
export const RATE_LIMIT_TRIES = 3;

type Cursor = { id: string; pos: number | null };
type Pager = {
	cursor: Cursor | null;
	hasMore: boolean;
	loading: boolean;
	/** The last page failed (#388): the lists say so, with Try again, and nothing asks for it again by itself. */
	failed: boolean;
	/** How many of the Space's users the app held after the last page: fewer since means the Space was loaded anew. */
	held: number;
	/** How many have joined the Space while its pages were followed (memberJoined), which a page on its way may lack. */
	joins: number;
	/** When its last page was asked for (performance.now), which the next of a list of every member waits on. */
	askedAt: number;
	abort: AbortController | null;
};

// Resolves after ms, or as soon as signal aborts.
function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done);
	});
}

// The wait the API asks for before a page it turned away for its rate (429), in ms, from its headers (which it lets
// the app read across origins); null for any other failure. Between 50 ms and the minute of the route's window.
function rateLimitWait(err: unknown): number | null {
	if (!(err instanceof FetchError) || err.response?.status !== 429) return null;
	const headers = err.response.headers;
	const seconds = Number(headers?.get("X-RateLimit-Reset-After") ?? headers?.get("Retry-After") ?? 1);
	return Math.min(Math.max(Number.isFinite(seconds) ? seconds * 1000 : 1000, 50), 60_000);
}

/** A Space with a page of its members merged in: users it didn't have, and each member's row in place of the placeholder
 *  the gateway sent for them. */
export function withMemberPage(space: GatewaySpace, rows: SpaceMemberWithUser[]): GatewaySpace {
	const known = new Set(space.users.map((u) => u.id));
	const incoming = new Set(rows.map((r) => r.user.id));
	return {
		...space,
		users: [...space.users, ...rows.map((r) => r.user).filter((u) => !known.has(u.id))],
		members: [
			...space.members.filter((m) => !incoming.has(m.user_id)),
			...rows.map(({ user: _user, max_pos: _pos, ...member }) => member),
		],
	};
}

/** Where the page after this one starts, or null when this page was the last (it came short). */
export function cursorAfter(page: SpaceMemberWithUser[], pageSize = MEMBERS_PAGE_SIZE): Cursor | null {
	const last = page.at(-1);
	if (!last || page.length < pageSize) return null;
	return { id: last.id, pos: last.max_pos === -1 ? null : last.max_pos };
}

const pagers = $state<Record<string, Pager>>({});

// The Space's pager, as the store reads it: the proxy $state made of it (#388). `??=` gives back the object assigned,
// not that proxy, and what a page wrote there never reached what the lists read: the popover's spinner spun on after
// a Space's first page, and no page after it was asked for.
function pagerOf(spaceId: string): Pager {
	pagers[spaceId] ??= {
		cursor: null,
		hasMore: true,
		loading: false,
		failed: false,
		held: 0,
		joins: 0,
		askedAt: -Infinity,
		abort: null,
	};
	return pagers[spaceId];
}

/** Whether a page of the Space's members is on its way, for a spinner under the list. */
export function membersLoading(spaceId: string | null | undefined): boolean {
	return !!spaceId && !!pagers[spaceId]?.loading;
}

/** Whether the Space's last page of members failed, for the lists to say so: loadMoreMembers tries it again. */
export function membersFailed(spaceId: string | null | undefined): boolean {
	return !!spaceId && !!pagers[spaceId]?.failed;
}

/** Loads the Space's next page of members into the app's Spaces, unless one is loading or none is left, after `wait` ms
 * (a list of every member's pace). A page that failed is the next one still: this asks for it again. One the API turns
 * away for its rate is asked for again once the wait it asks for is over, a few times, before it counts as failed. */
export async function loadMoreMembers(spaceId: string, wait = 0): Promise<void> {
	const pager = pagerOf(spaceId);
	if (pager.loading || !pager.hasMore) return;
	pager.loading = true;
	pager.failed = false;
	const joins = pager.joins;
	const abort = (pager.abort = new AbortController());
	try {
		if (wait > 0) await pause(wait, abort.signal);
		let page: SpaceMemberWithUser[] | undefined;
		for (let tries = 1; !page; tries++) {
			if (abort.signal.aborted) return;
			pager.askedAt = performance.now();
			try {
				page = await getSpaceMembers(spaceId, pager.cursor ?? undefined, abort.signal);
			} catch (err) {
				const limited = rateLimitWait(err);
				if (limited === null || tries >= RATE_LIMIT_TRIES || abort.signal.aborted) throw err;
				await pause(limited, abort.signal);
			}
		}
		if (abort.signal.aborted) return;
		let held = 0;
		gatewaySpaces.update((spaces) =>
			spaces.map((s) => {
				if (s.id !== spaceId) return s;
				const next = withMemberPage(s, page);
				held = next.users.length;
				return next;
			}),
		);
		pager.held = held;
		const cursor = cursorAfter(page);
		if (cursor) pager.cursor = cursor;
		// A page that came short is the last, but for whoever joined while it was on its way (memberJoined).
		else if (pager.joins === joins) pager.hasMore = false;
	} catch (e: unknown) {
		// A page dropped for a newer one (restartMembers) or for a new session (forgetMemberPages) failed nothing. One
		// the API refused, or that got no answer in its time (lib/api/api.ts), did.
		if (abort.signal.aborted) return;
		console.error("[members] pagination error:", e);
		pager.failed = true;
	} finally {
		if (pager.abort === abort) pager.loading = false;
	}
}

/** Starts the Space's members over from their first page, dropping a page still on its way. */
export function restartMembers(spaceId: string): Promise<void> {
	const pager = pagerOf(spaceId);
	pager.abort?.abort();
	pager.abort = null;
	pager.cursor = null;
	pager.hasMore = true;
	pager.loading = false;
	pager.failed = false;
	pager.held = 0;
	return loadMoreMembers(spaceId);
}

/**
 * Makes sure the Space's first page of members is loaded or on its way: the first time it's asked for, and again once
 * the app holds fewer of the Space's users than after its last page (`heldNow`), which is the Space loaded anew, as
 * after the user left it and joined again. A page that failed isn't asked for again here, where whatever shows the
 * Space asks as it changes, and would ask in a loop while the API refuses: the lists' Try again does (loadMoreMembers).
 */
export function ensureMembers(spaceId: string, heldNow: number): Promise<void> {
	const pager = pagers[spaceId];
	if (!pager) return loadMoreMembers(spaceId);
	if (!pager.loading && heldNow < pager.held) return restartMembers(spaceId);
	return Promise.resolve();
}

/** Whether the Space may have members left to load, as far as its pages tell. */
export function moreMembers(spaceId: string): boolean {
	return pagers[spaceId]?.hasMore ?? true;
}

/**
 * Loads the Space's next page for a list of all its members, the Members section of its settings (#380): one when none
 * is on its way, the last didn't fail and more are left, while the app holds fewer than `upTo` of the Space's users
 * (`heldNow`), EVERY_PAGE_GAP ms after the last was asked for. The list asks again as each page lands, so they come one
 * after another; a Space loaded anew starts over. A page that failed waits for the list's Try again (loadMoreMembers),
 * as in ensureMembers.
 */
export function loadEveryMember(spaceId: string, heldNow: number, upTo: number): Promise<void> {
	const pager = pagers[spaceId];
	if (!pager) return loadMoreMembers(spaceId);
	if (pager.loading || pager.failed) return Promise.resolve();
	if (heldNow < pager.held) return restartMembers(spaceId);
	if (heldNow >= upTo) return Promise.resolve();
	return loadMoreMembers(spaceId, pager.askedAt + EVERY_PAGE_GAP - performance.now());
}

/**
 * Someone joined the Space (SPACE_MEMBER_ADD). A new member holds no role yet, so the API lists them after everyone
 * loaded so far: a Space whose pages all came has more again, from where its last full page ended, for whichever list
 * wants them. A Space whose members nothing loaded has nothing to ask again for.
 */
export function memberJoined(spaceId: string): void {
	const pager = pagers[spaceId];
	if (!pager) return;
	pager.joins++;
	pager.hasMore = true;
}

/** Forgets every pager, dropping the pages on their way: a new gateway session's, whose Spaces come back without their
 * pages (a Space whose page failed is asked again then), or a test's. */
export function forgetMemberPages(): void {
	for (const id of Object.keys(pagers)) {
		pagers[id]?.abort?.abort();
		delete pagers[id];
	}
}
