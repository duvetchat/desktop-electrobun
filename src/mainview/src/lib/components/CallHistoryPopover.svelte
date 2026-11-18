<script lang="ts">
	import type { Snippet } from "svelte";
	import CallHistory from "$lib/components/CallHistory.svelte";
	import Popover from "$lib/components/ui/Popover.svelte";
	import { jumpToMessageRequest } from "$lib/stores.svelte";
	import type { MessageLink } from "$lib/urls";

	// The call history, as a popover from the sidebar's header (#357, BRIEF.md "Calls"): the user's calls, the newest
	// first, each with its Call or Join. What opens it is the caller's `trigger` snippet (the shell's Calls button),
	// which spreads the props it gets on its element. A call's row opens its chat at that call and closes the popover.
	let {
		open = $bindable(false),
		onOpen = undefined,
		side = "bottom",
		align = "start",
		trigger,
	}: {
		open?: boolean;
		/** Opens a call's notice in its chat; without one, the app's jump to a message does. */
		onOpen?: (link: MessageLink) => void;
		side?: "top" | "bottom" | "left" | "right";
		align?: "start" | "center" | "end";
		trigger: Snippet<[Record<string, unknown>]>;
	} = $props();

	// A row closes the popover as it opens its chat.
	function openCall(link: MessageLink) {
		open = false;
		if (onOpen) onOpen(link);
		else jumpToMessageRequest.set({ id: crypto.randomUUID(), ...link });
	}
</script>

<Popover
	bind:open
	{side}
	{align}
	label="Call history"
	class="flex max-h-[min(560px,72vh)] w-[360px] flex-col rounded-[20px]"
	{trigger}
>
	<div class="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-2.5">
		<h2 class="text-duvet-ink font-serif text-[19px] leading-[1.2] font-medium">Call history</h2>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
		<CallHistory onOpen={openCall} />
	</div>
</Popover>
