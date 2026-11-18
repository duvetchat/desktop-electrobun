<script lang="ts">
	import { AudioLines, HeadphoneOff, Headphones, Mic, MicOff, PhoneOff } from "@lucide/svelte";
	import { get } from "svelte/store";
	import MediaButton from "$lib/components/MediaButton.svelte";
	import MediaPanel from "$lib/components/MediaPanel.svelte";
	import { leaveLabel, pingLabel } from "$lib/media-state";
	import { canSpeakInVoice, liveMedia, liveMediaActions } from "$lib/media-source";
	import { isMuted } from "$lib/stores.svelte";
	import { sendVoiceSync } from "$lib/voice";

	// The media controls at the foot of the sidebar, above the profile row (#357, BRIEF.md "Media controls"): out of
	// voice one row (the microphone with its picker, deafen, noise suppression); in a voice room or a call, the call
	// panel (where the user is, the ping on hover, the camera, the screen share and Disconnect). MediaPanel draws them
	// from the stores' state (lib/media-source.ts). In a folded column (`collapsed`) they stack, and the microphone has
	// no picker. It was part of UserStatusBar until the redesign.
	let { collapsed = false }: { collapsed?: boolean } = $props();

	const media = $derived($liveMedia);
	const actions = liveMediaActions;

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
{:else}
	<MediaPanel state={media} {actions} />
{/if}
