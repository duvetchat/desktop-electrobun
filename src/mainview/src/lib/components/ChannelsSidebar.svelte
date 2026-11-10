<script lang="ts">
	import { toast } from "$lib/stores/toast.svelte";
	import { getApiError } from "$lib/api/api";
	import {
		EllipsisVertical as DotsThreeVerticalIcon,
		Hash as HashIcon,
		Volume2 as SpeakerSimpleHighIcon,
		Lock as LockSimpleIcon,
		Plus as PlusIcon,
		Settings as GearSixIcon,
		Trash2 as TrashSimpleIcon,
		Copy as CopySimpleIcon,
		Link2 as LinkSimpleIcon,
		ChevronDown as ChevronDownIcon,
		ChevronRight as ChevronRightIcon,
		MicOff as MicrophoneSlashIcon,
		Headphones as HeadphonesIcon,
		MonitorUp as MonitorUpIcon,
		Video as VideoIcon,
		Pencil as PencilIcon,
	} from "@lucide/svelte";

	import { ContextMenu, Dialog, DropdownMenu } from "bits-ui";
	import { onMount } from "svelte";
	import { categoryDropPosition, topLevelEnd, type Guild, type Channel, type RoomType } from "$lib/types";
	import { hasPermission, hasSpacePermission, Permission } from "$lib/permissions";
	import ServerSettings from "$lib/components/ServerSettings.svelte";
	import ChannelSettings from "$lib/components/ChannelSettings.svelte";
	import { createRoom, deleteRoom, updateRoom } from "$lib/api/rooms";
	import InviteModal from "$lib/components/InviteModal.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import UserStatusBar from "$lib/components/UserStatusBar.svelte";
	import SpaceBanner from "$lib/components/SpaceBanner.svelte";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import {
		speakingUsers,
		activeVoiceRoomId,
		gatewaySpaces,
		typingNow,
		unreadChannels,
		mentionCounts,
	} from "$lib/stores.svelte";
	import { typingSentence } from "$lib/typing";
	import TypingMark from "$lib/components/TypingMark.svelte";

	// props
	let {
		guild,
		channels,
		activeChannelId = null,
		onSelect = () => {},
		showChannels = true,
		embedded = false,
	}: {
		guild: Guild;
		channels: Channel[];
		activeChannelId?: string | null;
		onSelect?: (channelId: string) => void;
		showChannels?: boolean;
		/** Drawn as a tree under the space's row in the spaces column, which has the space's name, menu and the user's
		 * bar: only the rooms show, without a column of their own. */
		embedded?: boolean;
	} = $props();

	let buttons = $state<(HTMLElement | null)[]>([]);
	let expanded = $state<{ [key: string]: boolean }>({});

	const space = $derived($gatewaySpaces.find((s) => s.id === guild.id));
	let showCreateModal = $state(false);
	let newChannelName = $state("");
	let newChannelType = $state<RoomType>(1);
	let newChannelCategory = $state<string | null>(null);
	let isCreating = $state(false);

	let confirmDeleteChannel = $state<Channel | null>(null);
	let isDeletingChannel = $state(false);

	let showInviteModal = $state(false);
	let inviteModalChannel = $state<Channel | null>(null);

	let showChannelSettings = $state(false);
	let channelSettingsTarget = $state<Channel | null>(null);

	function openChannelSettings(channel: Channel) {
		channelSettingsTarget = channel;
		showChannelSettings = true;
	}

	function openInviteModal(channel: Channel) {
		inviteModalChannel = channel;
		showInviteModal = true;
	}

	let showServerSettings = $state(false);
	// The space the settings were opened for. When it goes (deleted, or left) while they're open, the sidebar
	// shows the next space: the settings close rather than show that one's.
	let settingsSpaceId: string | null = null;

	// The spaces column opens these from the space's row, as the header's menu does.
	export function openServerSettings() {
		settingsSpaceId = guild.id;
		showServerSettings = true;
	}

	$effect(() => {
		if (showServerSettings && guild.id !== settingsSpaceId) showServerSettings = false;
	});

	export function openCreateChannel() {
		showCreateModal = true;
	}

	async function handleCreateChannel() {
		if (!newChannelName.trim() || isCreating) return;
		isCreating = true;
		try {
			const categoryToPass = newChannelType !== 3 ? newChannelCategory : null;
			await createRoom(guild.id, newChannelName.trim(), newChannelType, categoryToPass);
			showCreateModal = false;
			newChannelName = "";
			newChannelType = 1;
			newChannelCategory = null;
		} catch (e) {
			console.error(e);
			toast(getApiError(e, "Failed to create room"), "error");
		} finally {
			isCreating = false;
		}
	}

	async function handleDeleteChannel() {
		if (!confirmDeleteChannel || isDeletingChannel) return;
		isDeletingChannel = true;
		try {
			await deleteRoom(guild.id, confirmDeleteChannel.id);
			confirmDeleteChannel = null;
		} catch (err) {
			console.error("Failed to delete channel:", err);
			toast(getApiError(err, "Failed to delete room"), "error");
		} finally {
			isDeletingChannel = false;
		}
	}

	// Filter clickable channels (exclude categories for keyboard nav)
	const clickableChannels = $derived(channels.filter((c) => c.type !== "category"));
	$effect(() => {
		buttons = new Array(clickableChannels.length).fill(null);
	});

	// Group channels: top-level (no categoryId) and by category
	const topLevelChannels = $derived(
		channels
			.filter((c) => c.type !== "category" && !c.categoryId)
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
	);
	const categories = $derived(
		channels.filter((c) => c.type === "category").sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
	);
	$effect(() => {
		categories.forEach((cat) => {
			if (expanded[cat.id] === undefined) expanded[cat.id] = true;
		});
	});

	type SidebarItem = { kind: "channel"; channel: Channel; indent: boolean } | { kind: "category"; channel: Channel };

	const sidebarItems = $derived([
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
	] as SidebarItem[]);

	function getSubChannels(categoryId: string) {
		return channels.filter((c) => c.categoryId === categoryId).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
	}

	// ── Drag & Drop reorder ───────────────────────────────────────────────────
	let draggedChannelId = $state<string | null>(null);
	let dropTargetIdx = $state<number | null>(null);

	function handleDragStartReorder(e: DragEvent, channelId: string) {
		draggedChannelId = channelId;
		e.dataTransfer!.effectAllowed = "move";
		e.dataTransfer!.setData("text/x-reorder", channelId);
	}

	let dropPosition = $state<"above" | "below" | "into" | null>(null);

	function handleDragOver(e: DragEvent, idx: number) {
		if (!draggedChannelId) return;
		e.preventDefault();
		e.dataTransfer!.dropEffect = "move";

		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const y = e.clientY - rect.top;
		const item = sidebarItems[idx];

		if (item?.kind === "category") {
			// Categories: top third = above, middle = into, bottom third = below
			if (y < rect.height / 3) dropPosition = "above";
			else if (y > (rect.height * 2) / 3) dropPosition = "below";
			else dropPosition = "into";
		} else {
			// Channels: top half = above, bottom half = below
			dropPosition = y < rect.height / 2 ? "above" : "below";
		}

		dropTargetIdx = idx;

		// Over its own header or rooms a dragged category does nothing, so no line. Over a room inside another category
		// it lands right after that category (handleDrop), so the line goes under that category's last room.
		if (channels.find((c) => c.id === draggedChannelId)?.type === "category") {
			const categoryId = item?.channel.categoryId;
			if (item?.channel.id === draggedChannelId || categoryId === draggedChannelId) {
				dropTargetIdx = null;
				dropPosition = null;
			} else if (categoryId) {
				dropTargetIdx = sidebarItems.findLastIndex((it) => it.channel.categoryId === categoryId);
				dropPosition = "below";
			}
		}
	}

	function handleDragOverEnd(e: DragEvent) {
		if (!draggedChannelId) return;
		e.preventDefault();
		e.dataTransfer!.dropEffect = "move";
		dropTargetIdx = sidebarItems.length;
		dropPosition = "below";
	}

	function handleDragEnd() {
		draggedChannelId = null;
		dropTargetIdx = null;
		dropPosition = null;
	}

	async function handleDrop(e: DragEvent, targetIdx: number) {
		e.preventDefault();
		const srcId = draggedChannelId;
		const pos = dropPosition;
		draggedChannelId = null;
		dropTargetIdx = null;
		dropPosition = null;

		if (!srcId || !space) return;

		const srcItem = sidebarItems.find((it) => it.channel.id === srcId);
		if (!srcItem) return;

		let newParentId: string | null;
		let newPosition: number;

		const isDraggingCategory = srcItem.channel.type === "category";

		if (targetIdx >= sidebarItems.length) {
			// Dropped at the very end — put at root, after its last room or category
			newParentId = null;
			newPosition = topLevelEnd(channels, srcId);
		} else {
			const targetItem = sidebarItems[targetIdx];
			if (srcId === targetItem.channel.id) return;

			if (targetItem.kind === "category" && pos === "into" && !isDraggingCategory) {
				// Drop into category → first position inside (categories can't nest)
				newParentId = targetItem.channel.id;
				newPosition = 0;
			} else {
				const targetPos = targetItem.channel.position ?? 0;
				newParentId = targetItem.channel.categoryId ?? null;

				if (targetItem.kind === "category") {
					// Above/below a category → root level
					newParentId = null;
					newPosition = pos === "above" ? targetPos : targetPos + 1;
				} else if (isDraggingCategory) {
					// A category can't go inside another, so a room inside one stands for it (its own place is within
					// that category, not at the root). On a room of its own category it has nowhere to go.
					if (srcId === newParentId) return;
					newPosition = categoryDropPosition(channels, targetItem.channel, pos === "above" ? "above" : "below");
				} else {
					newPosition = pos === "above" ? targetPos : targetPos + 1;
				}
			}
		}

		// Categories always stay at root
		if (isDraggingCategory) newParentId = null;

		// Don't move to same spot
		const srcParent = srcItem.channel.categoryId ?? null;
		if (srcParent === newParentId && srcItem.channel.position === newPosition) return;

		try {
			const payload: { position: number; parent_id?: string | null } = { position: newPosition };
			if (!isDraggingCategory) payload.parent_id = newParentId;
			await updateRoom(guild.id, srcId, payload);
		} catch (err) {
			toast(getApiError(err, "Failed to move room"), "error");
		}
	}

	function dropIndicatorClass(idx: number): string {
		if (dropTargetIdx !== idx || !draggedChannelId) return "";
		if (dropPosition === "above") return "border-t-2 border-duvet-accent";
		if (dropPosition === "below") return "border-b-2 border-duvet-accent";
		if (dropPosition === "into") return "ring-1 ring-duvet-accent";
		return "";
	}

	// A room's line is drawn on its wrapper, which holds its voice users under the button, so it sits under them too.
	// It's a shadow in the gap between rooms: a border would add its width to the wrapper's height and shift the rows.
	function roomDropIndicatorClass(idx: number): string {
		if (dropTargetIdx !== idx || !draggedChannelId) return "";
		if (dropPosition === "above") return "rounded-lg shadow-[0_-2px_0_0_var(--duvet-accent)]";
		if (dropPosition === "below") return "rounded-lg shadow-[0_2px_0_0_var(--duvet-accent)]";
		return "";
	}

	function selectChannel(channel: Channel) {
		if (channel.type !== "category") {
			onSelect(channel.id);
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
	class={embedded
		? "text-duvet-ink flex flex-col"
		: `border-duvet-line bg-duvet-sunk text-duvet-ink flex h-full flex-col overflow-hidden border-r transition-[width] duration-200 ${showChannels ? "w-60" : "w-14"}`}
>
	{#if !showChannels && !embedded}
		<!-- Collapsed: guild avatar + vertical user controls -->
		<div class="flex flex-1 flex-col items-center gap-2 pt-3">
			<SpaceIcon src={guild.icon_url || null} name={guild.name} size={40} />
		</div>
		<UserStatusBar collapsed />
	{:else}
		<!-- Scrollable content area — flex-1 so user bar is always pinned to bottom -->
		<div class={embedded ? "flex flex-col" : "flex min-h-0 flex-1 flex-col overflow-hidden"}>
			{#if !embedded}
				<SpaceBanner src={guild.banner_url || null} height="6rem" class="shrink-0 rounded-none" />
				<div
					class="border-duvet-line text-duvet-ink relative flex h-10 shrink-0 items-center justify-between border-b px-3 font-semibold"
				>
					<span class="truncate">{guild.name}</span>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger class="ml-auto shrink-0 text-zinc-400 hover:text-white" aria-label="Space menu">
							<DotsThreeVerticalIcon class="size-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								class="z-50 w-52 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl"
								sideOffset={6}
								align="end"
							>
								<DropdownMenu.Item
									class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
									onSelect={openServerSettings}
								>
									<GearSixIcon class="size-4 text-zinc-400" />
									Space Settings
								</DropdownMenu.Item>
								<!-- The API creates a room for ManageChannels in the space -->
								{#if space && hasSpacePermission(space, Permission.ManageChannels)}
									<DropdownMenu.Item
										class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
										onSelect={openCreateChannel}
									>
										<PlusIcon class="size-4 text-zinc-400" />
										Create Room
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>
				</div>
			{/if}
			<!-- Embedded, the rooms hang from the space's row on a guide line, and the spaces column scrolls them. -->
			<div
				class={embedded
					? "border-duvet-line mb-1 ml-[19px] flex flex-col gap-px border-l-2 py-0.5 pl-2.5"
					: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"}
				role="list"
			>
				{#if !embedded}
					<!-- A sticky bar sticks inside the list's padding: -top-2 takes its 8 px back, so the bar meets the list's
					     top edge and no row shows above it. -->
					<div
						class="border-duvet-line bg-duvet-sunk text-duvet-ink2 sticky -top-2 z-10 flex h-10 items-center border-b px-3 text-[13px] font-bold select-none"
					>
						Rooms
					</div>
				{/if}
				{#if sidebarItems.length === 0}
					<p class="text-duvet-ink2 px-2 py-1.5 text-[13px]">No rooms you can see yet</p>
				{/if}
				{#each sidebarItems as item, itemIdx}
					{#if item.kind === "category"}
						{@const categoryRoom = space?.rooms.find((r) => r.id === item.channel.id)}
						{@const canManageCategory =
							space && categoryRoom ? hasPermission(space, categoryRoom, Permission.ManageChannels) : false}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								<button
									type="button"
									class="rounded-row text-duvet-ink2 hover:text-duvet-ink focus-visible:outline-duvet-accent mt-1 flex h-7 w-full items-center gap-1 border-0 bg-transparent px-1.5 text-left text-[13px] font-bold focus-visible:outline-2 {dropIndicatorClass(
										itemIdx,
									)}"
									onclick={() => toggleCategory(item.channel.id)}
									aria-expanded={expanded[item.channel.id]}
									draggable={canManageCategory}
									ondragstart={(e) => handleDragStartReorder(e, item.channel.id)}
									ondragover={(e) => handleDragOver(e, itemIdx)}
									ondrop={(e) => handleDrop(e, itemIdx)}
									ondragend={handleDragEnd}
								>
									{#if expanded[item.channel.id]}
										<ChevronDownIcon class="size-3.5 shrink-0" aria-hidden="true" />
									{:else}
										<ChevronRightIcon class="size-3.5 shrink-0" aria-hidden="true" />
									{/if}
									<span class="truncate">{item.channel.name}</span>
								</button>
							</ContextMenu.Trigger>
							<ContextMenu.Portal>
								<ContextMenu.Content
									class="z-200 min-w-44 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl"
								>
									<ContextMenu.Item
										class="w-full px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
										onSelect={() => navigator.clipboard.writeText(item.channel.id)}
									>
										<div class="flex items-center gap-2">
											<CopySimpleIcon class="size-4 text-zinc-400" />
											Copy Room ID
										</div>
									</ContextMenu.Item>
									{#if canManageCategory}
										<ContextMenu.Item
											class="w-full px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
											onSelect={() => openChannelSettings(item.channel)}
										>
											<div class="flex items-center gap-2">
												<PencilIcon class="size-4 text-zinc-400" />
												Edit Category
											</div>
										</ContextMenu.Item>
										<div class="my-1 border-t border-zinc-700"></div>
										<ContextMenu.Item
											class="w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-zinc-700"
											onSelect={() => (confirmDeleteChannel = item.channel)}
										>
											<div class="flex items-center gap-2">
												<TrashSimpleIcon class="size-4" />
												Delete Category
											</div>
										</ContextMenu.Item>
									{/if}
								</ContextMenu.Content>
							</ContextMenu.Portal>
						</ContextMenu.Root>
					{:else}
						{@const channel = item.channel}
						{@const buttonIndex = clickableChannels.findIndex((c) => c.id === channel.id)}
						{@const room = space?.rooms.find((r) => r.id === channel.id)}
						{@const canManage = space && room ? hasPermission(space, room, Permission.ManageChannels) : false}
						{@const canJoin =
							channel.type !== "voice" || (space && room && hasPermission(space, room, Permission.JoinVoice))}
						{@const isUnread =
							channel.type === "text" && ($unreadChannels.has(channel.id) || !!$mentionCounts[channel.id])}
						{@const voiceCount = channel.voiceUsers?.length ?? 0}
						{@const typers = channel.type === "text" ? $typingNow[channel.id] : undefined}
						{@const typing = typingSentence(typers)}
						<div role="listitem" class="group/channel {roomDropIndicatorClass(itemIdx)}">
							<ContextMenu.Root>
								<ContextMenu.Trigger>
									<button
										class="focus-visible:outline-duvet-accent flex h-8 w-full items-center gap-1.5 rounded-[10px] px-2 text-left text-sm focus-visible:outline-2
						{channel.id === activeChannelId
											? 'bg-duvet-accent-tint text-duvet-accent-text font-semibold'
											: isUnread
												? 'text-duvet-ink hover:bg-duvet-card font-bold'
												: 'text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink'}
						{!canJoin ? 'cursor-not-allowed opacity-50' : ''}"
										aria-pressed={channel.id === activeChannelId}
										title={typing ? `${channel.name} · ${typing}` : channel.name}
										draggable="true"
										ondragstart={(e) => {
											// Anyone drags a room into a pane; it's reordered here only with ManageChannels in it,
											// which the API checks.
											if (canManage) handleDragStartReorder(e, channel.id);
											e.dataTransfer!.effectAllowed = "move";
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
										ondragover={(e) => handleDragOver(e, itemIdx)}
										ondrop={(e) => handleDrop(e, itemIdx)}
										ondragend={handleDragEnd}
										data-jump
										onclick={() => canJoin && selectChannel(channel)}
										ondblclick={() => canJoin && channel.type === "voice" && joinVoiceChannel(channel)}
										onkeydown={(e) => canJoin && onKeyDown(e, buttonIndex)}
										use:register={buttonIndex}
									>
										<span
											class="relative shrink-0 {channel.type === 'voice' && voiceCount > 0
												? 'text-duvet-alive'
												: 'text-duvet-ink2'}"
										>
											{#if typers}
												<TypingMark users={typers} />
											{:else if channel.type === "text"}
												<HashIcon class="size-4" />
											{:else if channel.type === "voice"}
												<SpeakerSimpleHighIcon class="size-4" />
												{#if !canJoin}
													<LockSimpleIcon
														class="bg-duvet-sunk text-duvet-danger absolute -right-2 -bottom-1 size-3.5 rounded-full"
													/>
												{/if}
											{/if}
										</span>
										<span class="min-w-0 flex-1 truncate">{channel.name}</span>
										{#if typing}<span class="sr-only">{typing}</span>{/if}
										{#if channel.type === "text" && $mentionCounts[channel.id]}
											<span
												class="bg-duvet-accent text-duvet-on-accent ml-1 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold"
												aria-label="{$mentionCounts[channel.id]} mentions">{$mentionCounts[channel.id]}</span
											>
										{:else if voiceCount > 0}
											<span class="text-duvet-ink2 ml-1 shrink-0 text-xs font-normal">{voiceCount} in voice</span>
										{/if}
									</button>
								</ContextMenu.Trigger>
								<ContextMenu.Portal>
									<ContextMenu.Content
										class="z-200 min-w-44 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl"
									>
										<ContextMenu.Item
											class="w-full px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
											onSelect={() => navigator.clipboard.writeText(channel.id)}
										>
											<div class="flex items-center gap-2">
												<CopySimpleIcon class="size-4 text-zinc-400" />
												Copy Room ID
											</div>
										</ContextMenu.Item>
										<!-- The API creates an invite for CreateInvites in the room, overwrites included -->
										{#if channel.type !== "category" && space && room && hasPermission(space, room, Permission.CreateInvites)}
											<ContextMenu.Item
												class="w-full px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
												onSelect={() => openInviteModal(channel)}
											>
												<div class="flex items-center gap-2">
													<LinkSimpleIcon class="size-4 text-zinc-400" />
													Invite People
												</div>
											</ContextMenu.Item>
										{/if}
										{#if canManage}
											<div class="my-1 border-t border-zinc-700"></div>
											<ContextMenu.Item
												class="w-full px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
												onSelect={() => openChannelSettings(channel)}
											>
												<div class="flex items-center gap-2">
													<GearSixIcon class="size-4 text-zinc-400" />
													Settings
												</div>
											</ContextMenu.Item>
											<ContextMenu.Item
												class="w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-zinc-700"
												onSelect={() => (confirmDeleteChannel = channel)}
											>
												<div class="flex items-center gap-2">
													<TrashSimpleIcon class="size-4" />
													Delete Room
												</div>
											</ContextMenu.Item>
										{/if}
									</ContextMenu.Content>
								</ContextMenu.Portal>
							</ContextMenu.Root>
							{#if channel.type === "voice" && channel.voiceUsers && channel.voiceUsers.length > 0}
								<div class="space-y-1 py-1 pl-7">
									{#each channel.voiceUsers as user (user.id)}
										{@const isSharing = user.screen_sharing ?? false}
										{@const isSpeaking = $speakingUsers.has(user.id) && !user.muted}
										<div class="text-duvet-ink2 flex items-center gap-2 text-[13px]">
											<UserAvatar
												src={user.avatar_url}
												name={user.username}
												size={24}
												class="box-border shrink-0 transition-colors duration-200 {isSpeaking
													? 'border-duvet-alive border-2'
													: 'border-2 border-transparent'}"
											/>
											<span class="flex-1 truncate {isSpeaking ? 'text-duvet-ink' : ''}">{user.username}</span>
											<div class="flex shrink-0 items-center gap-0.5">
												{#if user.camera}
													<VideoIcon class="size-3.5 text-blue-400" />
												{/if}
												{#if isSharing}
													<MonitorUpIcon class="size-3.5 text-blue-400" />
												{/if}
												{#if user.muted}
													<MicrophoneSlashIcon class="size-3.5 text-zinc-500" />
												{/if}
												{#if user.deafened}
													<HeadphonesIcon class="size-3.5 text-zinc-500" />
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				{/each}
				<!-- Drop zone at the end -->
				{#if draggedChannelId}
					<!-- Only a target for mouse drags, which have no keyboard equivalent yet. -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="h-6 rounded {dropTargetIdx === sidebarItems.length ? 'bg-duvet-accent-tint' : ''}"
						ondragover={handleDragOverEnd}
						ondrop={(e) => handleDrop(e, sidebarItems.length)}
					></div>
				{/if}
			</div>
		</div>
		<!-- end scrollable content area -->

		{#if !embedded}
			<UserStatusBar />
		{/if}
	{/if}
</div>

<ServerSettings bind:open={showServerSettings} space={space ?? null} spaceId={guild.id} />

<Dialog.Root bind:open={showCreateModal}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 text-zinc-200">
			<div class="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
				<h2 class="mb-4 text-lg font-semibold text-white">Create Room</h2>

				<div class="mb-4">
					<label for="channelType" class="mb-1 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
						>Room Type</label
					>
					<select
						id="channelType"
						bind:value={newChannelType}
						class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white outline-none focus:ring-1 focus:ring-stone-500"
					>
						<option value={1}>Text Room</option>
						<option value={2}>Voice Room</option>
						<option value={3}>Category</option>
					</select>
				</div>

				{#if newChannelType !== 3}
					<div class="mb-4">
						<label for="channelCategory" class="mb-1 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
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
					<label for="channelName" class="mb-1 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
						>Room Name</label
					>
					<div class="relative">
						<span class="absolute top-2.5 left-3 text-zinc-500">
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
							class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 pr-3 pl-8 text-sm text-white placeholder-zinc-500 outline-none focus:ring-1 focus:ring-stone-500"
							placeholder="new-room"
							maxlength={64}
							onkeydown={(e) => e.key === "Enter" && handleCreateChannel()}
							use:focusOnMount
						/>
					</div>
				</div>

				<div class="flex justify-end gap-2">
					<Dialog.Close class="rounded-md px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
						>Cancel</Dialog.Close
					>
					<button
						class="bg-fill-600 text-fixed-white hover:bg-fill-500 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
						onclick={handleCreateChannel}
						disabled={!newChannelName.trim() || isCreating}
					>
						Create Room
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<Dialog.Root open={!!confirmDeleteChannel} onOpenChange={(v) => !v && (confirmDeleteChannel = null)}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/50" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 text-zinc-200">
			<div class="w-96 rounded-lg border border-zinc-700 bg-zinc-800 p-6 shadow-lg">
				<h2 class="mb-2 text-xl font-bold text-white">Delete Room</h2>
				<p class="mb-6 text-zinc-400">
					Are you sure you want to delete
					<span class="font-semibold text-white">#{confirmDeleteChannel?.name}</span>? This action cannot be undone.
				</p>
				<div class="flex justify-end gap-3">
					<Dialog.Close class="px-4 py-2 text-zinc-300 hover:underline">Cancel</Dialog.Close>
					<button
						class="text-fixed-white rounded bg-red-600 px-4 py-2 transition-colors hover:bg-red-700 disabled:opacity-50"
						onclick={handleDeleteChannel}
						disabled={isDeletingChannel}
					>
						Delete Room
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<InviteModal bind:open={showInviteModal} channel={inviteModalChannel} spaceId={guild.id} />

{#if channelSettingsTarget && space}
	{@const settingsRoom = space.rooms.find((r) => r.id === channelSettingsTarget?.id)}
	{#if settingsRoom}
		<ChannelSettings
			bind:open={showChannelSettings}
			{space}
			room={settingsRoom}
			onDelete={() => {
				confirmDeleteChannel = channelSettingsTarget;
				showChannelSettings = false;
			}}
		/>
	{/if}
{/if}
