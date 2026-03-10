<script lang="ts">
import {
	EllipsisVertical as DotsThreeVerticalIcon,
	Hash as HashIcon,
	Volume2 as SpeakerSimpleHighIcon,
	Lock as LockSimpleIcon,
	Plus as PlusIcon,
	Mic as MicrophoneIcon,
	MicOff as MicrophoneSlashIcon,
	Headphones as HeadphonesIcon,
	SignalHigh as CellSignalFullIcon,
	SignalMedium as CellSignalMediumIcon,
	SignalLow as CellSignalLowIcon,
	PhoneOff as PhoneDisconnectIcon,
	Settings as GearSixIcon,
	Trash2 as TrashSimpleIcon,
	Copy as CopySimpleIcon,
	Link2 as LinkSimpleIcon,
	ChevronDown as ChevronDownIcon,
	ChevronRight as ChevronRightIcon,
} from "lucide-svelte";
import { Dialog, DropdownMenu } from "bits-ui";
import { onMount } from "svelte";
import { createEventDispatcher } from "svelte";
import type { Guild, Channel, RoomType } from "$lib/types";
import { hasPermission, Permission } from "$lib/permissions";
import ServerSettings from "$lib/components/ServerSettings.svelte";
import { createRoom, deleteRoom } from "$lib/api/rooms";
import InviteModal from "$lib/components/InviteModal.svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import {
	speakingUsers,
	currentUser,
	isMuted,
	isDeafened,
	activeVoiceRoomId,
	selectedMicId,
	gatewaySpaces,
} from "$lib/stores.svelte";
import { sendEventMessage } from "$lib/api/ws/connection";
import { fly } from "svelte/transition";

const dispatch = createEventDispatcher<{ select: string }>();

// props
export let guild: Guild;
export let channels: Channel[];
export let activeChannelId: string | null =
	channels.find((c) => c.type !== "category")?.id ?? null;

let buttons: (HTMLElement | null)[] = [];
let expanded: { [key: string]: boolean } = {};

$: space = $gatewaySpaces.find((s) => s.id === guild.id);
$: activeVoiceSpace = $activeVoiceRoomId
	? $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === $activeVoiceRoomId))
	: null;
$: activeVoiceRoom = activeVoiceSpace?.rooms.find(
	(r) => r.id === $activeVoiceRoomId,
);
$: canSpeak =
	activeVoiceSpace && activeVoiceRoom
		? hasPermission(activeVoiceSpace, activeVoiceRoom, Permission.SpeakInVoice)
		: true;
$: if (!canSpeak) $isMuted = true;

let showCreateModal = false;
let newChannelName = "";
let newChannelType: RoomType = 1;
let newChannelCategory: string | null = null;
let isCreating = false;

let contextMenuX = 0;
let contextMenuY = 0;
let contextMenuChannel: Channel | null = null;
let confirmDeleteChannel: Channel | null = null;
let isDeletingChannel = false;

let showInviteModal = false;
let inviteModalChannel: Channel | null = null;

function openInviteModal(channel: Channel) {
	contextMenuChannel = null;
	inviteModalChannel = channel;
	showInviteModal = true;
}

let showServerSettings = false;

function openServerSettings() {
	showServerSettings = true;
}

function openCreateChannel() {
	showCreateModal = true;
}

function toggleMute() {
	if (!canSpeak) return;
	isMuted.update((m) => !m);
	if ($activeVoiceRoomId) {
		sendEventMessage("VOICE_SYNC", {
			room_id: $activeVoiceRoomId,
			muted: $isMuted,
			deafened: $isDeafened,
		});
	}
}

function toggleDeafen() {
	isDeafened.update((d) => !d);
	if ($isDeafened) isMuted.set(true);
	if ($activeVoiceRoomId) {
		sendEventMessage("VOICE_SYNC", {
			room_id: $activeVoiceRoomId,
			muted: $isMuted,
			deafened: $isDeafened,
		});
	}
}

let showMicMenu = false;
let micMenuX = 0;
let micMenuY = 0;
let availableMics: MediaDeviceInfo[] = [];

let ping: number | null = null;
let pingIntervalId: ReturnType<typeof setInterval> | null = null;

