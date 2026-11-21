<script lang="ts">
	import { untrack } from "svelte";
	import type { GatewaySpace, MemberOnSidebar } from "$lib/types";
	import { onlineCount } from "$lib/members";
	import { loadMoreMembers, membersFailed } from "$lib/stores/member-pages.svelte";
	import MemberList from "$lib/components/MemberList.svelte";
	import MemberPagesStatus from "$lib/components/MemberPagesStatus.svelte";

	// A chat's members under their head, in a list that scrolls on its own: what the members popover of a pane's bar
	// holds, and the members column beside a chat (#409). A Space's members come a page at a time as the list nears its
	// end, from the pager its Space shares with every other list of it.
	let {
		members,
		spaceId = null,
		space = null,
		channelId,
		title = "Members",
		onRemoveMember = undefined,
		onMention = undefined,
		surface = "popover",
	}: {
		members: MemberOnSidebar[];
		/** The Space whose members the list pages; none for a group's, which are all there. */
		spaceId?: string | null;
		space?: GatewaySpace | null;
		/** The room or the conversation whose typing the rows show. */
		channelId: string;
		/** The head: "Members", or a group's name. */
		title?: string;
		/** Removes a member from a group, for its owner. */
		onRemoveMember?: (userId: string) => Promise<void>;
		/** Mentions a member in the chat's message box. */
		onMention?: (userId: string) => void;
		/** What it's drawn on: the popover, or the pane beside the chat. */
		surface?: "popover" | "pane";
	} = $props();

	const online = $derived(onlineCount(members));

	// A page that failed (#388) is asked for again as the list opens (the popover mounts it as it opens, the column as it
	// shows), once, and otherwise by its Try again: not by each scroll at the list's end, which would ask again and
	// again while the API refuses.
	$effect(() => {
		const id = spaceId;
		if (!id) return;
		untrack(() => {
			if (membersFailed(id)) void loadMoreMembers(id);
		});
	});

	function onscroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		if (spaceId && !membersFailed(spaceId) && el.scrollHeight - el.scrollTop - el.clientHeight < 150)
			void loadMoreMembers(spaceId);
	}
</script>

<div class="flex shrink-0 items-baseline gap-2 px-4 pt-3.5 pb-1">
	<p class="min-w-0 truncate text-[13.5px] font-semibold">{title}</p>
	<span class="text-duvet-ink2 shrink-0 text-xs">{online} online</span>
</div>
<div class="min-h-0 flex-1 overflow-y-auto pb-2" {onscroll}>
	<MemberList {members} {spaceId} {space} {channelId} {onRemoveMember} {onMention} {surface} />
	<MemberPagesStatus {spaceId} />
</div>
