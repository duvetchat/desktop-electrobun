<script lang="ts">
	import { activeCall, conversations, currentUser, typingNow } from "$lib/stores.svelte";
	import { quietPlaces, shownMentionCounts, shownUnreadConversations, shownUnreadRooms } from "$lib/notification-marks";
	import { get } from "svelte/store";
	import {
		AppWindow as AppWindowIcon,
		BellOff as BellOffIcon,
		ChevronDown as ChevronDownIcon,
		ChevronUp as ChevronUpIcon,
		Columns2 as ColumnsIcon,
		PhoneCall as PhoneCallIcon,
	} from "@lucide/svelte";
	import GroupMark from "$lib/components/GroupMark.svelte";
	import NotificationSubmenu from "$lib/components/NotificationSubmenu.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import type { Conversation } from "$lib/api/conversations";
	import { getAvatarURL } from "$lib/common/common";
	import { getUserMobileOnly, getUserOnlineStatus } from "$lib/api/ws/connection";
	import { userStatusToString, type MemberOnSidebar } from "$lib/types";
	import { conversationTab, otherMember, tabDragData, tabNews } from "$lib/pane";
	import {
		chatsUnderAll,
		chipCount,
		keysFor,
		mentionsLabel,
		moreChatsLabel,
		openHow,
		SHELL_KEYS,
		type OpenHow,
	} from "$lib/shell-layout";
	import { typingSentence } from "$lib/typing";
	import Avatar from "$lib/components/ui/Avatar.svelte";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";
	import { countBadgeClass, MENU_PANEL, menuItemClass } from "$lib/components/ui/recipes";

	// The sidebar's chats (#357, S-05): the user's direct messages and groups, the one with the latest message first.
	// Under All (`folded`) the six latest show, with any unread one and the open one, then a row for the rest; under
	// Chats they all do. A click opens a chat in the current tab, ⌘-click or a middle click in a new one, ⌥-click beside;
	// its right click has the same, and its notifications.
	let {
		activeConversationId = null,
		onSelect,
		folded = false,
		mac = false,
	}: {
		activeConversationId?: string | null;
		onSelect: (id: string, how: OpenHow) => void;
		/** Lists the six latest with the unread and the open ones, and folds the rest behind "N more chats". */
		folded?: boolean;
		/** Whose keys the menu's hints name: ⌘-click on macOS, Ctrl-click elsewhere. */
		mac?: boolean;
	} = $props();

	function convTitle(conv: Conversation): string {
		const me = get(currentUser);
		if (conv.type === 2) return conv.name ?? "Group";
		const other = conv.members.find((m) => m.user_id !== me?.id);
		return other?.user?.alias ?? other?.user?.username ?? "Direct message";
	}

	function convSubtitle(conv: Conversation): string {
		if (conv.type === 2) return conv.members.length === 1 ? "1 member" : `${conv.members.length} members`;
		return "Direct message";
	}

	// The other member's status, in a DM (a group has none), offline included, as the member list shows it, and whether
	// they're connected only from the mobile app. Statuses come through spaces, friendships and conversations, so someone
	// who is neither our friend nor in a space with us shows theirs too.
	function convStatus(conv: Conversation): { status: MemberOnSidebar["status"]; mobileOnly: boolean } | null {
		if (conv.type === 2) return null;
		const other = conv.members.find((m) => m.user_id !== get(currentUser)?.id);
		if (!other) return { status: "offline", mobileOnly: false };
		return {
			status: userStatusToString(getUserOnlineStatus(other.user_id)),
			mobileOnly: getUserMobileOnly(other.user_id),
		};
	}

	// Under All: the six latest, and whatever else must stay in sight; "N more chats" shows them all.
	let expanded = $state(false);
	const unreadIds = $derived(
		new Set([
			...$shownUnreadConversations,
			...Object.keys($shownMentionCounts).filter((id) => $shownMentionCounts[id]),
		]),
	);
	const listed = $derived(
		folded
			? chatsUnderAll($conversations, (id) => unreadIds.has(id) || id === activeConversationId, expanded)
			: { shown: $conversations, more: 0 },
	);
</script>

