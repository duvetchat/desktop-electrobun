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
	import { t } from "$lib/i18n";
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

	const micLabel = $derived(media.muted ? t("call_unmute") : t("call_mute"));
	const micTip = $derived(media.canSpeak ? micLabel : t("call_cannot_speak"));
	const blocked = $derived(videoBlockLabel(media.video, media.place?.kind));
	const inVoice = $derived(media.place !== null);
</script>

{#snippet micList()}
	<div class="text-duvet-ink2 px-2 pt-1 pb-1.5 text-[11.5px] leading-none font-semibold">{t("call_microphone")}</div>
	{#if mics.length === 0}
		{#if micsLoaded}
			<div class="text-duvet-ink2 px-2 py-1.5 text-[13px]">{t("call_no_microphones")}</div>
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
		<ContextMenu label={t("call_microphone")} onOpenChange={loadMics}>
			{#snippet target(props)}
				<MediaButton
					label={micLabel}
					tip={micTip}
					keys={media.canSpeak ? keys.mute : undefined}
					pressed={media.muted}
					pressedTone="danger"
					stateInName
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
		<Menu side="top" align="start" label={t("call_microphone")} onOpenChange={loadMics}>
			{#snippet trigger(menuProps)}
				<Tooltip text={t("call_choose_microphone")} side="top">
					{#snippet trigger(props)}
						<button
							{...mergeProps(menuProps, props)}
							type="button"
							aria-label={t("call_choose_microphone")}
							class="bg-duvet-secondary-fill text-duvet-ink grid h-[30px] w-[18px] shrink-0 place-items-center rounded-l-[3px] rounded-r-[10px] transition-[box-shadow,color] duration-[120ms] hover:shadow-[inset_0_0_0_100px_var(--duvet-hover)] motion-reduce:transition-none"
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
		label={media.deafened ? t("call_undeafen") : t("call_deafen")}
		keys={keys.deafen}
		pressed={media.deafened}
		pressedTone="danger"
		stateInName
		onclick={actions.toggleDeafen}
	>
		{#if media.deafened}<HeadphoneOff size={16} />{:else}<Headphones size={16} />{/if}
	</MediaButton>
{/snippet}

{#snippet noise()}
	<MediaButton
		label={t("call_noise_suppression")}
		tip={media.noiseSuppression ? t("call_noise_suppression_on") : t("call_noise_suppression_off")}
		pressed={media.noiseSuppression}
		onclick={actions.toggleNoiseSuppression}
	>
		<AudioLines size={16} />
	</MediaButton>
{/snippet}

{#if inVoice}
	<section
		aria-label={media.place?.kind === "call" ? t("call_panel_call_label") : t("call_panel_voice_label")}
		class="@container flex flex-col gap-2 {framed ? 'bg-duvet-sb-card shadow-duvet-raised rounded-[14px] p-2' : ''}"
	>
		<VoiceStatus state={media} {actions} trailing={popOut} />
		<div class="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-1.5">
			{@render mic()}
			{@render deafen()}
			{@render noise()}
			<MediaButton
				label={media.camera ? t("call_camera_turn_off") : t("call_camera_turn_on")}
				tip={blocked ?? (media.camera ? t("call_camera_turn_off") : t("call_camera_turn_on"))}
				pressed={media.camera}
				stateInName
				disabled={blocked !== null}
				onclick={actions.toggleCamera}
			>
				{#if media.camera}<Video size={16} />{:else}<VideoOff size={16} />{/if}
			</MediaButton>
			{#if media.sharing}
				<MediaButton label={t("call_stop_sharing")} pressed stateInName onclick={actions.stopSharing}>
					<ScreenShareOff size={16} />
				</MediaButton>
			{:else}
				<!-- The system's (or the browser's) own picker follows: Duvet draws none. -->
				<Menu side="top" align="end" label={t("call_share_screen")}>
					{#snippet trigger(props)}
						<MediaButton
							label={t("call_share_screen")}
							tip={blocked ?? t("call_share_screen")}
							pressed={false}
							stateInName
							disabled={blocked !== null}
							triggerProps={props}
						>
							<ScreenShare size={16} />
						</MediaButton>
					{/snippet}
					<MenuItem icon={ScreenShare} onSelect={() => actions.shareScreen(false)}
						>{t("call_share_screen_only")}</MenuItem
					>
					<MenuItem icon={Volume2} onSelect={() => actions.shareScreen(true)}
						>{t("call_share_screen_with_audio")}</MenuItem
					>
				</Menu>
			{/if}
		</div>
	</section>
{/if}
