<script lang="ts">
	import type { Snippet } from "svelte";
	import {
		AudioLines,
		ChevronDown,
		HeadphoneOff,
		Headphones,
		Mic,
		MicOff,
		ScreenShare,
		ScreenShareOff,
		Video,
		VideoOff,
		Volume2,
	} from "@lucide/svelte";
	import { mergeProps } from "bits-ui";
	import MediaButton from "$lib/components/MediaButton.svelte";
	import VoiceStatus from "$lib/components/VoiceStatus.svelte";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import Menu from "$lib/components/ui/Menu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
	import {
		isMicInUse,
		micName,
		videoBlockLabel,
		type MediaActions,
		type MediaState,
		type MicChoice,
	} from "$lib/media-state";

	// The media controls' block (#357, BRIEF.md "Media controls"), drawn from a state and acting through actions, so the
	// sidebar (MediaControls.svelte, on the stores) and the pop-out window (mirrored) show the same thing:
	//   - out of voice, one row: the microphone with its picker, deafen, noise suppression;
	//   - in a voice room or a call, the call panel: where the user is, with the ping on hover and Disconnect, over the
	//     same controls with the camera and the screen share.
	let {
		state: media,
		actions,
		keys = {},
		popOut = undefined,
		framed = true,
	}: {
		state: MediaState;
		actions: MediaActions;
		/** The shortcuts to show, written for this system, where they work. */
		keys?: { mute?: string; deafen?: string };
		/** The pop-out's button, in the sidebar of the desktop app only. */
		popOut?: Snippet;
		/** The call panel as a card of its own, in the sidebar; off in the pop-out, whose window is the card. */
		framed?: boolean;
	} = $props();

	let mics = $state<MicChoice[]>([]);
	// Before the list first loads, the picker says nothing rather than "No microphones found".
	let micsLoaded = $state(false);

	async function loadMics(open: boolean) {
		if (!open) return;
		mics = await actions.listMics();
		micsLoaded = true;
	}

	const micLabel = $derived(media.muted ? "Unmute" : "Mute");
	const micTip = $derived(media.canSpeak ? micLabel : "You can't speak in this room");
	const blocked = $derived(videoBlockLabel(media.video, media.place?.kind));
	const inVoice = $derived(media.place !== null);
</script>

{#snippet micList()}
	<div class="text-duvet-ink2 px-2 pt-1 pb-1.5 text-[11.5px] leading-none font-semibold">Microphone</div>
	{#if mics.length === 0}
		{#if micsLoaded}
			<div class="text-duvet-ink2 px-2 py-1.5 text-[13px]">No microphones found</div>
		{/if}
	{:else}
		{#each mics as mic, index (mic.id || index)}
			<MenuItem checked={isMicInUse(mic, media.micId)} onSelect={() => actions.selectMic(mic.id)}>
				{micName(mic, index)}
			</MenuItem>
		{/each}
	{/if}
{/snippet}

<!-- The microphone: a press mutes; a right-click, or the chevron beside it, opens the picker. -->
{#snippet mic()}
	<div class="flex min-w-0 gap-px">
		<ContextMenu label="Microphone" onOpenChange={loadMics}>
			{#snippet target(props)}
				<MediaButton
					label={micLabel}
					tip={micTip}
					keys={media.canSpeak ? keys.mute : undefined}
					pressed={media.muted}
					disabled={!media.canSpeak}
					triggerProps={props}
					class="rounded-r-[3px]"
					onclick={actions.toggleMute}
				>
					{#if media.muted}<MicOff size={16} />{:else}<Mic size={16} />{/if}
				</MediaButton>
			{/snippet}
			{@render micList()}
		</ContextMenu>
		<Menu side="top" align="start" label="Microphone" onOpenChange={loadMics}>
			{#snippet trigger(menuProps)}
				<Tooltip text="Choose a microphone" side="top">
					{#snippet trigger(props)}
						<button
							{...mergeProps(menuProps, props)}
							type="button"
							aria-label="Choose a microphone"
							class="bg-duvet-secondary-fill text-duvet-ink focus-visible:outline-duvet-accent grid h-[30px] w-[18px] shrink-0 place-items-center rounded-l-[3px] rounded-r-[10px] transition-[box-shadow,color] duration-[120ms] outline-none hover:shadow-[inset_0_0_0_100px_var(--duvet-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
						>
							<ChevronDown size={12} strokeWidth={2.5} />
						</button>
					{/snippet}
				</Tooltip>
			{/snippet}
			{@render micList()}
		</Menu>
	</div>
{/snippet}

{#snippet deafen()}
	<MediaButton
		label={media.deafened ? "Undeafen" : "Deafen"}
		keys={keys.deafen}
		pressed={media.deafened}
		onclick={actions.toggleDeafen}
	>
		{#if media.deafened}<HeadphoneOff size={16} />{:else}<Headphones size={16} />{/if}
	</MediaButton>
{/snippet}

{#snippet noise()}
	<MediaButton
		label="Noise suppression"
		tip={media.noiseSuppression ? "Noise suppression on" : "Noise suppression off"}
		pressed={media.noiseSuppression}
		onclick={actions.toggleNoiseSuppression}
	>
		<AudioLines size={16} />
	</MediaButton>
{/snippet}

{#if inVoice}
	<section
		aria-label={media.place?.kind === "call" ? "Your call" : "Your voice"}
		class="@container flex flex-col gap-2 {framed ? 'bg-duvet-sb-card shadow-duvet-raised rounded-[14px] p-2' : ''}"
	>
		<VoiceStatus state={media} {actions} trailing={popOut} />
		<div class="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-1.5">
			{@render mic()}
			{@render deafen()}
			{@render noise()}
			<MediaButton
				label={media.camera ? "Turn off camera" : "Turn on camera"}
				tip={blocked ?? (media.camera ? "Turn off camera" : "Turn on camera")}
				pressed={media.camera}
				disabled={blocked !== null}
				onclick={actions.toggleCamera}
			>
				{#if media.camera}<Video size={16} />{:else}<VideoOff size={16} />{/if}
			</MediaButton>
			{#if media.sharing}
				<MediaButton label="Stop sharing" pressed onclick={actions.stopSharing}>
					<ScreenShareOff size={16} />
				</MediaButton>
			{:else}
				<!-- The system's (or the browser's) own picker follows: Duvet draws none. -->
				<Menu side="top" align="end" label="Share screen">
					{#snippet trigger(props)}
						<MediaButton
							label="Share screen"
							tip={blocked ?? "Share screen"}
							pressed={false}
							disabled={blocked !== null}
							triggerProps={props}
						>
							<ScreenShare size={16} />
						</MediaButton>
					{/snippet}
					<MenuItem icon={ScreenShare} onSelect={() => actions.shareScreen(false)}>Screen only</MenuItem>
					<MenuItem icon={Volume2} onSelect={() => actions.shareScreen(true)}>Screen and audio</MenuItem>
				</Menu>
			{/if}
		</div>
	</section>
{:else}
	<div role="group" aria-label="Voice controls" class="flex items-center gap-1.5">
		<div class="grid min-w-0 flex-1 grid-cols-[1.5fr_1fr_1fr] gap-1.5">
			{@render mic()}
			{@render deafen()}
			{@render noise()}
		</div>
		{@render popOut?.()}
	</div>
{/if}