<div class="flex flex-col" role="group" aria-label="Chats">
	{#each listed.shown as conv (conv.id)}
		{@const shown = convStatus(conv)}
		<!-- A DM shows the other person; a group, which has no picture, its mark, as its tab does (#376) -->
		{@const other = otherMember(conv, $currentUser?.id)}
		<!-- Its unread state and the mentions waiting in it, as its tab shows them: a mention leaves it unread. -->
		{@const news = tabNews(
			conversationTab(conv, $currentUser?.id),
			$shownUnreadRooms,
			$shownUnreadConversations,
			$shownMentionCounts,
		)}
		{@const unread = news.unread}
		{@const isActive = activeConversationId === conv.id}
		{@const muted = $quietPlaces.has(conv.id)}
		{@const typing = typingSentence($typingNow[conv.id])}
		{@const inCall = $activeCall?.state === "connected" && $activeCall.conversationId === conv.id}
		<!-- Its right click opens it elsewhere, and chooses its notifications. -->
		<ContextMenu>
			{#snippet target(props)}
				<button
					{...props}
					class="focus-visible:outline-duvet-accent flex h-[50px] w-full shrink-0 items-center gap-2.5 rounded-xl pr-2.5 pl-2 text-left transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 motion-reduce:transition-none
				{isActive ? 'bg-duvet-accent-tint' : 'hover:bg-duvet-sb-hover'}"
					aria-current={isActive ? "true" : undefined}
					data-jump
					onclick={(e) => onSelect(conv.id, openHow(e, mac))}
					onauxclick={(e) => e.button === 1 && onSelect(conv.id, "tab")}
					draggable="true"
					ondragstart={(e) => {
						// Dragged onto a pane or a tab, it opens there as a tab, or splits it, as a room does.
						e.dataTransfer!.effectAllowed = "copyMove";
						e.dataTransfer!.setData("text/plain", tabDragData(conversationTab(conv, get(currentUser)?.id)));
					}}
				>
					<Avatar size={32} status={shown?.status} mobileOnly={shown?.mobileOnly} ring="var(--duvet-sb-ring)">
						{#if other}
							<UserAvatar src={getAvatarURL(other.user_id, other.user?.avatar)} name={convTitle(conv)} size={32} />
						{:else}
							<GroupMark size={32} />
						{/if}
					</Avatar>
					<span class="flex min-w-0 flex-1 flex-col gap-px">
						<span class="flex min-w-0 items-center gap-1.5">
							<span
								class="truncate text-[13.5px] leading-tight {unread
									? 'text-duvet-ink font-bold'
									: muted
										? 'text-duvet-ink2 font-medium'
										: 'text-duvet-ink font-medium'}">{convTitle(conv)}</span
							>
							{#if muted}
								<BellOffIcon class="text-duvet-ink2 size-[11px] shrink-0" role="img" aria-label="Notifications off" />
							{/if}
						</span>
						{#if inCall}
							<span
								class="text-duvet-alive-text flex min-w-0 items-center gap-1 text-[12.5px] leading-[1.3] font-semibold"
							>
								<PhoneCallIcon class="size-3 shrink-0" aria-hidden="true" />
								<span class="truncate">In a call</span>
							</span>
						{:else}
							<span
								class="truncate text-[12.5px] leading-[1.3] {typing
									? 'text-duvet-chosen-ink font-medium'
									: unread
										? 'text-duvet-ink'
										: 'text-duvet-ink2'}">{typingSentence($typingNow[conv.id]) ?? convSubtitle(conv)}</span
							>
						{/if}
					</span>
					{#if news.mentions}
						<!-- Its mentions, as a room's row counts them -->
						<span class={countBadgeClass()} role="img" aria-label={mentionsLabel(news.mentions)}
							>{chipCount(news.mentions)}</span
						>
					{:else if unread}
						<span class="bg-duvet-accent size-2 shrink-0 rounded-full" role="img" aria-label="Unread"></span>
					{/if}
				</button>
			{/snippet}
			<MenuItem icon={AppWindowIcon} keys={keysFor(mac, SHELL_KEYS.openInTab)} onSelect={() => onSelect(conv.id, "tab")}
				>Open in new tab</MenuItem
			>
			<MenuItem
				icon={ColumnsIcon}
				keys={keysFor(mac, SHELL_KEYS.openBeside)}
				onSelect={() => onSelect(conv.id, "beside")}>Open beside</MenuItem
			>
			<MenuSeparator />
			<NotificationSubmenu targetId={conv.id} target={2} itemClass={menuItemClass()} contentClass={MENU_PANEL} />
		</ContextMenu>
	{/each}

	{#if $conversations.length === 0}
		<p class="text-duvet-ink2 px-2.5 py-2 text-[13px]">No chats yet</p>
	{/if}

	{#if folded && listed.more > 0}
		<button
			type="button"
			class="text-duvet-ink2 hover:text-duvet-ink focus-visible:outline-duvet-accent flex h-7 w-full items-center gap-2 rounded-lg pr-2.5 pl-[17px] text-left text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2"
			aria-expanded={expanded}
			data-jump
			onclick={() => (expanded = !expanded)}
		>
			{#if expanded}
				<ChevronUpIcon class="size-[13px] shrink-0" aria-hidden="true" />Show fewer
			{:else}
				<ChevronDownIcon class="size-[13px] shrink-0" aria-hidden="true" />{moreChatsLabel(listed.more)}
			{/if}
		</button>
	{/if}
</div>
