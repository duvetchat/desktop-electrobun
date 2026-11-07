<script lang="ts">
	import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";
	import { clickedMention } from "$lib/markdown";
	import type { GatewaySpace, MemberOnSidebar } from "$lib/types";

	// The profile a click on an @mention opens, as a click on a message's author does, beside the mention's chip. What
	// shows the messages hands it each click in the capture phase (open), so that a quote or a search result around the
	// mention doesn't act on it too, and tells it who the messages' members are: a mention names one of them or nobody.
	let { members, space = null }: { members: MemberOnSidebar[]; space?: GatewaySpace | null } = $props();

	let opened = $state<{ chip: HTMLElement; userId: string } | null>(null);
	const openedId = $derived(opened?.userId);
	const member = $derived(members.find((m) => m.id === openedId));

	export function open(e: MouseEvent) {
		const clicked = clickedMention(e.target);
		if (!clicked) return;
		e.preventDefault();
		e.stopPropagation();
		// The chip of the profile that shows closes it, as a name does. Another one takes its place.
		opened = opened?.chip === clicked.chip ? null : clicked;
	}

	// A chip that's gone has nothing to open beside: its message edited or deleted, or the list showing others.
	$effect(() => {
		const chip = opened?.chip;
		if (!chip) return;
		const observer = new MutationObserver(() => {
			if (!chip.isConnected) opened = null;
		});
		observer.observe(document.body, { childList: true, subtree: true });
		return () => observer.disconnect();
	});
</script>

{#if opened && member}
	<MemberProfilePopover
		{member}
		{space}
		spaceId={space?.id ?? null}
		side="right"
		open
		anchor={opened.chip}
		onOpenChange={(isOpen) => {
			if (!isOpen) opened = null;
		}}
	/>
{/if}
