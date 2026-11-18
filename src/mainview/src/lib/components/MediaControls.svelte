<script lang="ts">
	import {
		AudioLines,
		HeadphoneOff,
		Headphones,
		Mic,
		MicOff,
		PhoneCall,
		PhoneOff,
		PictureInPicture2,
		SignalHigh,
	} from "@lucide/svelte";
	import { get } from "svelte/store";
	import MediaButton from "$lib/components/MediaButton.svelte";
	import MediaPanel from "$lib/components/MediaPanel.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
	import { mediaPopOut, popOutMedia, putBackMedia, showMediaWindow } from "$lib/media-popout.svelte";
	import { currentShell } from "$lib/platform";
	import { voiceKeyLabels } from "$lib/voice-keys";
	import { isLive, leaveLabel, openPlaceLabel, pingLabel, placeTip } from "$lib/media-state";
	import { canSpeakInVoice, liveMedia, liveMediaActions } from "$lib/media-source";
	import { isMuted } from "$lib/stores.svelte";
	import { sendVoiceSync } from "$lib/voice";

	// The media controls at the foot of the sidebar, above the profile row (#357, BRIEF.md "Media controls"): out of
	// voice one row (the microphone with its picker, deafen, noise suppression); in a voice room or a call, the call
	// panel (where the user is, the ping on hover, the camera, the screen share and Disconnect). MediaPanel draws them
	// from the stores' state (lib/media-source.ts). In a folded column (`collapsed`) they stack, and the microphone has
	// no picker; the voice the user is in is then one button, which opens it and says where it is and how its
	// connection is (the Now section's voice dock said it there until the call panel took the dock's place). It was
	// part of UserStatusBar until the redesign.
	//
	// In the desktop app the block can pop out into a window of its own (lib/media-popout.svelte.ts); while it is out,
	// a slim row stands here in its place. The web has neither: `mediaPopOut.available` is the desktop app's alone.
	let { collapsed = false }: { collapsed?: boolean } = $props();

	const media = $derived($liveMedia);
	const actions = liveMediaActions;
	// The mute and deafen shortcuts show where they work: the desktop app.
	const keys = $derived(mediaPopOut.available ? voiceKeyLabels(currentShell().os === "mac") : {});

	// Losing Speak in the voice room mutes at once. The gateway is told too: when SpeakInVoice comes back it keeps
	// showing this client muted, which it stays until the user unmutes.
	$effect(() => {
		if (!$canSpeakInVoice && !get(isMuted)) {
			isMuted.set(true);
			sendVoiceSync();
		}
	});
</script>

{#if collapsed}
	<div class="flex flex-col items-center gap-1" role="group" aria-label="Voice controls">
		{#if media.place}
			<MediaButton
				label={openPlaceLabel(media)}
				tip={placeTip(media)}
				shape="square"
				side="right"
				onclick={actions.openPlace}
			>
				<span class={isLive(media) ? "text-duvet-alive" : "text-duvet-ink2"} data-place={media.phase}>
					{#if media.place.kind === "call"}<PhoneCall size={15} />{:else}<SignalHigh size={15} />{/if}
				</span>
			</MediaButton>
			<MediaButton
				label={leaveLabel(media)}
				tip="{leaveLabel(media)} · {pingLabel(media)}"
				tone="leave"
				shape="square"
				side="right"
				onclick={actions.disconnect}
			>
				<PhoneOff size={15} />
			</MediaButton>
		{/if}
		<MediaButton
			label={media.muted ? "Unmute" : "Mute"}
			tip={media.canSpeak ? (media.muted ? "Unmute" : "Mute") : "You can't speak in this room"}
			pressed={media.muted}
			stateInName
			disabled={!media.canSpeak}
			shape="square"
			side="right"
			onclick={actions.toggleMute}
		>
			{#if media.muted}<MicOff size={16} />{:else}<Mic size={16} />{/if}
		</MediaButton>
		<MediaButton
			label={media.deafened ? "Undeafen" : "Deafen"}
			pressed={media.deafened}
			stateInName
			shape="square"
			side="right"
			onclick={actions.toggleDeafen}
		>
			{#if media.deafened}<HeadphoneOff size={16} />{:else}<Headphones size={16} />{/if}
		</MediaButton>
		<MediaButton
			label="Noise suppression"
			tip={media.noiseSuppression ? "Noise suppression on" : "Noise suppression off"}
			pressed={media.noiseSuppression}
			shape="square"
			side="right"
			onclick={actions.toggleNoiseSuppression}
		>
			<AudioLines size={16} />
		</MediaButton>
	</div>
{:else if mediaPopOut.available && mediaPopOut.out}
	<!-- The controls are in their own window: a press here brings it forward, and Put back docks them again. -->
	<div class="bg-duvet-sb-card flex min-h-[38px] items-center gap-1 rounded-xl py-1 pr-1 pl-1">
		<button
			type="button"
			class="text-duvet-ink2 hover:text-duvet-ink flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-1.5 text-left text-xs transition-colors motion-reduce:transition-none"
			aria-label="Show the voice controls"
			onclick={showMediaWindow}
		>
			<PictureInPicture2 class="shrink-0" size={15} />
			<span class="leading-[1.25]">Voice controls are in their own window</span>
		</button>
		<Button
			variant="secondary"
			size="sm"
			aria-label="Put the voice controls back in the sidebar"
			onclick={putBackMedia}
		>
			Put back
		</Button>
	</div>
{:else}
	<MediaPanel state={media} {actions} {keys} popOut={mediaPopOut.available ? popOut : undefined} />
{/if}

{#snippet popOut()}
	<Tooltip text="Pop out" side="top">
		{#snippet trigger(props)}
			<IconButton {...props} label="Pop out the voice controls" onclick={popOutMedia}>
				<PictureInPicture2 size={16} />
			</IconButton>
		{/snippet}
	</Tooltip>
{/snippet}
