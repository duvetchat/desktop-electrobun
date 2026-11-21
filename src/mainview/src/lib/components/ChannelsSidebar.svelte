<script lang="ts">
	import { toast } from "$lib/stores/toast.svelte";
	import { getApiError } from "$lib/api/api";
	import {
		AppWindow as AppWindowIcon,
		Columns2 as ColumnsIcon,
		Hash as HashIcon,
		Volume2 as SpeakerSimpleHighIcon,
		Lock as LockSimpleIcon,
		Settings as GearSixIcon,
		Trash2 as TrashSimpleIcon,
		Copy as CopySimpleIcon,
		Link2 as LinkSimpleIcon,
		ChevronDown as ChevronDownIcon,
		MicOff as MicrophoneSlashIcon,
		Headphones as HeadphonesIcon,
		Video as VideoIcon,
		Pencil as PencilIcon,
	} from "@lucide/svelte";

	import { onMount } from "svelte";
	import { categoryDropPosition, topLevelEnd, type Guild, type Channel, type RoomType } from "$lib/types";
	import { hasPermission, Permission } from "$lib/permissions";
	import { roomColumn } from "$lib/nav";
	import ServerSettings from "$lib/components/ServerSettings.svelte";
	import ChannelSettings from "$lib/components/ChannelSettings.svelte";
	import { createRoom, deleteRoom, updateRoom } from "$lib/api/rooms";
	import InviteModal from "$lib/components/InviteModal.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import Dialog from "$lib/components/ui/Dialog.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import { SELECT } from "$lib/components/settings/recipes";
	import { FIELD_LABEL, fieldClass } from "$lib/overlay-forms";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";
	import { countBadgeClass, MENU_PANEL, menuItemClass } from "$lib/components/ui/recipes";
	import { chipCount, keysFor, mentionsLabel, openHow, SHELL_KEYS, type OpenHow } from "$lib/shell-layout";
	import { speakingUsers, activeVoiceRoomId, gatewaySpaces, typingNow } from "$lib/stores.svelte";
	import { shownMentionCounts, shownUnreadRooms } from "$lib/notification-marks";
	import { notificationLevels, spaceLevel } from "$lib/notification-levels";
	import NotificationSubmenu from "$lib/components/NotificationSubmenu.svelte";
	import MemberMenu from "$lib/components/MemberMenu.svelte";
	import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";
	import { spaceMember } from "$lib/components/MemberList.svelte";
	import { withoutLongPress } from "$lib/default-menu";
	import { personOf } from "$lib/member-menu";
	import type { MemberOnSidebar, VoiceUser } from "$lib/types";
	import { typingSentence } from "$lib/typing";
	import TypingMark from "$lib/components/TypingMark.svelte";

	// props
	let {
		guild,
		channels,
		activeChannelId = null,
		onSelect = () => {},
		mac = false,
	}: {
		guild: Guild;
		channels: Channel[];
		activeChannelId?: string | null;
		/** A room picked, and how: a click opens it in the current tab, ⌘-click or a middle click in a new one, ⌥-click
		 * beside (lib/shell-layout.ts: openHow). */
		onSelect?: (channelId: string, how: OpenHow) => void;
		/** Whose keys the menu's hints name: ⌘-click on macOS, Ctrl-click elsewhere. */
		mac?: boolean;
	} = $props();

	// The rooms of a Space, drawn as a tree under its row in the sidebar (#357, S-06), which has the Space's name and
	// menu: the rooms in no category, then each category with its rooms, each voice room with who's in it.

	let buttons = $state<(HTMLElement | null)[]>([]);
	let expanded = $state<{ [key: string]: boolean }>({});

	const space = $derived($gatewaySpaces.find((s) => s.id === guild.id));

	// ── A voice room's people (#423) ──────────────────────────────────────────
	// Each has the member menu on a right-click (one for the room's list, for the row picked), whose Profile opens their
	// card beside the row.
	let voiceMenuFor = $state.raw<{ user: VoiceUser; row: HTMLElement } | null>(null);
	let voiceProfile = $state.raw<{ member: MemberOnSidebar; anchor: HTMLElement } | null>(null);
	function pickVoiceUser(e: MouseEvent, people: VoiceUser[]): boolean {
		const row = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-member-id]") : null;
		const user = row ? people.find((u) => u.id === row.dataset.memberId) : undefined;
		if (!row || !user) return false;
		voiceMenuFor = { user, row };
		return true;
	}
	// Who the menu is about: the Space's member, with their member ID once a page of members has brought it, or else
	// their name as the room shows it.
	function voicePerson(user: VoiceUser) {
		const member = space ? spaceMember(space, user.id) : null;
		return personOf(member ?? { id: user.id, member_id: "", username: user.username, is_bot: false }, space ?? null);
	}
	let showCreateModal = $state(false);
	let newChannelName = $state("");
	let newChannelType = $state<RoomType>(1);
	let newChannelCategory = $state<string | null>(null);
	let isCreating = $state(false);
	let roomNameField = $state<HTMLInputElement | null>(null);

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

	// The rooms in the column's order (roomColumn), which a click on the Space follows too: those in no category, then
	// each category with its rooms.
	const column = $derived(roomColumn(channels));
	const categories = $derived(column.categories.map((c) => c.category));
	$effect(() => {
		categories.forEach((cat) => {
			if (expanded[cat.id] === undefined) expanded[cat.id] = true;
		});
	});

	type SidebarItem = { kind: "channel"; channel: Channel; indent: boolean } | { kind: "category"; channel: Channel };

	const sidebarItems = $derived([
		...column.topLevel.map(
			(ch): SidebarItem => ({
				kind: "channel",
				channel: ch,
				indent: false,
			}),
		),
		...column.categories.flatMap(({ category: cat, rooms }): SidebarItem[] => [
			{ kind: "category", channel: cat },
			// A folded category still shows the room the focused pane is in.
			...(expanded[cat.id] ? rooms : rooms.filter((ch) => ch.id === activeChannelId)).map(
				(ch): SidebarItem => ({
					kind: "channel",
					channel: ch,
					indent: true,
				}),
			),
		]),
	] as SidebarItem[]);

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
			if (!targetItem || srcId === targetItem.channel.id) return;

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
	// It's a shadow-duvet-raised in the gap between rooms: a border would add its width to the wrapper's height and shift the rows.
	function roomDropIndicatorClass(idx: number): string {
		if (dropTargetIdx !== idx || !draggedChannelId) return "";
		if (dropPosition === "above") return "rounded-lg shadow-[0_-2px_0_0_var(--duvet-accent)]";
		if (dropPosition === "below") return "rounded-lg shadow-[0_2px_0_0_var(--duvet-accent)]";
		return "";
	}

	function selectChannel(channel: Channel, how: OpenHow = "here") {
		if (channel.type !== "category") {
			onSelect(channel.id, how);
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
			const channel = clickableChannels[i];
			if (channel) selectChannel(channel);
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

	onMount(() => {
		// ensure first button is focusable for keyboard users
		const firstBtn = buttons.at(0);
		if (firstBtn) firstBtn.tabIndex = 0;
	});
</script>

<!-- The rooms hang from the Space's row on a guide line, and the sidebar scrolls them. -->
<div class="border-duvet-sb-edge text-duvet-ink mb-1 ml-[9px] flex flex-col border-l pb-1 pl-[3px]" role="list">
	{#if sidebarItems.length === 0}
		<p class="text-duvet-ink2 px-3 py-1.5 text-[13px]">No rooms you can see yet</p>
	{/if}
	{#each sidebarItems as item, itemIdx}
		{#if item.kind === "category"}
			{@const categoryRoom = space?.rooms.find((r) => r.id === item.channel.id)}
			{@const canManageCategory =
				space && categoryRoom ? hasPermission(space, categoryRoom, Permission.ManageChannels) : false}
			<ContextMenu>
				{#snippet target(props)}
					<button
						{...props}
						type="button"
						class="text-duvet-ink2 hover:text-duvet-ink focus-visible:outline-duvet-accent flex h-[26px] w-full shrink-0 items-end gap-1 rounded-md border-0 bg-transparent pr-2 pl-3 text-left text-[10.5px] leading-[18px] font-semibold tracking-[0.06em] uppercase focus-visible:outline-2 focus-visible:-outline-offset-2 {dropIndicatorClass(
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
						<span class="truncate">{item.channel.name}</span>
						<ChevronDownIcon
							class="mb-1 size-2.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none {expanded[
								item.channel.id
							]
								? ''
								: '-rotate-90'}"
							aria-hidden="true"
						/>
					</button>
				{/snippet}
				<MenuItem icon={CopySimpleIcon} onSelect={() => navigator.clipboard.writeText(item.channel.id)}>
					Copy room ID
				</MenuItem>
				{#if canManageCategory}
					<MenuItem icon={PencilIcon} onSelect={() => openChannelSettings(item.channel)}>Edit category</MenuItem>
					<MenuSeparator />
					<MenuItem icon={TrashSimpleIcon} danger onSelect={() => (confirmDeleteChannel = item.channel)}>
						Delete category
					</MenuItem>
				{/if}
			</ContextMenu>
		{:else}
			{@const channel = item.channel}
			{@const buttonIndex = clickableChannels.findIndex((c) => c.id === channel.id)}
			{@const room = space?.rooms.find((r) => r.id === channel.id)}
			{@const canManage = space && room ? hasPermission(space, room, Permission.ManageChannels) : false}
			{@const canJoin = channel.type !== "voice" || (space && room && hasPermission(space, room, Permission.JoinVoice))}
			{@const isUnread =
				channel.type === "text" && ($shownUnreadRooms.has(channel.id) || !!$shownMentionCounts[channel.id])}
			{@const voiceCount = channel.voiceUsers?.length ?? 0}
			{@const typers = channel.type === "text" ? $typingNow[channel.id] : undefined}
			{@const typing = typingSentence(typers)}
			{@const isActive = channel.id === activeChannelId}
			<!-- The voice room the user is in reads as live. -->
			{@const connected = channel.type === "voice" && $activeVoiceRoomId === channel.id}
			<div role="listitem" class="group/channel {roomDropIndicatorClass(itemIdx)}">
				<ContextMenu>
					{#snippet target(props)}
						<button
							{...props}
							class="focus-visible:outline-duvet-accent flex h-[30px] w-full items-center gap-[7px] rounded-[9px] pr-2 pl-3 text-left text-[13.5px] transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 motion-reduce:transition-none
							{isActive ? 'bg-duvet-accent-tint text-duvet-ink' : 'hover:bg-duvet-sb-hover'}
							{connected
								? 'text-duvet-alive-text font-semibold'
								: isUnread
									? 'text-duvet-ink font-semibold'
									: isActive
										? 'font-medium'
										: 'text-duvet-ink2 hover:text-duvet-ink font-medium'}
							{!canJoin ? 'cursor-not-allowed opacity-50' : ''}"
							aria-pressed={isActive}
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
							onclick={(e) => canJoin && selectChannel(channel, openHow(e, mac))}
							onauxclick={(e) => e.button === 1 && canJoin && selectChannel(channel, "tab")}
							ondblclick={() => canJoin && channel.type === "voice" && joinVoiceChannel(channel)}
							onkeydown={(e) => canJoin && onKeyDown(e, buttonIndex)}
							use:register={buttonIndex}
						>
							<span
								class="relative shrink-0 {channel.type === 'voice' && voiceCount > 0
									? 'text-duvet-alive-text'
									: isUnread || isActive || connected
										? ''
										: 'opacity-75'}"
							>
								{#if typers}
									<TypingMark users={typers} />
								{:else if channel.type === "text"}
									<HashIcon class="size-[15px]" />
								{:else if channel.type === "voice"}
									<SpeakerSimpleHighIcon class="size-[15px]" />
									{#if !canJoin}
										<LockSimpleIcon
											class="bg-duvet-sb-ring text-duvet-danger absolute -right-2 -bottom-1 size-3.5 rounded-full"
										/>
									{/if}
								{/if}
							</span>
							<span class="min-w-0 flex-1 truncate">{channel.name}</span>
							{#if typing}<span class="sr-only">{typing}</span>{/if}
							{#if channel.type === "text" && $shownMentionCounts[channel.id]}
								<span
									class="{countBadgeClass()} ml-1"
									role="img"
									aria-label={mentionsLabel($shownMentionCounts[channel.id] ?? 0)}
									>{chipCount($shownMentionCounts[channel.id] ?? 0)}</span
								>
							{:else if voiceCount > 0}
								<span class="text-duvet-ink2 ml-1 shrink-0 text-[11.5px] font-normal">{voiceCount} in voice</span>
							{/if}
						</button>
					{/snippet}
					<MenuItem
						icon={AppWindowIcon}
						keys={keysFor(mac, SHELL_KEYS.openInTab)}
						disabled={!canJoin}
						onSelect={() => selectChannel(channel, "tab")}>Open in new tab</MenuItem
					>
					<MenuItem
						icon={ColumnsIcon}
						keys={keysFor(mac, SHELL_KEYS.openBeside)}
						disabled={!canJoin}
						onSelect={() => selectChannel(channel, "beside")}>Open beside</MenuItem
					>
					<MenuSeparator />
					<MenuItem icon={CopySimpleIcon} onSelect={() => navigator.clipboard.writeText(channel.id)}>
						Copy room ID
					</MenuItem>
					<!-- The API creates an invite for CreateInvites in the room, overwrites included -->
					{#if channel.type !== "category" && space && room && hasPermission(space, room, Permission.CreateInvites)}
						<MenuItem icon={LinkSimpleIcon} onSelect={() => openInviteModal(channel)}>Invite people</MenuItem>
					{/if}
					<!-- Only text rooms hold messages to notify of; their default is their space's level. -->
					{#if channel.type === "text"}
						<NotificationSubmenu
							targetId={channel.id}
							target={1}
							inherited={spaceLevel($notificationLevels, guild.id, space?.default_notifications)}
							itemClass={menuItemClass()}
							contentClass={MENU_PANEL}
						/>
					{/if}
					{#if canManage}
						<MenuSeparator />
						<MenuItem icon={GearSixIcon} onSelect={() => openChannelSettings(channel)}>Room settings</MenuItem>
						<MenuItem icon={TrashSimpleIcon} danger onSelect={() => (confirmDeleteChannel = channel)}>
							Delete room
						</MenuItem>
					{/if}
				</ContextMenu>
				<!-- Who's in the voice room, under its row, each with their member menu on a right-click -->
				{#if channel.type === "voice" && channel.voiceUsers && channel.voiceUsers.length > 0}
					{@const people = channel.voiceUsers}
					<ContextMenu label="Member">
						{#snippet target(props)}
							<div
								{...withoutLongPress(props)}
								class="flex flex-col pb-0.5 pl-[30px]"
								oncontextmenu={(e) => {
									if (pickVoiceUser(e, people)) (props.oncontextmenu as ((e: MouseEvent) => void) | undefined)?.(e);
								}}
							>
								{@render voicePeople(people)}
							</div>
						{/snippet}
						{#if voiceMenuFor}
							{@const { user, row } = voiceMenuFor}
							{@const member = space ? spaceMember(space, user.id) : null}
							<MemberMenu
								person={voicePerson(user)}
								space={space ?? null}
								onProfile={member ? () => (voiceProfile = { member, anchor: row }) : undefined}
							/>
						{/if}
					</ContextMenu>
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

<!-- A voice room's people, each a row the member menu reads (data-member-id) -->
{#snippet voicePeople(people: VoiceUser[])}
	{#each people as user (user.id)}
		{@const isSharing = user.screen_sharing ?? false}
		{@const isSpeaking = $speakingUsers.has(user.id) && !user.muted}
		<div
			data-member-id={user.id}
			class="flex h-[26px] items-center gap-[7px] rounded-lg px-1.5 text-[12.5px] font-medium {isSpeaking
				? 'text-duvet-ink'
				: 'text-duvet-ink2'}"
		>
			<UserAvatar
				src={user.avatar_url}
				name={user.username}
				size={20}
				class="box-border shrink-0 rounded-full transition-shadow duration-200 motion-reduce:transition-none {isSpeaking
					? 'ring-duvet-alive ring-2'
					: ''}"
			/>
			<span class="min-w-0 flex-1 truncate">{user.username}</span>
			<div class="flex shrink-0 items-center gap-1">
				{#if isSharing}
					<span
						class="bg-duvet-call-red text-duvet-on-call-red rounded-[5px] px-[5px] py-[3px] text-[9px] leading-none font-bold tracking-wide uppercase"
						role="img"
						aria-label="Sharing their screen">Live</span
					>
				{/if}
				{#if user.camera}
					<VideoIcon class="size-3" role="img" aria-label="Camera on" />
				{/if}
				{#if user.muted}
					<MicrophoneSlashIcon class="text-duvet-danger size-3" role="img" aria-label="Muted" />
				{/if}
				{#if user.deafened}
					<HeadphonesIcon class="text-duvet-danger size-3" role="img" aria-label="Deafened" />
				{/if}
			</div>
		</div>
	{/each}
{/snippet}

<!-- A voice room person's card, from their menu's Profile, beside their row -->
{#if voiceProfile && space}
	<MemberProfilePopover
		member={voiceProfile.member}
		spaceId={space.id}
		{space}
		side="right"
		open
		anchor={voiceProfile.anchor}
		onOpenChange={(isOpen) => {
			if (!isOpen) voiceProfile = null;
		}}
	/>
{/if}

<ServerSettings bind:open={showServerSettings} space={space ?? null} spaceId={guild.id} />

<!-- Create room: its kind, its category (a category has none) and its name. Enter in the name creates it. -->
<Sheet
	bind:open={showCreateModal}
	title="Create room"
	class="max-w-[400px]"
	onOpenAutoFocus={(e) => {
		e.preventDefault();
		roomNameField?.focus();
	}}
>
	<div class="flex flex-col gap-1.5">
		<label for="channelType" class={FIELD_LABEL}>Room type</label>
		<select id="channelType" bind:value={newChannelType} class="{SELECT} h-[38px]! w-full max-w-none!">
			<option value={1}>Text room</option>
			<option value={2}>Voice room</option>
			<option value={3}>Category</option>
		</select>
	</div>

	{#if newChannelType !== 3}
		<div class="flex flex-col gap-1.5">
			<label for="channelCategory" class={FIELD_LABEL}>Category</label>
			<select id="channelCategory" bind:value={newChannelCategory} class="{SELECT} h-[38px]! w-full max-w-none!">
				<option value={null}>None</option>
				{#each categories as category}
					<option value={category.id}>{category.name}</option>
				{/each}
			</select>
		</div>
	{/if}

	<div class="flex flex-col gap-1.5">
		<label for="channelName" class={FIELD_LABEL}>Room name</label>
		<div class="relative">
			<span
				class="text-duvet-ink2 pointer-events-none absolute top-1/2 left-3 grid -translate-y-1/2"
				aria-hidden="true"
			>
				{#if newChannelType === 1}
					<HashIcon size={15} />
				{:else}
					<SpeakerSimpleHighIcon size={15} />
				{/if}
			</span>
			<input
				id="channelName"
				type="text"
				bind:this={roomNameField}
				bind:value={newChannelName}
				class="{fieldClass()} pl-9"
				placeholder="new-room"
				maxlength={64}
				onkeydown={(e) => e.key === "Enter" && handleCreateChannel()}
			/>
		</div>
	</div>

	{#snippet foot()}
		<span></span>
		<Button variant="quiet" onclick={() => (showCreateModal = false)}>Cancel</Button>
		<Button onclick={handleCreateChannel} disabled={!newChannelName.trim() || isCreating}>Create room</Button>
	{/snippet}
</Sheet>

<!-- Delete room: asked first. While it's being deleted the question stays, and can't be dismissed. -->
<Dialog
	bind:open={
		() => !!confirmDeleteChannel,
		(v) => {
			if (!v && !isDeletingChannel) confirmDeleteChannel = null;
		}
	}
	title="Delete room"
	escapeKeydownBehavior={isDeletingChannel ? "ignore" : "close"}
>
	Delete <span class="text-duvet-ink font-semibold">#{confirmDeleteChannel?.name}</span>? This can't be undone.
	{#snippet actions()}
		<Button variant="quiet" disabled={isDeletingChannel} onclick={() => (confirmDeleteChannel = null)}>Cancel</Button>
		<Button variant="danger" disabled={isDeletingChannel} onclick={handleDeleteChannel}>Delete</Button>
	{/snippet}
</Dialog>

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
