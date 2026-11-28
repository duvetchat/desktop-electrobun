<script lang="ts">
	import { onMount } from "svelte";
	import { ChevronDown, HeadphoneOff, Headphones, Mic, MicOff, Settings as GearSixIcon } from "@lucide/svelte";
	import { mergeProps } from "bits-ui";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import Menu from "$lib/components/ui/Menu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import Popover from "$lib/components/ui/Popover.svelte";
	import Slider from "$lib/components/settings/Slider.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
	import MediaButton from "$lib/components/MediaButton.svelte";
	import UserSettings from "$lib/components/UserSettings.svelte";
	import { isMicInUse, micName, type MicChoice } from "$lib/media-state";
	import { liveMedia, liveMediaActions } from "$lib/media-source";
	import { voiceOutputVolume } from "$lib/stores.svelte";
	import { iconButtonClass } from "$lib/components/ui/recipes";
	import { SETTINGS_MENU_COMMAND } from "$lib/app-menu";
	import { getElectrobunRpc } from "$lib/electrobun-rpc";
	import { t } from "$lib/i18n";
	import { formatNumber } from "$lib/i18n/format";
	import { currentShell } from "$lib/platform";
	import { isSettingsShortcut } from "$lib/shell-layout";
	import { addWindowCommands, answerWindowCommand } from "$lib/window-commands";

	// The user's own controls, at the end of the profile row (#357, S-07): the microphone, split so a press mutes and
	// the chevron picks the device; deafen, split so its chevron sets the output volume; and Settings. Folded
	// (`collapsed`), the narrow edge has room for Settings alone, its media controls (with the microphone) standing
	// above it.
	let { collapsed = false }: { collapsed?: boolean } = $props();

	const media = $derived($liveMedia);
	const actions = liveMediaActions;

	let mics = $state<MicChoice[]>([]);
	// Before the list first loads, the picker says nothing rather than "No microphones found".
	let micsLoaded = $state(false);

	async function loadMics(open: boolean) {
		if (!open) return;
		mics = await actions.listMics();
		micsLoaded = true;
	}

	const micLabel = $derived(media.muted ? t("shell_unmute") : t("shell_mute"));
	const micTip = $derived(media.canSpeak ? micLabel : t("shell_cant_speak"));

	let showUserSettings = $state(false);

	// Settings' own shortcut: ⌘, on macOS, Ctrl , elsewhere. Not over another dialog.
	const mac = currentShell().os === "mac";
	/** Opens Settings, unless another dialog is up; whether they're open. */
	function openSettings(): boolean {
		if (!showUserSettings && document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
		showUserSettings = true;
		return true;
	}
	function onKeydown(event: KeyboardEvent) {
		if (!isSettingsShortcut(event, mac) || showUserSettings || !openSettings()) return;
		event.preventDefault();
	}
	// And the menu bar's Settings… on macOS (src/bun/app-menu.ts), whose ⌘, the page sees first: Bun sends it to the main
	// window's page as a command (lib/window-commands.ts), which this bar answers while it is mounted, as one is at a time.
	onMount(() => {
		const stop = addWindowCommands(SETTINGS_MENU_COMMAND.channel, { [SETTINGS_MENU_COMMAND.name]: openSettings });
		getElectrobunRpc()
			.then((rpc) => rpc?.on.windowCommand(answerWindowCommand))
			.catch((err: unknown) => console.error("[settings] The menu bar's Settings… won't reach this page:", err));
		return stop;
	});
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

<svelte:window onkeydown={onKeydown} />

{#if collapsed}
	<button class={iconButtonClass()} aria-label={t("shell_settings")} title={t("shell_settings")} onclick={openSettings}>
		<GearSixIcon class="size-4" />
	</button>
{:else}
	<div class="flex shrink-0 items-center gap-0.5">
		<!-- The microphone: a press mutes; a right-click, or the chevron beside it, picks the device. -->
		<div class="rounded-tile flex h-7 w-10 min-w-0 gap-px overflow-hidden">
			<ContextMenu label={t("call_microphone")} onOpenChange={loadMics}>
				{#snippet target(props)}
					<MediaButton
						label={micLabel}
						tip={micTip}
						pressed={media.muted}
						pressedTone="danger"
						stateInName
						disabled={!media.canSpeak}
						triggerProps={props}
						tone="quiet"
						shape="panel"
						class="h-7! flex-1 rounded-none!"
						onclick={actions.toggleMute}
					>
						{#if media.muted}<MicOff size={15} />{:else}<Mic size={15} />{/if}
					</MediaButton>
				{/snippet}
				{@render micList()}
			</ContextMenu>
			<Menu side="top" align="end" label={t("call_microphone")} onOpenChange={loadMics}>
				{#snippet trigger(menuProps)}
					<Tooltip text={t("call_choose_microphone")} side="top">
						{#snippet trigger(props)}
							<button
								{...mergeProps(menuProps, props)}
								type="button"
								aria-label={t("call_choose_microphone")}
								class="text-duvet-ink2 hover:text-duvet-ink hover:bg-duvet-sb-hover flex h-7 w-4 shrink-0 items-center justify-center transition-colors duration-[120ms] motion-reduce:transition-none"
							>
								<ChevronDown size={11} strokeWidth={2.5} />
							</button>
						{/snippet}
					</Tooltip>
				{/snippet}
				{@render micList()}
			</Menu>
		</div>

		<!-- Deafen: a press silences everyone; the chevron sets how loud they play. -->
		<div class="rounded-tile flex h-7 w-10 min-w-0 gap-px overflow-hidden">
			<MediaButton
				label={media.deafened ? t("shell_undeafen") : t("shell_deafen")}
				tip={media.deafened ? t("shell_undeafen") : t("shell_deafen")}
				pressed={media.deafened}
				pressedTone="danger"
				stateInName
				tone="quiet"
				shape="panel"
				class="h-7! flex-1 rounded-none!"
				onclick={actions.toggleDeafen}
			>
				{#if media.deafened}<HeadphoneOff size={15} />{:else}<Headphones size={15} />{/if}
			</MediaButton>
			<Popover side="top" align="end" label={t("shell_audio_output")} class="rounded-panel">
				{#snippet trigger(popoverProps)}
					<Tooltip text={t("shell_audio_output")} side="top">
						{#snippet trigger(props)}
							<button
								{...mergeProps(popoverProps, props)}
								type="button"
								aria-label={t("shell_audio_output")}
								class="text-duvet-ink2 hover:text-duvet-ink hover:bg-duvet-sb-hover flex h-7 w-4 shrink-0 items-center justify-center transition-colors duration-[120ms] motion-reduce:transition-none"
							>
								<ChevronDown size={11} strokeWidth={2.5} />
							</button>
						{/snippet}
					</Tooltip>
				{/snippet}
				<div class="flex w-56 flex-col gap-2 p-3">
					<div class="flex items-center justify-between gap-2">
						<span class="text-duvet-ink2 text-[11px] font-semibold tracking-[0.06em] uppercase"
							>{t("shell_output_volume")}</span
						>
						<span class="text-duvet-ink2 text-[11px] tabular-nums"
							>{formatNumber(Math.round($voiceOutputVolume * 100) / 100, { style: "percent" })}</span
						>
					</div>
					<Slider
						value={Math.round($voiceOutputVolume * 100)}
						label={t("shell_output_volume")}
						oninput={(v) => voiceOutputVolume.set(v / 100)}
						class="w-full!"
					/>
				</div>
			</Popover>
		</div>

		<MediaButton
			label={t("shell_settings")}
			tip={t("shell_settings")}
			tone="quiet"
			shape="panel"
			class="rounded-tile! size-7!"
			onclick={openSettings}
		>
			<GearSixIcon size={15} />
		</MediaButton>
	</div>
{/if}

<UserSettings bind:open={showUserSettings} />
