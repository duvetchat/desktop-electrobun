<script lang="ts">
	import type { MemberOnSidebar, GatewaySpace } from "$lib/types";
	import { gatewaySpaces } from "$lib/stores.svelte";
	import { onlineCount } from "$lib/members";
	import { loadMoreMembers, membersLoading, restartMembers } from "$lib/stores/member-pages.svelte";
	import MemberList, { spaceMembers } from "$lib/components/MemberList.svelte";
	import { GLASS } from "$lib/components/ui/recipes";

	// What was the members column. Nothing is docked beside the chat any more (#357, docs/redesign/DECISIONS.md): a
	// Space's members open from the faces in a pane's bar (MembersButton), and here only their first page is kept
	// loaded for those faces, as the column kept it while it was folded. A group's members, which its header's button
	// shows and hides by mounting this, float over the chat's top right corner as a panel, in the popover's look: they
	// take no room from the messages.
	let {
		spaceId = null,
		space = null,
		channelId = null,
		overrideMembers = undefined,
		onRemoveMember = undefined,
	}: {
		spaceId?: string | null;
		space?: GatewaySpace | null;
		channelId?: string | null;
		/** A group's members: they float as a panel. Without them, this draws nothing. */
		overrideMembers?: MemberOnSidebar[];
		onRemoveMember?: (userId: string) => void;
		/** Whether the column was folded: there's no column to fold. */
		collapsed?: boolean;
	} = $props();

	const liveSpace = $derived($gatewaySpaces.find((s) => s.id === spaceId) ?? null);
	const pagedMembers = $derived(overrideMembers !== undefined ? overrideMembers : spaceMembers(liveSpace));

	// The shown Space's members start over from their first page when the Space changes.
	let prevSpaceId: string | null = null;
	$effect(() => {
		if (overrideMembers !== undefined) return;
		if (spaceId === prevSpaceId) return;
		prevSpaceId = spaceId;
		if (spaceId) void restartMembers(spaceId);
	});

	function onscroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		if (overrideMembers === undefined && spaceId && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
			void loadMoreMembers(spaceId);
		}
	}
</script>

{#if overrideMembers !== undefined}
	<!-- No wider than nothing in its row, at the row's right end: the panel hangs from it, over the chat. -->
	<div class="relative w-0 shrink-0 self-stretch">
		<section
			aria-label="Members"
			class="{GLASS} animate-float-in text-duvet-ink absolute top-2 right-2.5 z-30 flex max-h-[min(560px,calc(100%-16px))] w-[340px] max-w-[calc(100vw-20px)] origin-top-right flex-col overflow-hidden rounded-[20px]"
		>
			<div class="flex shrink-0 items-baseline gap-2 px-4 pt-3.5 pb-1">
				<p class="text-[13.5px] font-semibold">Members</p>
				<span class="text-duvet-ink2 text-xs">{onlineCount(pagedMembers)} online</span>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto pb-2" {onscroll}>
				<MemberList members={pagedMembers} {spaceId} {space} {channelId} {onRemoveMember} />
				{#if membersLoading(spaceId)}
					<div class="flex justify-center py-3">
						<div class="border-duvet-line border-t-duvet-ink2 size-4 animate-spin rounded-full border-2"></div>
					</div>
				{/if}
			</div>
		</section>
	</div>
{/if}
