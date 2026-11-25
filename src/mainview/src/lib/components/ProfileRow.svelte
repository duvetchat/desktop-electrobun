<script lang="ts">
	import { ChevronsUpDown as ChevronsUpDownIcon } from "@lucide/svelte";
	import { speakingUsers, currentUser } from "$lib/stores.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import ProfileControls from "$lib/components/ProfileControls.svelte";
	import StatusMenu from "$lib/components/StatusMenu.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import MediaControls from "$lib/components/MediaControls.svelte";
	import Avatar from "$lib/components/ui/Avatar.svelte";
	import { ownMobileOnly } from "$lib/api/ws/connection";
	import { SETTINGS_MENU_COMMAND } from "$lib/app-menu";
	import { getElectrobunRpc } from "$lib/electrobun-rpc";
	import { t } from "$lib/i18n";
	import { currentShell } from "$lib/platform";
	import { isSettingsShortcut } from "$lib/shell-layout";
	import { STATUS_CHOICES, chosenStatus } from "$lib/status";
	import { userStatusToString } from "$lib/types";

	// The profile row at the sidebar's foot (#357, S-07): who the user is (their avatar with its status, their name
	// and the status they chose), which opens the status menu, with the microphone, deafen and Settings at its end
	// (ProfileControls.svelte). Folded (`collapsed`), it is the edge's narrow column instead, which still stacks the
	// media controls (with the voice the user is in and its Leave) and Settings under the avatar: the edge has no room
	// for them elsewhere. It was UserStatusBar until the redesign split it.
	let { collapsed = false }: { collapsed?: boolean } = $props();

	// The status the user chose, which everyone sees while they're connected.
	const myChoice = $derived(chosenStatus($currentUser?.status));
	const myStatus = $derived(userStatusToString(myChoice));
	const myStatusLabel = $derived.by(() => {
		const label = STATUS_CHOICES.find((c) => c.status === myChoice)?.label;
		return label ? t(label) : "";
	});

	// Quick mute and deafen beside Settings, as the media controls above the row have them: the stores' state, so both
	// say the same thing (a deafen mutes too, lib/voice.ts).
	const media = $derived($liveMedia);
	const actions = liveMediaActions;
	const inVoice = $derived(media.place !== null);

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
	// window's page as a command (lib/window-commands.ts), which this row answers while it is mounted, as one is at a time.
	onMount(() => {
		const stop = addWindowCommands(SETTINGS_MENU_COMMAND.channel, { [SETTINGS_MENU_COMMAND.name]: openSettings });
		getElectrobunRpc()
			.then((rpc) => rpc?.on.windowCommand(answerWindowCommand))
			.catch((err: unknown) => console.error("[settings] The menu bar's Settings… won't reach this page:", err));
		return stop;
	});
</script>

{#if collapsed && $currentUser}
	<div class="border-duvet-sb-edge flex shrink-0 flex-col items-center gap-1 border-t px-1 py-2">
		<StatusMenu class="relative cursor-pointer rounded-full">
			<UserAvatar
				src={getAvatarURL($currentUser.id, $currentUser.avatar)}
				name={$currentUser.alias || $currentUser.username}
				size={28}
				class="box-border transition-all duration-200 motion-reduce:transition-none {$speakingUsers.has($currentUser.id)
					? 'ring-duvet-alive ring-2'
					: ''}"
			/>
			<StatusDot
				status={myStatus}
				mobileOnly={$ownMobileOnly}
				class="text-duvet-sb-ring absolute -right-0.5 -bottom-0.5 w-3 border-2"
			/>
		</StatusMenu>
		<MediaControls collapsed />
		<button
			class={iconButtonClass()}
			aria-label={t("shell_settings")}
			title={t("shell_settings")}
			onclick={() => (showUserSettings = true)}
		>
			<GearSixIcon class="size-4" />
		</button>
		<ProfileControls collapsed />
	</div>
{/if}

<!-- The profile row: the avatar, the name and the chosen status open the status menu; the user's controls sit at its
     end, in the same row. -->
{#if !collapsed && $currentUser}
	<div class="flex w-full min-w-0 shrink-0 items-center gap-0.5">
		<StatusMenu
			class="group hover:bg-duvet-sb-hover focus-visible:outline-duvet-accent flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition-colors duration-[120ms] focus-visible:outline-2 motion-reduce:transition-none"
		>
			<span
				class="shrink-0 rounded-full transition-shadow duration-200 motion-reduce:transition-none {$speakingUsers.has(
					$currentUser.id,
				)
					? 'ring-duvet-alive ring-2'
					: ''}"
			>
				<Avatar size={30} status={myStatus} mobileOnly={$ownMobileOnly} ring="var(--duvet-sb-ring)">
					<UserAvatar
						src={getAvatarURL($currentUser.id, $currentUser.avatar)}
						name={$currentUser.alias || $currentUser.username}
						size={30}
					/>
				</Avatar>
			</span>
			<span class="flex min-w-0 flex-1 flex-col">
				<span class="text-duvet-ink truncate text-[13.5px] leading-tight font-semibold"
					>{$currentUser.alias || $currentUser.username}</span
				>
				<span class="text-duvet-ink2 truncate text-[11.5px] leading-[1.3]">{myStatusLabel}</span>
			</span>
			<ChevronsUpDownIcon class="text-duvet-ink2 size-3.5 shrink-0" aria-hidden="true" />
		</StatusMenu>
		{#if !inVoice}
			<MediaButton
				label={media.muted ? t("shell_unmute") : t("shell_mute")}
				tip={media.canSpeak ? (media.muted ? t("shell_unmute") : t("shell_mute")) : t("shell_cant_speak")}
				pressed={media.muted}
				stateInName
				disabled={!media.canSpeak}
				shape="square"
				side="top"
				onclick={actions.toggleMute}
			>
				{#if media.muted}<MicOff size={16} />{:else}<Mic size={16} />{/if}
			</MediaButton>
			<MediaButton
				label={media.deafened ? t("shell_undeafen") : t("shell_deafen")}
				pressed={media.deafened}
				stateInName
				shape="square"
				side="top"
				onclick={actions.toggleDeafen}
			>
				{#if media.deafened}<HeadphoneOff size={16} />{:else}<Headphones size={16} />{/if}
			</MediaButton>
		{/if}
		<button
			class={iconButtonClass()}
			aria-label={t("shell_settings")}
			title={t("shell_settings")}
			onclick={() => (showUserSettings = true)}
		>
			<GearSixIcon class="size-4" />
		</button>
		<ProfileControls />
	</div>
{/if}
