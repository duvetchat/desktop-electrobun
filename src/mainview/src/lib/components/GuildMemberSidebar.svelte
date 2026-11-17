<script lang="ts">
	import type { MemberOnSidebar, GatewaySpace } from "$lib/types";
	import { gatewaySpaces } from "$lib/stores.svelte";
	import { getSpaceMembers, MEMBERS_PAGE_SIZE, type SpaceMemberWithUser } from "$lib/api/spaces";
	import { onlineCount } from "$lib/members";
	import MemberList, { spaceMembers } from "$lib/components/MemberList.svelte";

	let {
		spaceId = null,
		space = null,
		channelId = null,
		overrideMembers = undefined,
		onRemoveMember = undefined,
		collapsed = false,
	}: {
		spaceId?: string | null;
		space?: GatewaySpace | null;
		channelId?: string | null;
		overrideMembers?: MemberOnSidebar[];
		onRemoveMember?: (userId: string) => void;
		collapsed?: boolean;
	} = $props();

	// ── Pagination ─────────────────────────────────────────────────────────────
	let cursor: { id: string; pos: number | null } | null = null;
	let hasMore = $state(true);
	let loading = $state(false);
	let listEl: HTMLElement;
	let abortController: AbortController | null = null;
	let prevSpaceId: string | null = null;

	function mergeIntoStore(rows: SpaceMemberWithUser[]) {
		if (!spaceId) return;
		gatewaySpaces.update((spaces) =>
			spaces.map((s) => {
				if (s.id !== spaceId) return s;
				const existingUserIds = new Set(s.users.map((u) => u.id));
				const incomingUserIds = new Set(rows.map((r) => r.user.id));
				// Replace any placeholder members for the same users with real data
				const filteredMembers = s.members.filter((m) => !incomingUserIds.has(m.user_id));
				const newUsers = rows.map((r) => r.user).filter((u) => !existingUserIds.has(u.id));
				const newMembers = rows.map(({ user: _u, max_pos: _p, ...m }) => m);
				return {
					...s,
					users: [...s.users, ...newUsers],
					members: [...filteredMembers, ...newMembers],
				};
			}),
		);
	}

	async function loadMore() {
		if (!spaceId || loading || !hasMore) return;
		loading = true;
		abortController = new AbortController();
		try {
			const page = await getSpaceMembers(spaceId, cursor ?? undefined, abortController.signal);
			mergeIntoStore(page);
			if (page.length < MEMBERS_PAGE_SIZE) {
				hasMore = false;
			} else {
				const last = page[page.length - 1];
				cursor = {
					id: last.id,
					pos: last.max_pos === -1 ? null : last.max_pos,
				};
			}
		} catch (e: unknown) {
			if (e instanceof Error && e.name !== "AbortError") {
				console.error("[members] pagination error:", e);
			}
		} finally {
			loading = false;
		}
	}

	function handleScroll() {
		if (!listEl || loading || !hasMore) return;
		const { scrollTop, scrollHeight, clientHeight } = listEl;
		if (scrollHeight - scrollTop - clientHeight < 150) {
			void loadMore();
		}
	}

	const liveSpace = $derived($gatewaySpaces.find((s) => s.id === spaceId) ?? null);
	const pagedMembers = $derived(overrideMembers !== undefined ? overrideMembers : spaceMembers(liveSpace));

	// Reset and reload when the active space changes. The column loads its space's first page even while it's closed:
	// the faces in the panes' bars show those members.

	$effect(() => {
		if (overrideMembers !== undefined) return;
		if (spaceId === prevSpaceId) return;
		prevSpaceId = spaceId;
		abortController?.abort();
		cursor = null;
		hasMore = true;
		loading = false;
		if (spaceId) void loadMore();
	});
</script>

<div
	class="border-duvet-line bg-duvet-bg flex shrink-0 flex-col overflow-hidden border-l transition-[width] duration-200 motion-reduce:transition-none {collapsed
		? 'w-0 border-l-0'
		: 'w-64'}"
	inert={collapsed}
>
	<div class="border-duvet-line flex h-12 shrink-0 items-center justify-between border-b px-4">
		<p class="text-duvet-ink text-[13px] font-bold">Members</p>
		<span class="text-duvet-ink2 text-xs">{onlineCount(pagedMembers)} online</span>
	</div>
	<div class="flex-1 overflow-y-auto" bind:this={listEl} onscroll={handleScroll}>
		<!-- Folded, the column is 0 px wide: it mounts no rows, with their avatars, banners and popovers, until it opens. Its
		     first page still loads, for the faces in the panes' bars (#327). -->
		{#if !collapsed}
			<MemberList members={pagedMembers} {spaceId} {space} {channelId} {onRemoveMember} />
		{/if}

		{#if loading}
			<div class="flex justify-center py-3">
				<div class="size-4 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-300"></div>
			</div>
		{/if}
	</div>
</div>