async function measurePing() {
	try {
		const start = performance.now();
		await fetch("http://localhost:8080/health", {
			method: "GET",
			cache: "no-store",
		});
		ping = Math.round(performance.now() - start);
	} catch {
		ping = null;
	}
}

$: if ($activeVoiceRoomId) {
	if (!pingIntervalId) {
		measurePing();
		pingIntervalId = setInterval(measurePing, 3000);
	}
} else {
	if (pingIntervalId) {
		clearInterval(pingIntervalId);
		pingIntervalId = null;
		ping = null;
	}
}

function pingColor(ms: number): string {
	if (ms < 100) return "text-stone-300";
	if (ms < 250) return "text-orange-400";
	return "text-red-400";
}
function pingIconColor(ms: number | null): string {
	if (ms === null || ms < 100) return "text-stone-500";
	if (ms < 250) return "text-orange-400";
	return "text-red-400";
}

function pingBgColor(ms: number | null): string {
	if (ms === null || ms < 100) return "bg-stone-900";
	if (ms < 250) return "bg-orange-950";
	return "bg-red-950";
}
async function openMicMenu(e: MouseEvent) {
	e.preventDefault();
	try {
		const devices = await navigator.mediaDevices.enumerateDevices();
		availableMics = devices.filter((d) => d.kind === "audioinput");

		// Calculate position relative to the viewport
		micMenuX = e.clientX;
		micMenuY = e.clientY - availableMics.length * 40 - 20; // Position above the cursor since it's at the bottom

		showMicMenu = true;
	} catch (err) {
		console.error("Failed to fetch media devices:", err);
	}
}

function selectMic(deviceId: string) {
	$selectedMicId = deviceId;
	showMicMenu = false;
}

async function handleCreateChannel() {
	if (!newChannelName.trim() || isCreating) return;
	isCreating = true;
	try {
		const categoryToPass = newChannelType !== 3 ? newChannelCategory : null;
		await createRoom(
			guild.id,
			newChannelName.trim(),
			newChannelType,
			categoryToPass,
		);
		showCreateModal = false;
		newChannelName = "";
		newChannelType = 1;
		newChannelCategory = null;
	} catch (e) {
		console.error(e);
		alert("Failed to create channel");
	} finally {
		isCreating = false;
	}
}

function openContextMenu(e: MouseEvent, channel: Channel) {
	e.preventDefault();
	contextMenuX = e.clientX;
	contextMenuY = e.clientY;
	contextMenuChannel = channel;
}

async function handleDeleteChannel() {
	if (!confirmDeleteChannel || isDeletingChannel) return;
	isDeletingChannel = true;
	try {
		await deleteRoom(guild.id, confirmDeleteChannel.id);
		confirmDeleteChannel = null;
	} catch (err) {
		console.error("Failed to delete channel:", err);
		alert("Failed to delete channel");
	} finally {
		isDeletingChannel = false;
	}
}

// Filter clickable channels (exclude categories for keyboard nav)
$: clickableChannels = channels.filter((c) => c.type !== "category");
$: buttons = new Array(clickableChannels.length).fill(null);

// Group channels: top-level (no categoryId) and by category
$: topLevelChannels = channels
	.filter((c) => c.type !== "category" && !c.categoryId)
	.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
$: categories = channels
	.filter((c) => c.type === "category")
	.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
$: {
	categories.forEach((cat) => {
		if (expanded[cat.id] === undefined) expanded[cat.id] = true;
	});
}

type SidebarItem =
	| { kind: "channel"; channel: Channel; indent: boolean }
	| { kind: "category"; channel: Channel };

$: sidebarItems = [
	...topLevelChannels.map(
		(ch): SidebarItem => ({
			kind: "channel",
			channel: ch,
			indent: false,
		}),
	),
	...categories.flatMap((cat): SidebarItem[] => [
		{ kind: "category", channel: cat },
		...(expanded[cat.id]
			? getSubChannels(cat.id).map(
					(ch): SidebarItem => ({
						kind: "channel",
						channel: ch,
						indent: true,
					}),
				)
			: []),
	]),
] as SidebarItem[];

