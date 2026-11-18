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

function pagerOf(spaceId: string): Pager {
	return (pagers[spaceId] ??= { cursor: null, hasMore: true, loading: false, held: 0, abort: null });
}

/** Whether a page of the Space's members is on its way, for a spinner under the list. */
export function membersLoading(spaceId: string | null | undefined): boolean {
	return !!spaceId && !!pagers[spaceId]?.loading;
}

/** Loads the Space's next page of members into the app's Spaces, unless one is loading or none is left. */
export async function loadMoreMembers(spaceId: string): Promise<void> {
	const pager = pagerOf(spaceId);
	if (pager.loading || !pager.hasMore) return;
	pager.loading = true;
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
		if (e instanceof Error && e.name !== "AbortError" && !abort.signal.aborted) {
			console.error("[members] pagination error:", e);
		}
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
	pager.held = 0;
	return loadMoreMembers(spaceId);
}

/**
 * Makes sure the Space's first page of members is loaded or on its way: the first time it's asked for, and again once
 * the app holds fewer of the Space's users than after its last page (`heldNow`), which is the Space loaded anew by a
 * new gateway session, without its pages.
 */
export function ensureMembers(spaceId: string, heldNow: number): Promise<void> {
	const pager = pagers[spaceId];
	if (!pager) return loadMoreMembers(spaceId);
	if (!pager.loading && heldNow < pager.held) return restartMembers(spaceId);
	return Promise.resolve();
}

/** Forgets every pager: a test's, or a sign-out's. */
export function forgetMemberPages(): void {
	for (const id of Object.keys(pagers)) {
		pagers[id]?.abort?.abort();
		delete pagers[id];
	}
}
