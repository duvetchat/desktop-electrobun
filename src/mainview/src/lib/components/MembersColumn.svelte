<script lang="ts">
	import type { GatewaySpace, MemberOnSidebar } from "$lib/types";
	import MembersPanel from "$lib/components/MembersPanel.svelte";
	import { spaceMembers } from "$lib/components/MemberList.svelte";

	// The members of a Space's text room, or of a group, in a column at the right of its pane, beside the chat (#409):
	// the list the bar's members button opens in its popover, kept in view, on the pane's own colour past a hairline. Its
	// pane draws it while that kind of chat has its column open and the pane has room for it (membersColumnOf).
	let {
		space = null,
		channelId,
		members: given = undefined,
		onRemoveMember = undefined,
	}: {
		/** The room's Space. A group passes its members instead. */
		space?: GatewaySpace | null;
		/** The room or the conversation whose typing the rows show. */
		channelId: string;
		/** A group's members: they are all there, so nothing is paged. */
		members?: MemberOnSidebar[];
		/** Removes a member from a group, for its owner. */
		onRemoveMember?: (userId: string) => void;
	} = $props();

	const members = $derived(given ?? spaceMembers(space));
	const pagedSpaceId = $derived(given === undefined ? (space?.id ?? null) : null);
</script>

<!-- Another Space's members are another list: it starts at its top. -->
<aside
	aria-label="Members"
	class="border-duvet-line text-duvet-ink flex w-60 shrink-0 flex-col overflow-hidden border-l font-serif"
>
	{#key pagedSpaceId}
		<MembersPanel {members} spaceId={pagedSpaceId} {space} {channelId} {onRemoveMember} surface="pane" />
	{/key}
</aside>
