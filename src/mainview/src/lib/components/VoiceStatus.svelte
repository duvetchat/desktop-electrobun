<script lang="ts">
	import type { Snippet } from "svelte";
	import { PhoneCall, PhoneOff, SignalHigh, SignalLow, SignalMedium } from "@lucide/svelte";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import MediaButton from "$lib/components/MediaButton.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
	import {
		isLive,
		leaveLabel,
		mediaTitle,
		pingLabel,
		pingLevel,
		type MediaActions,
		type MediaState,
	} from "$lib/media-state";

	// The voice the user is in, as the call panel's first row (MediaPanel.svelte): the signal's mark, whose tooltip is
	// the ping; where they're connected, which opens that voice room or call; who is there; and Disconnect. It draws the
	// state it's given, the stores' in the main window and the mirrored one in the pop-out. It was UserStatusBar's voice
	// pill and the Now section's voice dock until the redesign (#357).
	let {
		state: media,
		actions,
		trailing = undefined,
	}: {
		state: MediaState;
		actions: MediaActions;
		/** What sits before Disconnect: the pop-out's button in the sidebar. */
		trailing?: Snippet;
	} = $props();

	const inCall = $derived(media.place?.kind === "call");
	const level = $derived(inCall ? "fine" : pingLevel(media.ping));
	// The mark's colours: live under 100 ms, the warning colour under 250 ms, the destructive one beyond.
	const TILE = {
		fine: "bg-duvet-alive/14 text-duvet-alive",
		slow: "bg-duvet-warn/15 text-duvet-warn",
		poor: "bg-duvet-danger/15 text-duvet-danger",
	};
	const leave = $derived(leaveLabel(media));
</script>

<div class="flex items-center gap-2">
	<Tooltip text={pingLabel(media)} side="top">
		{#snippet trigger(props)}
			<span
				{...props}
				class="grid size-[30px] shrink-0 place-items-center rounded-[10px] {isLive(media)
					? TILE[level]
					: 'bg-duvet-secondary-fill text-duvet-ink2'}"
			>
				{#if inCall}
					<PhoneCall size={16} />
				{:else if level === "poor"}
					<SignalLow size={16} />
				{:else if level === "slow"}
					<SignalMedium size={16} />
				{:else}
					<SignalHigh size={16} />
				{/if}
			</span>
		{/snippet}
	</Tooltip>
	<button
		type="button"
		class="group flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
		aria-label="Open {media.place?.where ?? ''}{media.facesLabel ? `, ${media.facesLabel}` : ''}"
		onclick={actions.openPlace}
	>
		<span class="flex min-w-0 flex-1 flex-col gap-px">
			<span
				class="truncate text-[12.5px] leading-[1.25] font-semibold {isLive(media)
					? 'text-duvet-alive'
					: 'text-duvet-ink2'}"
				role="status">{mediaTitle(media)}</span
			>
			<span
				class="text-duvet-ink2 group-hover:text-duvet-ink truncate text-[11.5px] leading-[1.25] group-hover:underline"
				>{media.place?.where ?? ""}</span
			>
		</span>
		{#if media.faces.length > 0}
			<span class="hidden shrink-0 @[13rem]:flex">
				<FaceStack faces={media.faces} more={media.more} size={18} ring="ring-duvet-sb-ring" />
			</span>
		{/if}
	</button>
	{@render trailing?.()}
	<MediaButton label={leave} tone="leave" shape="square" onclick={actions.disconnect}>
		<PhoneOff size={15} />
	</MediaButton>
</div>
