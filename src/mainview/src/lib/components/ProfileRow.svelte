<script lang="ts">
	import { Settings as GearSixIcon } from "@lucide/svelte";
	import { speakingUsers, currentUser } from "$lib/stores.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import UserSettings from "$lib/components/UserSettings.svelte";
	import VoiceNoteBar from "$lib/components/VoiceNoteBar.svelte";
	import StatusMenu from "$lib/components/StatusMenu.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import MediaControls from "$lib/components/MediaControls.svelte";
	import VoiceStatus from "$lib/components/VoiceStatus.svelte";
	import { ownMobileOnly } from "$lib/api/ws/connection";
	import { STATUS_CHOICES, chosenStatus } from "$lib/status";
	import { userStatusToString } from "$lib/types";

	// The user's panel at the foot of the sidebar: who they are (their avatar with its status, which opens the status
	// menu, and their name with the status they chose) and the way into Settings, around the media controls
	// (MediaControls) and, over them, what plays (VoiceNoteBar) and the voice they're in (VoiceStatus). Folded
	// (`collapsed`), it is a narrow column. It was UserStatusBar until the redesign (#357), which splits the profile
	// row from the media controls: the row is the shell's, the controls and the voice status are calls and media's.
	let {
		collapsed = false,
		showVoice = true,
	}: {
		collapsed?: boolean;
		/** Off where the voice the user is in shows on its own, as the spaces column's Now section does. */
		showVoice?: boolean;
	} = $props();

	// The status the user chose, which everyone sees while they're connected.
	const myChoice = $derived(chosenStatus($currentUser?.status));
	const myStatus = $derived(userStatusToString(myChoice));
	const myStatusLabel = $derived(STATUS_CHOICES.find((c) => c.status === myChoice)?.label ?? "");

	let showUserSettings = $state(false);
</script>

{#if !collapsed}
	<VoiceNoteBar />
	<VoiceStatus {showVoice} />
{/if}

{#if collapsed && $currentUser}
	<div class="border-duvet-line bg-duvet-sunk flex shrink-0 flex-col items-center gap-1 border-t px-1 py-2">
		<VoiceStatus collapsed />
		<StatusMenu class="relative cursor-pointer rounded-full">
			<UserAvatar
				src={getAvatarURL($currentUser.id, $currentUser.avatar)}
				name={$currentUser.alias || $currentUser.username}
				size={28}
				class="box-border transition-all duration-200 {$speakingUsers.has($currentUser.id)
					? 'ring-duvet-ink2/40 ring-[3px]'
					: ''}"
			/>
			<StatusDot
				status={myStatus}
				mobileOnly={$ownMobileOnly}
				class="text-duvet-sunk absolute -right-0.5 -bottom-0.5 w-3 border-2"
			/>
		</StatusMenu>
		<MediaControls collapsed />
		<button
			class="text-duvet-ink2 hover:bg-duvet-card flex size-8 items-center justify-center rounded-lg transition-colors"
			aria-label="User Settings"
			onclick={() => (showUserSettings = true)}
		>
			<GearSixIcon class="size-4" />
		</button>
	</div>
{/if}

<!-- Current user profile bar -->
{#if !collapsed && $currentUser}
	<div class="bg-duvet-card z-100 flex h-14 shrink-0 items-center gap-1 px-1.5">
		<StatusMenu
			class="group hover:bg-duvet-card flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-full p-1 text-left transition-colors"
		>
			<div class="relative shrink-0">
				<UserAvatar
					src={getAvatarURL($currentUser.id, $currentUser.avatar)}
					name={$currentUser.alias || $currentUser.username}
					size={28}
					class="box-border transition-all duration-200 {$speakingUsers.has($currentUser.id)
						? 'ring-duvet-ink2/40 ring-4'
						: ''}"
				/>
				<StatusDot
					status={myStatus}
					mobileOnly={$ownMobileOnly}
					class="text-duvet-card absolute -right-0.5 -bottom-0.5 w-3 border-2"
				/>
			</div>
			<div class="flex flex-col truncate">
				<span class="text-duvet-ink truncate text-sm font-semibold">{$currentUser.alias || $currentUser.username}</span>
				<span class="text-xxs text-duvet-ink2 truncate">{myStatusLabel}</span>
			</div>
		</StatusMenu>

		<div class="text-duvet-ink2 relative flex shrink-0 items-center">
			<MediaControls />
			<button
				class="hover:bg-duvet-card flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
				aria-label="User Settings"
				onclick={() => (showUserSettings = true)}
			>
				<GearSixIcon class="size-5" />
			</button>
		</div>
	</div>
{/if}

<UserSettings bind:open={showUserSettings} />
