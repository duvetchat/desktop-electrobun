<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { onMount } from "svelte";
	import { Users } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import type { GatewaySpace, MemberOnSidebar } from "$lib/types";
	import type { MembersKind } from "$lib/layout-prefs";
	import { layoutPrefs } from "$lib/layout-prefs.svelte";
	import { memberFaces, membersLabel, onlineCount } from "$lib/members";
	import { onOpenElsewhere } from "$lib/stores.svelte";
	import { ensureMembers } from "$lib/stores/member-pages.svelte";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import { spaceMembers } from "$lib/components/MemberList.svelte";
	import MembersPanel from "$lib/components/MembersPanel.svelte";
	import { GLASS } from "$lib/components/ui/recipes";

	// The members of a room, or of a group, in a pane's bar: a few faces, the online ones first. Beside a Space's text
	// room or a group, in a pane with room for it, they open and close the members column at the pane's right (#409);
	// anywhere else (a voice room, a DM, a narrow pane) they open the member list in a popover. Either way the button
	// loads the Space's first page of members as soon as it shows, for its faces.
	let {
		space = null,
		channelId,
		members: given = undefined,
		title = "Members",
		onRemoveMember = undefined,
		onMention = undefined,
		column = undefined,
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
		onRemoveMember?: (userId: string) => Promise<void>;
		/** Mentions a member in the chat's message box. */
		onMention?: (userId: string) => void;
		/** The kind of chat whose members column it opens and closes, while its pane has room for one (membersColumnOf).
		 * Without one, it opens the popover. */
		column?: MembersKind;
		open?: boolean;
	} = $props();

	const members = $derived(given ?? spaceMembers(space));
	const online = $derived(onlineCount(members));
	const stack = $derived(memberFaces(members));
	const pagedSpaceId = $derived(given === undefined ? (space?.id ?? null) : null);
	// Whether the column of its kind of chat is open, as the layout prefs keep it across chats and reloads.
	const columnOpen = $derived(column !== undefined && layoutPrefs.membersColumn[column]);

	$effect(() => {
		if (pagedSpaceId) void ensureMembers(pagedSpaceId);
	});

	function toggleColumn() {
		if (column) layoutPrefs.membersColumn[column] = !layoutPrefs.membersColumn[column];
	}

	// A pane that grows wide enough for the column takes the list there: an open popover closes, rather than open again
	// by itself once the pane narrows.
	$effect(() => {
		if (column) open = false;
	});

	// A member's menu in the popover opens their chat (Message, Call) elsewhere: the popover closes first, as the pins
	// list does. Their Mention puts the focus in the message box, which the popover would keep: it closes first too.
	onMount(() => onOpenElsewhere(() => (open = false)));
	const mention = $derived(
		onMention
			? (userId: string) => {
					open = false;
					onMention(userId);
				}
			: undefined,
	);

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});

	const buttonClass =
		"hover:bg-duvet-hover text-duvet-ink2 flex h-[30px] shrink-0 items-center gap-1.5 rounded-tile pr-[9px] pl-[7px] text-[12.5px] font-medium transition-colors duration-[120ms] motion-reduce:transition-none";
</script>

{#snippet faces()}
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
{/snippet}

{#if column}
	<!-- Pressed while the column is open, with the look its popover gives it while open. -->
	<button
		type="button"
		class="{buttonClass} {columnOpen ? 'bg-duvet-accent-tint' : ''}"
		aria-label={membersLabel(online)}
		aria-pressed={columnOpen}
		title={columnOpen ? "Hide members" : "Show members"}
		onclick={toggleColumn}
	>
		{@render faces()}
	</button>
{:else}
	<Popover.Root bind:open>
		<Popover.Trigger
			class="{buttonClass} {open ? 'bg-duvet-accent-tint' : ''}"
			aria-label={membersLabel(online)}
			title="Members"
		>
			{@render faces()}
		</Popover.Trigger>
		<Popover.Portal>
			{#if layer}
				<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
				<div class="fixed top-0 left-0" style={layerStyle(layer)}>
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
						<MembersPanel
							{members}
							spaceId={pagedSpaceId}
							{space}
							{channelId}
							{title}
							{onRemoveMember}
							onMention={mention}
						/>
					</Popover.Content>
				</div>
			{/if}
		</Popover.Portal>
	</Popover.Root>
{/if}
