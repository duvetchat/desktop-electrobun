<script lang="ts">
	import { Users } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import type { GatewaySpace, MemberOnSidebar } from "$lib/types";
	import { memberFaces, membersLabel, onlineCount } from "$lib/members";
	import { ensureMembers, loadMoreMembers, membersLoading } from "$lib/stores/member-pages.svelte";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import MemberList, { spaceMembers } from "$lib/components/MemberList.svelte";
	import { GLASS } from "$lib/components/ui/recipes";

	// The members of a room, or of a group, in a pane's bar: a few faces, the online ones first, that open the member
	// list in a popover. Nothing is docked beside the chat (#357): the popover is the members' one home, so it loads the
	// Space's members itself, a page at a time as it scrolls, and the first page as soon as the button shows, for its
	// faces.
	let {
		space = null,
		channelId,
		members: given = undefined,
		title = "Members",
		onRemoveMember = undefined,
		open = $bindable(false),
	}: {
		/** The room's Space. A group passes its members instead. */
		space?: GatewaySpace | null;
		/** The room or the conversation whose typing the rows show. */
		channelId: string;
		/** A group's members: they are all there, so nothing is paged. */
		members?: MemberOnSidebar[];
		/** The popover's heading: "Members", or a group's name. */
		title?: string;
		/** Removes a member from a group, for its owner. */
		onRemoveMember?: (userId: string) => void;
		open?: boolean;
		/** The members column these opened and closed. It is gone (docs/redesign/DECISIONS.md): both are ignored. */
		columnOpen?: boolean;
		onColumn?: (open: boolean) => void;
	} = $props();

	const members = $derived(given ?? spaceMembers(space));
	const online = $derived(onlineCount(members));
	const stack = $derived(memberFaces(members));
	const pagedSpaceId = $derived(given === undefined ? (space?.id ?? null) : null);

	$effect(() => {
		if (pagedSpaceId) void ensureMembers(pagedSpaceId, space?.users.length ?? 0);
	});

	function onscroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		if (pagedSpaceId && el.scrollHeight - el.scrollTop - el.clientHeight < 150) void loadMoreMembers(pagedSpaceId);
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="hover:bg-duvet-hover text-duvet-ink2 flex h-[30px] shrink-0 items-center gap-1.5 rounded-[9px] pr-[9px] pl-[7px] text-[12.5px] font-medium transition-colors duration-[120ms] motion-reduce:transition-none {open
			? 'bg-duvet-accent-tint'
			: ''}"
		aria-label={membersLabel(online)}
		title={membersLabel(online)}
	>
		{#if stack.faces.length > 0}
			<FaceStack
				faces={stack.faces.map((m) => ({
					id: m.id,
					src: m.avatar_url,
					name: m.username,
					dim: m.status === "offline",
				}))}
				more={stack.more}
				size={18}
			/>
		{:else}
			<Users size={16} />
		{/if}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			side="bottom"
			align="end"
			sideOffset={8}
			collisionPadding={10}
			updatePositionStrategy="always"
			role="dialog"
			aria-label={title}
			class="{GLASS} animate-float-in text-duvet-ink z-[1000] flex max-h-[min(560px,72vh)] w-[min(340px,calc(100vw-20px))] origin-(--bits-floating-transform-origin) flex-col overflow-hidden rounded-[20px] outline-none"
		>
			<div class="flex shrink-0 items-baseline gap-2 px-4 pt-3.5 pb-1">
				<p class="min-w-0 truncate text-[13.5px] font-semibold">{title}</p>
				<span class="text-duvet-ink2 shrink-0 text-xs">{online} online</span>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto pb-2" {onscroll}>
				<MemberList {members} spaceId={pagedSpaceId} {space} {channelId} {onRemoveMember} />
				{#if membersLoading(pagedSpaceId)}
					<div class="flex justify-center py-3" role="status" aria-label="Loading more members">
						<div class="border-duvet-line border-t-duvet-ink2 size-4 animate-spin rounded-full border-2"></div>
					</div>
				{/if}
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
