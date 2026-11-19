import { FetchError } from "$lib/api/api";
import { getSpaceMembers, MEMBERS_PAGE_SIZE, type SpaceMemberWithUser } from "$lib/api/spaces";
import { gatewaySpaces } from "$lib/stores.svelte";
import type { GatewaySpace } from "$lib/types";

// A Space's members, a page at a time (#357). The members popover and column of every pane and the list of a Space
// share one pager per Space, so two of them open at once ask for a page once, and the faces in a pane's bar have the
// first page before the popover opens.

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

/** A Space with a page of its members merged in: users it didn't have, each member's row in place of the placeholder
 *  the gateway sent for them, and the role changes that waited for those rows (withMemberRole). */
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
		member_roles: withWaitingRoles(space, rows),
	};
}

// A user's roles with one given or taken.
function rolesWith(held: string[], roleId: string, has: boolean): string[] {
	if (!has) return held.filter((id) => id !== roleId);
	return held.includes(roleId) ? held : [...held, roleId];
}

// The role changes of members whose page hasn't come, by Space and member ID, in the order they came (#380): the role
// events name a member by their member ID, and the Space keeps roles by user ID, which only their page of members
// tells the app.
const waitingRoles = new Map<string, Map<string, { roleId: string; has: boolean }[]>>();

/**
 * The Spaces with a role given to a member or taken from them (MEMBER_ROLE_ADD, MEMBER_ROLE_REMOVE): in the Space whose
 * members have them, or else the one the role is of. A member whose page hasn't come, the user included (the
 * gateway's row for them carries their user ID), gets the change as their page comes (withMemberPage), and the Spaces
 * stay as they are until then. The change was dropped for them before, and they showed the roles of the session's
 * start.
 */
export function withMemberRole(spaces: GatewaySpace[], memberId: string, roleId: string, has: boolean): GatewaySpace[] {
	const space =
		spaces.find((s) => s.members.some((m) => m.id === memberId)) ??
		spaces.find((s) => s.roles.some((r) => r.id === roleId));
	if (!space) return spaces;
	const member = space.members.find((m) => m.id === memberId);
	if (!member) {
		const bySpace = waitingRoles.get(space.id) ?? new Map<string, { roleId: string; has: boolean }[]>();
		waitingRoles.set(space.id, bySpace);
		bySpace.set(memberId, [...(bySpace.get(memberId) ?? []), { roleId, has }]);
		return spaces;
	}
	const held = space.member_roles[member.user_id] ?? [];
	const next = rolesWith(held, roleId, has);
	if (next.length === held.length) return spaces;
	return spaces.map((s) => (s === space ? { ...s, member_roles: { ...s.member_roles, [member.user_id]: next } } : s));
}

// The Space's roles by user ID with the changes that waited for these rows applied, in the order they came; each is
// applied once.
function withWaitingRoles(space: GatewaySpace, rows: SpaceMemberWithUser[]): GatewaySpace["member_roles"] {
	const waiting = waitingRoles.get(space.id);
	if (!waiting) return space.member_roles;
	let memberRoles = space.member_roles;
	for (const row of rows) {
		const changes = waiting.get(row.id);
		if (!changes) continue;
		waiting.delete(row.id);
		const held = changes.reduce((roles, c) => rolesWith(roles, c.roleId, c.has), memberRoles[row.user_id] ?? []);
		memberRoles = { ...memberRoles, [row.user_id]: held };
	}
	return memberRoles;
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
		gatewaySpaces.update((spaces) => spaces.map((s) => (s.id === spaceId ? withMemberPage(s, page) : s)));
		const cursor = cursorAfter(page);
		if (cursor) pager.cursor = cursor;
		// A page that came short is the last, but for whoever joined while it was on its way (memberJoined).
		else if (pager.joins === joins) pager.hasMore = false;
	} catch (e: unknown) {
		// A page dropped as the user left the Space, or for a new session (forgetMemberPages), failed nothing. One the
		// API refused, or that got no answer in its time (lib/api/api.ts), did.
		if (abort.signal.aborted) return;
		console.error("[members] pagination error:", e);
		pager.failed = true;
	} finally {
		if (pager.abort === abort) pager.loading = false;
	}
}

/**
 * Makes sure the Space's first page of members is loaded or on its way: the first time it's asked for, and again once
 * its pages were forgotten, as a Space left (SPACE_DELETE) and a new session (READY) forget them: either brings it back
 * with its user alone. A page that failed isn't asked for again here, where whatever shows the Space asks as it
 * changes, and would ask in a loop while the API refuses: the lists' Try again does (loadMoreMembers).
 */
export function ensureMembers(spaceId: string): Promise<void> {
	return pagers[spaceId] ? Promise.resolve() : loadMoreMembers(spaceId);
}

/** Whether the Space may have members left to load, as far as its pages tell. */
export function moreMembers(spaceId: string): boolean {
	return pagers[spaceId]?.hasMore ?? true;
}

/**
 * Loads the Space's next page for a list of all its members, the Members section of its settings (#380): one when none
 * is on its way, the last didn't fail and more are left, while the app holds fewer than `upTo` of the Space's users
 * (`heldNow`), EVERY_PAGE_GAP ms after the last was asked for. The list asks again as each page lands, so they come one
 * after another. A member leaving changes none of it: their page stays loaded. A page that failed waits for the list's
 * Try again (loadMoreMembers), as in ensureMembers.
 */
export function loadEveryMember(spaceId: string, heldNow: number, upTo: number): Promise<void> {
	const pager = pagers[spaceId];
	if (!pager) return loadMoreMembers(spaceId);
	if (pager.loading || pager.failed || heldNow >= upTo) return Promise.resolve();
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

/**
 * Forgets a Space's pager, or every one, dropping the pages on their way, and the role changes that waited for them: a
 * Space the user left (SPACE_DELETE), or every Space for a new gateway session (READY), both of which bring a Space back
 * with its user alone and its roles as they are then, whose pages start over from the first (a page that failed
 * included); or a test's. A page that landed after the user left moved the pager on, and the Space joined again never
 * got the members before it (#380).
 */
export function forgetMemberPages(spaceId?: string): void {
	for (const id of spaceId === undefined ? Object.keys(pagers) : [spaceId]) {
		pagers[id]?.abort?.abort();
		delete pagers[id];
	}
	if (spaceId === undefined) waitingRoles.clear();
	else waitingRoles.delete(spaceId);
}
