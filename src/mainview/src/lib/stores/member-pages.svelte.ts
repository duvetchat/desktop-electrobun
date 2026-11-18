import { getSpaceMembers, MEMBERS_PAGE_SIZE, type SpaceMemberWithUser } from "$lib/api/spaces";
import { gatewaySpaces } from "$lib/stores.svelte";
import type { GatewaySpace } from "$lib/types";

// A Space's members, a page at a time (#357). The members popover of every pane and the list of a Space share one
// pager per Space, so two of them open at once ask for a page once, and the faces in a pane's bar have the first page
// before the popover opens.

type Cursor = { id: string; pos: number | null };
type Pager = {
	cursor: Cursor | null;
	hasMore: boolean;
	loading: boolean;
	/** The last page failed (#388): the lists say so, with Try again, and nothing asks for it again by itself. */
	failed: boolean;
	/** How many of the Space's users the app held after the last page: fewer since means the Space was loaded anew. */
	held: number;
	abort: AbortController | null;
};

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
	pagers[spaceId] ??= { cursor: null, hasMore: true, loading: false, failed: false, held: 0, abort: null };
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

/** Loads the Space's next page of members into the app's Spaces, unless one is loading or none is left. A page that
 * failed is the next one still: this asks for it again. */
export async function loadMoreMembers(spaceId: string): Promise<void> {
	const pager = pagerOf(spaceId);
	if (pager.loading || !pager.hasMore) return;
	pager.loading = true;
	pager.failed = false;
	const abort = (pager.abort = new AbortController());
	try {
		const page = await getSpaceMembers(spaceId, pager.cursor ?? undefined, abort.signal);
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
		else pager.hasMore = false;
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

/** Forgets every pager, dropping the pages on their way: a new gateway session's, whose Spaces come back without their
 * pages (a Space whose page failed is asked again then), or a test's. */
export function forgetMemberPages(): void {
	for (const id of Object.keys(pagers)) {
		pagers[id]?.abort?.abort();
		delete pagers[id];
	}
}
