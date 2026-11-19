<script lang="ts">
	import { untrack } from "svelte";
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { Pin, Users } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import type { GatewaySpace, MemberOnSidebar } from "$lib/types";
	import type { MembersKind } from "$lib/layout-prefs";
	import { layoutPrefs } from "$lib/layout-prefs.svelte";
	import { followPin, memberFaces, membersLabel, onlineCount } from "$lib/members";
	import { ensureMembers, loadMoreMembers, membersFailed } from "$lib/stores/member-pages.svelte";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import MemberList, { spaceMembers } from "$lib/components/MemberList.svelte";
	import MemberPagesStatus from "$lib/components/MemberPagesStatus.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
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
		kind = undefined,
		shown = true,
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
		/** The kind of chat it's in, whose pin keeps it open: a Space's text room, or a group. None (a voice room, a DM),
		 * and it can't be kept open. */
		kind?: MembersKind;
		/** Whether its chat is on screen: the Friends view hides the panes, and a popover kept open goes with them. */
		shown?: boolean;
		open?: boolean;
	} = $props();

	const members = $derived(given ?? spaceMembers(space));
	const online = $derived(onlineCount(members));
	const stack = $derived(memberFaces(members));
	const pagedSpaceId = $derived(given === undefined ? (space?.id ?? null) : null);

	$effect(() => {
		if (pagedSpaceId) void ensureMembers(pagedSpaceId);
	});

	// A page that failed (#388) is asked for again as the popover opens, once, and otherwise by its Try again: not by each
	// scroll at the list's end, which would ask again and again while the API refuses.
	$effect(() => {
		const id = open ? pagedSpaceId : null;
		if (!id) return;
		untrack(() => {
			if (membersFailed(id)) void loadMoreMembers(id);
		});
	});

	function onscroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		if (pagedSpaceId && !membersFailed(pagedSpaceId) && el.scrollHeight - el.scrollTop - el.clientHeight < 150)
			void loadMoreMembers(pagedSpaceId);
	}

	// Kept open (#366): the pin of its kind of chat, saved in the layout prefs, opens it in every chat of that kind while
	// the chat shows. Kept open, it's a panel beside the chat, not a dialog over it: it takes no focus, traps none, and
	// stays through clicks and Esc elsewhere, so the message box keeps the keyboard. Its button, or Esc in it, closes it
	// and unpins it, as the pin would only open it again in the next chat.
	const kept = $derived(kind !== undefined && layoutPrefs.membersKeptOpen[kind]);
	// None of these is shown, so none is state. byPin: the pin opened it, so taking the pin away closes it again.
	// closedForChat: it closed for its chat or the pin, not for anything the user did. wasKept: it has been kept open
	// since it opened.
	let byPin = false;
	let closedForChat = false;
	let wasKept = false;
	$effect(() => {
		const keep = kept;
		const visible = shown;
		untrack(() => {
			const next = followPin({ open, byPin }, keep, visible);
			if (next.open !== open) closedForChat = !next.open;
			if (next.open && keep) wasKept = true;
			byPin = next.byPin;
			open = next.open;
		});
	});

	function setKept(keep: boolean) {
		if (!kind) return;
		// Unpinned here, it stays open here as one the user opened does; the pin closes what it opened elsewhere.
		byPin = false;
		layoutPrefs.membersKeptOpen[kind] = keep;
	}

	// Opened or closed by the user: its button, a click outside, Esc.
	function onOpenChange(next: boolean) {
		closedForChat = false;
		if (!next && kept) setKept(false);
	}

	let opener = $state<HTMLElement | null>(null);
	let panel = $state<HTMLElement | null>(null);
	let rows = $state<HTMLElement | null>(null);

	// Kept open, it takes no focus. Opened by its button, it gives the focus to its first member, as it did before it had
	// a pin (whose tooltip would otherwise show at each opening). bits-ui mounts the panel's focus scope again as the pin
	// comes or goes, which leaves the focus where it is.
	function onOpenAutoFocus(e: Event) {
		e.preventDefault();
		if (kept || panel?.contains(document.activeElement)) return;
		requestAnimationFrame(() => {
			(rows?.querySelector("button") ?? panel?.querySelector<HTMLElement>("[data-popover-content]"))?.focus();
		});
	}

	// Closed for its chat or by the pin, it leaves the focus where it is (the message box), as it does while bits-ui mounts
	// the focus scope again. Closed by the user once it was kept open, it gives the focus to its button, where bits-ui
	// would give it back to what had it as the pin came: the pin itself, gone with the panel. Otherwise it goes back as
	// it always did.
	function onCloseAutoFocus(e: Event) {
		if (open || closedForChat) e.preventDefault();
		else if (wasKept) {
			e.preventDefault();
			opener?.focus();
		}
		if (open) return;
		closedForChat = false;
		wasKept = false;
	}

	// Kept open, Esc closes it only from inside it: elsewhere it's the message box's, or another panel's.
	function onEscapeKeydown(e: KeyboardEvent) {
		if (kept && !panel?.contains(document.activeElement)) e.preventDefault();
	}

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<Popover.Root bind:open {onOpenChange}>
	<Popover.Trigger
		bind:ref={opener}
		class="hover:bg-duvet-hover text-duvet-ink2 flex h-[30px] shrink-0 items-center gap-1.5 rounded-[9px] pr-[9px] pl-[7px] text-[12.5px] font-medium transition-colors duration-[120ms] motion-reduce:transition-none {open
			? 'bg-duvet-accent-tint'
			: ''}"
		aria-label={membersLabel(online)}
		title="Members"
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
		{#if layer}
			<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
			<div class="fixed top-0 left-0" style={layerStyle(layer)} bind:this={panel}>
				<Popover.Content
					side="bottom"
					align="end"
					sideOffset={8}
					collisionPadding={10}
					updatePositionStrategy="always"
					role={kept ? "complementary" : "dialog"}
					aria-label={title}
					trapFocus={!kept}
					interactOutsideBehavior={kept ? "defer-otherwise-ignore" : "close"}
					escapeKeydownBehavior={kept ? "defer-otherwise-close" : "close"}
					{onEscapeKeydown}
					{onOpenAutoFocus}
					{onCloseAutoFocus}
					class="{GLASS} animate-float-in text-duvet-ink z-[1000] flex {kept
						? 'max-h-[min(560px,calc(100vh-13rem))]'
						: 'max-h-[min(560px,72vh)]'} w-[min(340px,calc(100vw-20px))] origin-(--bits-floating-transform-origin) flex-col overflow-hidden rounded-[20px] outline-none"
				>
					<div class="flex shrink-0 items-baseline gap-2 px-4 pt-3.5 pb-1">
						<p class="min-w-0 truncate text-[13.5px] font-semibold">{title}</p>
						<span class="text-duvet-ink2 shrink-0 text-xs">{online} online</span>
						{#if kind}
							<Tooltip
								text={kept ? "Stop keeping open" : `Keep open in every ${kind === "rooms" ? "text room" : "group"}`}
							>
								{#snippet trigger(props)}
									<IconButton
										{...props}
										size="sm"
										label="Keep open"
										aria-pressed={kept}
										active={kept}
										class="-my-1.5 -mr-2 ml-auto self-center"
										onclick={() => setKept(!kept)}
									>
										<Pin size={14} />
									</IconButton>
								{/snippet}
							</Tooltip>
						{/if}
					</div>
					<div class="min-h-0 flex-1 overflow-y-auto pb-2" {onscroll} bind:this={rows}>
						<MemberList {members} spaceId={pagedSpaceId} {space} {channelId} {onRemoveMember} />
						<MemberPagesStatus spaceId={pagedSpaceId} />
					</div>
				</Popover.Content>
			</div>
		{/if}
	</Popover.Portal>
</Popover.Root>
