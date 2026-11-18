<script lang="ts">
	import { ChevronsUpDown as ChevronsUpDownIcon, Settings as GearSixIcon } from "@lucide/svelte";
	import { speakingUsers, currentUser } from "$lib/stores.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import UserSettings from "$lib/components/UserSettings.svelte";
	import StatusMenu from "$lib/components/StatusMenu.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import MediaControls from "$lib/components/MediaControls.svelte";
	import Avatar from "$lib/components/ui/Avatar.svelte";
	import { iconButtonClass } from "$lib/components/ui/recipes";
	import { ownMobileOnly } from "$lib/api/ws/connection";
	import { currentShell } from "$lib/platform";
	import { isSettingsShortcut } from "$lib/shell-layout";
	import { STATUS_CHOICES, chosenStatus } from "$lib/status";
	import { userStatusToString } from "$lib/types";

	// The profile row at the sidebar's foot (#357, S-07): who the user is (their avatar with its status, their name
	// and the status they chose), which opens the status menu, and the way into Settings. The sidebar mounts the
	// playback bar and the media controls above it, as blocks of their own (SpaceNav.svelte). Folded (`collapsed`), it
	// is the edge's narrow column instead, which still stacks the media controls (with the voice the user is in and
	// its Leave) under the avatar: the edge has no room for them elsewhere. It was UserStatusBar until the redesign split it.
	let { collapsed = false }: { collapsed?: boolean } = $props();

	// The status the user chose, which everyone sees while they're connected.
	const myChoice = $derived(chosenStatus($currentUser?.status));
	const myStatus = $derived(userStatusToString(myChoice));
	const myStatusLabel = $derived(STATUS_CHOICES.find((c) => c.status === myChoice)?.label ?? "");

	let showUserSettings = $state(false);

	// Settings' own shortcut: ⌘, on macOS, Ctrl , elsewhere. Not over another dialog.
	const mac = currentShell().os === "mac";
	function onKeydown(event: KeyboardEvent) {
		if (!isSettingsShortcut(event, mac) || showUserSettings) return;
		if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
		event.preventDefault();
		showUserSettings = true;
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if collapsed && $currentUser}
	<div class="border-duvet-sb-edge flex shrink-0 flex-col items-center gap-1 border-t px-1 py-2">
		<StatusMenu class="relative cursor-pointer rounded-full">
			<UserAvatar
				src={getAvatarURL($currentUser.id, $currentUser.avatar)}
				name={$currentUser.alias || $currentUser.username}
				size={28}
				class="box-border transition-all duration-200 {$speakingUsers.has($currentUser.id)
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
		<button class={iconButtonClass()} aria-label="User Settings" onclick={() => (showUserSettings = true)}>
			<GearSixIcon class="size-4" />
		</button>
	</div>
{/if}

<!-- The profile row: the avatar, the name and the chosen status open the status menu. -->
{#if !collapsed && $currentUser}
	<div class="flex min-w-0 shrink-0 items-center gap-0.5">
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
		<button
			class={iconButtonClass()}
			aria-label="User Settings"
			title="Settings"
			onclick={() => (showUserSettings = true)}
		>
			<GearSixIcon class="size-4" />
		</button>
	</div>
{/if}

<UserSettings bind:open={showUserSettings} />
