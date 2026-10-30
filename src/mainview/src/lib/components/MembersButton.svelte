<script lang="ts">
	import { PanelRightClose, PanelRightOpen, Users } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import type { GatewaySpace } from "$lib/types";
	import { memberFaces, membersLabel, onlineCount } from "$lib/members";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import MemberList, { spaceMembers } from "$lib/components/MemberList.svelte";

	// The room's members in a pane's bar: a few faces, the online ones first, that open the member list in a popover.
	// From there the list can be pinned open as the members column, or the column closed.
	let {
		space,
		channelId,
		columnOpen,
		onColumn,
	}: {
		space: GatewaySpace;
		channelId: string;
		/** Whether the members column is open beside the panes. */
		columnOpen: boolean;
		onColumn: (open: boolean) => void;
	} = $props();

	let open = $state(false);

	const members = $derived(spaceMembers(space));
	const online = $derived(onlineCount(members));
	const stack = $derived(memberFaces(members));
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="hover:bg-duvet-card focus-visible:outline-duvet-accent flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-1.5 transition-colors focus-visible:outline-2 motion-reduce:transition-none {open
			? 'bg-duvet-card'
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
			/>
		{:else}
			<Users class="text-duvet-ink2 size-4" />
		{/if}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			side="bottom"
			align="end"
			sideOffset={8}
			class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float z-50 flex max-h-[70vh] w-72 flex-col overflow-hidden border"
		>
			<div class="border-duvet-line flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4">
				<p class="text-[13px] font-bold">Members</p>
				<span class="text-duvet-ink2 text-xs">{online} online</span>
				<button
					type="button"
					class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink focus-visible:outline-duvet-accent ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 motion-reduce:transition-none"
					onclick={() => {
						onColumn(!columnOpen);
						open = false;
					}}
				>
					{#if columnOpen}
						<PanelRightClose class="size-4" />
						Close column
					{:else}
						<PanelRightOpen class="size-4" />
						Pin as column
					{/if}
				</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto pb-2">
				<MemberList {members} spaceId={space.id} {space} {channelId} />
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