function getSubChannels(categoryId: string) {
	return channels
		.filter((c) => c.categoryId === categoryId)
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function selectChannel(channel: Channel) {
	if (channel.type !== "category") {
		dispatch("select", channel.id);
	}
}

function joinVoiceChannel(channel: Channel) {
	if (channel.type === "voice") {
		$activeVoiceRoomId = channel.id;
	}
}

function toggleCategory(categoryId: string) {
	expanded = { ...expanded, [categoryId]: !expanded[categoryId] };
}

function onKeyDown(e: KeyboardEvent, i: number) {
	const key = (e as KeyboardEvent).key;
	if (key === "ArrowDown") {
		e.preventDefault();
		const next = Math.min(i + 1, buttons.length - 1);
		buttons[next]?.focus();
	} else if (key === "ArrowUp") {
		e.preventDefault();
		const prev = Math.max(i - 1, 0);
		buttons[prev]?.focus();
	} else if (key === "Enter" || key === " ") {
		e.preventDefault();
		selectChannel(clickableChannels[i]);
	}
}

// action to register button elements into the typed array
function register(node: HTMLElement, index: number) {
	buttons[index] = node;
	return {
		destroy() {
			if (buttons[index] === node) buttons[index] = null;
		},
		update(newIndex: number) {
			// handle index updates (reassign to new index)
			if (buttons[index] === node) buttons[index] = null;
			index = newIndex;
			buttons[index] = node;
		},
	};
}

function focusOnMount(node: HTMLElement) {
	node.focus();
}

onMount(() => {
	// ensure first button is focusable for keyboard users
	const firstBtn = buttons.at(0);
	if (firstBtn) firstBtn.tabIndex = 0;
});
</script>

<div
	class="flex h-full w-60 flex-col overflow-hidden border-r border-stone-800 bg-[linear-gradient(180deg,oklch(0.215_0.01_80),oklch(0.185_0.008_80))] text-stone-100/90"
>
	<div
		class="relative flex h-10 shrink-0 items-center justify-between border-b border-stone-800 bg-stone-950/50 px-3 font-semibold text-stone-100"
	>
		<span class="truncate">{guild.name}</span>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="text-zinc-400 hover:text-white ml-auto shrink-0" aria-label="Server menu">
				<DotsThreeVerticalIcon class="size-4" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content class="z-50 w-52 bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl py-1 overflow-hidden" sideOffset={6} align="end">
					<DropdownMenu.Item class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700 transition-colors" onSelect={openServerSettings}>
						<GearSixIcon class="size-4 text-zinc-400" />
						Server Settings
					</DropdownMenu.Item>
					<DropdownMenu.Item class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700 transition-colors" onSelect={openCreateChannel}>
						<PlusIcon class="size-4 text-zinc-400" />
						Create Channel
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	</div>
	<div class="flex h-full flex-col gap-1 overflow-y-auto p-2" role="list">
		<div class="sticky top-0 z-10 flex h-10 items-center bg-zinc-900 px-3 select-none text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
			Channels
		</div>
		{#each sidebarItems as item}
			{#if item.kind === "category"}
				<button
					type="button"
					class="flex h-10 w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-3 text-left text-[11px] font-semibold tracking-wide text-zinc-400 uppercase hover:bg-stone-800/40 hover:text-zinc-200"
					on:click={() => toggleCategory(item.channel.id)}
					on:contextmenu={(e) => openContextMenu(e, item.channel)}
					aria-expanded={expanded[item.channel.id]}
				>
					{#if expanded[item.channel.id]}
						<ChevronDownIcon class="size-3.5 shrink-0" aria-hidden="true" />
					{:else}
						<ChevronRightIcon class="size-3.5 shrink-0" aria-hidden="true" />
					{/if}
					<span>{item.channel.name}</span>
				</button>
			{:else}
				{@const channel = item.channel}
				{@const buttonIndex = clickableChannels.findIndex(
					(c) => c.id === channel.id,
				)}
				{@const room = space?.rooms.find((r) => r.id === channel.id)}
				{@const canJoin =
					channel.type !== "voice" ||
					(space &&
						room &&
						hasPermission(space, room, Permission.JoinVoice))}
				<div role="listitem" class="group/channel">
					<button
					class="flex h-10 w-full items-center gap-1.5 rounded-lg px-3.5 text-left
						{channel.id === activeChannelId
							? 'bg-stone-700 text-stone-100 ring-1 ring-stone-500/40'
							: 'hover:bg-stone-800 hover:text-stone-100 text-stone-300'}
						{!canJoin ? 'opacity-50 cursor-not-allowed text-zinc-500' : ''}"
						aria-pressed={channel.id === activeChannelId}
						title={channel.name}
						draggable="true"
						on:dragstart={(e) => {
							e.dataTransfer!.effectAllowed = "copy";
							e.dataTransfer!.setData(
								"text/plain",
								JSON.stringify({
									type: "channel",
									channelId: channel.id,
									channelName: channel.name,
									channelType: channel.type,
									spaceId: guild.id,
								}),
							);
						}}
						on:click={() => canJoin && selectChannel(channel)}
						on:contextmenu={(e) => openContextMenu(e, channel)}
						on:dblclick={() =>
							canJoin &&
							channel.type === "voice" &&
							joinVoiceChannel(channel)}
						on:keydown={(e) => canJoin && onKeyDown(e, buttonIndex)}
						use:register={buttonIndex}
					>
						<span
							class="relative shrink-0 {channel.id === activeChannelId
								? 'text-white'
								: 'text-zinc-400'}"
						>
							{#if channel.type === "text"}
								<HashIcon class="size-5" />
							{:else if channel.type === "voice"}
								<SpeakerSimpleHighIcon
									class="size-5"
								/>
								{#if !canJoin}
									<LockSimpleIcon
										class="size-4 text-red-400 absolute -bottom-1 -right-2 bg-zinc-900 rounded-full"
									/>
								{/if}
							{/if}
						</span>
						<span class="min-w-0 flex-1 truncate">{channel.name}</span>
						<DotsThreeVerticalIcon class="size-3.5 shrink-0 text-zinc-500 opacity-0 transition-opacity group-hover/channel:opacity-100" />
					</button>
					{#if channel.type === "voice" && channel.voiceUsers && channel.voiceUsers.length > 0}
						<div class="pl-8 py-1 space-y-1">
							{#each channel.voiceUsers as user (user.id)}
								<div
									class="flex items-center gap-2 text-sm text-zinc-400 group"
								>
									<div class="relative">
										<UserAvatar
											src={user.avatar_url}
											name={user.username}
											size={24}
											class="box-border transition-colors duration-200 {$speakingUsers.has(
												user.id,
											) && !user.muted
												? 'border-2 border-green-500'
												: 'border-2 border-transparent'}"
										/>
										{#if user.deafened}
											<div
										class="absolute -bottom-1 -right-1 bg-zinc-900 rounded-full p-0.5 border border-zinc-800 text-red-500 flex items-center justify-center z-10"
											>
												<HeadphonesIcon
													class="size-2.5"
												/>
											</div>
										{:else if user.muted}
											<div
										class="absolute -bottom-1 -right-1 bg-zinc-900 rounded-full p-0.5 border border-zinc-800 text-red-500 flex items-center justify-center z-10"
											>
												<MicrophoneSlashIcon
													class="size-2.5"
												/>
											</div>
										{/if}
									</div>
									<span
										class={$speakingUsers.has(user.id) &&
										!user.muted
										? "text-zinc-200"
										: ""}>{user.username}</span
									>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
	<!-- Voice Connected Banner -->
	{#if $activeVoiceRoomId && activeVoiceRoom}
		<div
			class="p-2"
			out:fly={{ y: 100, duration: 200, opacity: 1 }}
			in:fly={{ y: 100, duration: 200, opacity: 1 }}
		>
			<div
				class="bg-zinc-900 border border-zinc-800 rounded-full px-2 py-2 flex items-center justify-between shrink-0"
			>
				<div class="flex items-center gap-2 max-w-37.5">
					<div
						class="relative flex items-center justify-center p-2 {pingBgColor(
							ping,
						)} rounded-full shrink-0 cursor-default"
						title={ping !== null
							? `Ping: ${ping}ms`
							: "Measuring ping..."}
					>
						{#if ping !== null && ping >= 250}
							<CellSignalLowIcon
								class="size-4 {pingIconColor(ping)}"
							/>
						{:else if ping !== null && ping >= 100}
							<CellSignalMediumIcon
								class="size-4 {pingIconColor(ping)}"
							/>
						{:else}
							<CellSignalFullIcon
								class="size-4 {pingIconColor(ping)}"
							/>
						{/if}
					</div>
					<div class="flex flex-col truncate gap-0">
						<span class="text-xs font-semibold text-stone-300 truncate">
							Voice Connected
						</span>
						<span class="text-[10px] text-zinc-400 truncate">
							{activeVoiceSpace?.name || ""} / {activeVoiceRoom.name}
						</span>
					</div>
				</div>
				<div class="flex items-center gap-1 shrink-0">
					<button
					class="p-2 rounded-full hover:bg-zinc-700 hover:text-zinc-200 transition-colors text-zinc-400"
						aria-label="Disconnect"
						on:click={() => ($activeVoiceRoomId = null)}
					>
						<PhoneDisconnectIcon class="size-4" />
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Current User Profile Bottom Panel -->
	{#if $currentUser}
		<div
			class="bg-zinc-900 z-100 px-2 h-16 border-t border-t-zinc-800 flex items-center justify-between shrink-0"
		>
			<div
				class="flex items-center gap-2 hover:bg-zinc-800 p-1 w-full rounded-full cursor-pointer transition-colors max-w-30 group"
			>
				<div class="relative shrink-0">
					<UserAvatar
						src={$currentUser.avatar}
						name={$currentUser.alias || $currentUser.username}
						size={28}
						class="box-border transition-all duration-200 {$speakingUsers.has(
							$currentUser.id,
						)
							? 'ring-4 ring-stone-500'
							: ''}"
					/>
				</div>
				<div class="flex flex-col truncate">
					<span class="text-sm font-semibold truncate text-zinc-200"
						>{$currentUser.alias || $currentUser.username}</span
					>
				</div>
			</div>

			<div class="flex items-center text-zinc-400 shrink-0 relative">
				<button
					class="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors"
					class:text-red-400={$isMuted}
					class:hover:bg-zinc-700={canSpeak}
					class:opacity-50={!canSpeak}
					class:cursor-not-allowed={!canSpeak}
					aria-label="Toggle Mute"
					on:click={() => canSpeak && toggleMute()}
					on:contextmenu={(e) => canSpeak && openMicMenu(e)}
				>
					{#if $isMuted}
						<MicrophoneSlashIcon class="size-5" />
					{:else}
						<MicrophoneIcon class="size-5" />
					{/if}
				</button>
				<button
					class="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors"
					class:text-red-400={$isDeafened}
					aria-label="Deafen"
					on:click={toggleDeafen}
				>
					{#if $isDeafened}
						<HeadphonesIcon class="size-5" />
					{:else}
						<HeadphonesIcon class="size-5" />
					{/if}
				</button>
				<button
					class="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors"
					aria-label="User Settings"
				>
					<GearSixIcon class="size-5" />
				</button>
			</div>
		</div>
	{/if}
</div>

<svelte:window
	on:click={() => {
		showMicMenu = false;
		contextMenuChannel = null;
	}}
/>

<ServerSettings
	bind:open={showServerSettings}
	space={space ?? null}
	spaceId={guild.id}
/>

{#if showMicMenu}
	<div
		class="fixed z-200 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg py-1 min-w-50"
		style="left: {micMenuX}px; top: {micMenuY}px;"
		on:mousedown|stopPropagation
		role="menu"
		tabindex="-1"
	>
		<div
		class="px-3 py-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-700 mb-1"
		>
			Input Device
		</div>
		{#if availableMics.length === 0}
			<div class="px-3 py-2 text-sm text-zinc-400">
				No microphones found
			</div>
		{:else}
			{#each availableMics as mic}
				<button
				class="w-full text-left px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700 flex items-center justify-between"
					on:click={() => selectMic(mic.deviceId)}
				>
					<span class="truncate pr-2"
						>{mic.label ||
							"Microphone " +
								(availableMics.indexOf(mic) + 1)}</span
					>
					{#if $selectedMicId === mic.deviceId || ($selectedMicId === "" && mic.deviceId === "default")}
						<span
							class="w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0"
						></span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
{/if}

<Dialog.Root bind:open={showCreateModal}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 text-zinc-200">
			<div class="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
			<h2 class="mb-4 text-lg font-semibold text-white">Create Channel</h2>

			<div class="mb-4">
				<label
					for="channelType"
					class="mb-1 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
					>Channel Type</label
				>
				<select
					id="channelType"
					bind:value={newChannelType}
					class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white outline-none focus:ring-1 focus:ring-stone-500"
				>
					<option value={1}>Text Channel</option>
					<option value={2}>Voice Channel</option>
					<option value={3}>Category</option>
				</select>
			</div>

			{#if newChannelType !== 3}
				<div class="mb-4">
					<label
						for="channelCategory"
						class="mb-1 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
						>Category</label
					>
					<select
						id="channelCategory"
						bind:value={newChannelCategory}
						class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white outline-none focus:ring-1 focus:ring-stone-500"
					>
						<option value={null}>None</option>
						{#each categories as category}
							<option value={category.id}>{category.name}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="mb-5">
				<label
					for="channelName"
					class="mb-1 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
					>Channel Name</label
				>
				<div class="relative">
					<span class="absolute left-3 top-2.5 text-zinc-500">
						{#if newChannelType === 1}
							#
						{:else}
							🔊
						{/if}
					</span>
					<input
						id="channelName"
						type="text"
						bind:value={newChannelName}
						class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 pl-8 pr-3 text-sm text-white placeholder-zinc-500 outline-none focus:ring-1 focus:ring-stone-500"
						placeholder="new-channel"
						on:keydown={(e) =>
							e.key === "Enter" && handleCreateChannel()}
						use:focusOnMount
					/>
				</div>
			</div>

			<div class="flex justify-end gap-2">
				<Dialog.Close class="rounded-md px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white">Cancel</Dialog.Close>
				<button
					class="rounded-md bg-stone-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-500 disabled:opacity-50"
					on:click={handleCreateChannel}
					disabled={!newChannelName.trim() || isCreating}
				>
					Create Channel
				</button>
			</div>
		</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
{#if contextMenuChannel}
	{@const ctxRoom = space?.rooms.find((r) => r.id === contextMenuChannel?.id)}
	{@const canManage =
		space && ctxRoom
			? hasPermission(space, ctxRoom, Permission.ManageChannels)
			: false}
	<div
		class="fixed z-200 bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl py-1 min-w-44"
		style="left: {contextMenuX}px; top: {contextMenuY}px;"
		on:mousedown|stopPropagation
		role="menu"
		tabindex="-1"
	>
		<button
			class="w-full text-left px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700 flex items-center gap-2 transition-colors"
			on:click={() => {
				if (contextMenuChannel)
					navigator.clipboard.writeText(contextMenuChannel.id);
				contextMenuChannel = null;
			}}
		>
			<CopySimpleIcon class="size-4 text-zinc-400" />
			Copy Channel ID
		</button>
		{#if contextMenuChannel.type !== "category"}
			<button
				class="w-full text-left px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700 flex items-center gap-2 transition-colors"
				on:click={() =>
					contextMenuChannel && openInviteModal(contextMenuChannel)}
			>
				<LinkSimpleIcon class="size-4 text-zinc-400" />
				Invite People
			</button>
		{/if}
		{#if canManage}
			<div class="border-t border-zinc-700 my-1"></div>
			<button
				class="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-700 flex items-center gap-2 transition-colors"
				on:click={() => {
					confirmDeleteChannel = contextMenuChannel;
					contextMenuChannel = null;
				}}
			>
				<TrashSimpleIcon class="size-4" />
				Delete Channel
			</button>
		{/if}
	</div>
{/if}

<Dialog.Root open={!!confirmDeleteChannel} onOpenChange={(v) => !v && (confirmDeleteChannel = null)}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/50" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 text-zinc-200">
			<div class="bg-zinc-800 p-6 rounded-lg w-96 shadow-lg border border-zinc-700">
			<h2 class="text-xl font-bold mb-2 text-white">Delete Channel</h2>
			<p class="text-zinc-400 mb-6">
				Are you sure you want to delete
				<span class="font-semibold text-white"
					>#{confirmDeleteChannel?.name}</span
				>? This action cannot be undone.
			</p>
			<div class="flex justify-end gap-3">
				<Dialog.Close class="px-4 py-2 hover:underline text-zinc-300">Cancel</Dialog.Close>
				<button
					class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
					on:click={handleDeleteChannel}
					disabled={isDeletingChannel}
				>
					Delete Channel
				</button>
			</div>
		</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<InviteModal
	bind:open={showInviteModal}
	channel={inviteModalChannel}
	spaceId={guild.id}
/>
