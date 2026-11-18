<script lang="ts" module>
	// Which sends failed in the rooms, by nonce: a room's Chat goes when a pane shows a conversation and on a READY,
	// while the message stays in its room's list, for its Retry when the room shows again.
	let failedRoomSends = $state(new Set<string>());
</script>

<script lang="ts">
	import {
		activeVoiceRoomId,
		channelMessages,
		ephemeralMessages,
		gatewaySpaces,
		jumpToMessageRequest,
		unreadChannels,
		activeTextRoomId,
		lastReadRooms,
		lastMsgRooms,
		pageVisible,
		mentionCounts,
		conversations,
		currentUser,
		spaceEmojis,
		friendsReady,
		LIST_ON_SCREEN_MAX,
		MESSAGE_PAGE,
	} from "$lib/stores.svelte";
	import { get } from "svelte/store";
	import { showChat } from "$lib/on-screen";
	import {
		closeTabsIn,
		conversationTab,
		isConversationTab,
		makeSplit,
		makeLeaf,
		tabDescription,
		tabFromDragData,
		tabTitle,
	} from "$lib/pane";
	import { getMessages, getMessagesAfter, getMessageById, ackRoom } from "$lib/api/messages";
	import {
		dividerPastWindow,
		inWindow,
		keepRoomJumps,
		leaving,
		loadedTo,
		readWhenLeft,
		takeJump,
		withPresent,
	} from "$lib/jumps";
	import { onMount, onDestroy, tick, untrack, type Snippet } from "svelte";

	import type { MemberOnSidebar, GatewaySpace, PaneNode, Guild, Tab } from "$lib/types";

	import { gatewayMessageToMessage, gatewaySpaceToMembers, isEphemeral, roomTypeToChannelType } from "$lib/types";
	import { userStatusCache } from "$lib/api/ws/connection";
	// A pane holds panes: Svelte 5 renders a component inside itself by importing it.
	// oxlint-disable-next-line import/no-self-import
	import PaneView from "$lib/components/PaneView.svelte";
	import ConversationView from "$lib/components/ConversationView.svelte";
	import TabIcon from "$lib/components/TabIcon.svelte";
	import Chat from "$lib/components/Chat.svelte";
	import VoiceChannelView from "$lib/components/VoiceChannelView.svelte";
	import MembersButton from "$lib/components/MembersButton.svelte";
	import MessageSearch from "$lib/components/MessageSearch.svelte";
	import PinnedMessages from "$lib/components/PinnedMessages.svelte";
	import {
		AppWindow as AppWindowIcon,
		Columns2 as ColumnsIcon,
		Ellipsis as EllipsisIcon,
		Hash,
		Rows2 as RowsIcon,
		UserPlus,
		Volume2 as SpeakerIcon,
		X as XIcon,
	} from "@lucide/svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { typingNow } from "$lib/stores.svelte";
	import { typingSentence } from "$lib/typing";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Menu from "$lib/components/ui/Menu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";
	import { iconButtonClass } from "$lib/components/ui/recipes";
	import ChatIntro from "$lib/components/ChatIntro.svelte";
	import EmptyPane from "$lib/components/EmptyPane.svelte";
	import InviteModal from "$lib/components/InviteModal.svelte";
	import { hasPermission, Permission } from "$lib/permissions";

	// ── Props ──────────────────────────────────────────────────────────────────
	let {
		node,
		onUpdate,
		onMoveTab = null,
		onClose = null,
		guild,
		spaceId,
		space,
		members,
		focusedPaneId,
		onFocus,
		isActive = true,
	}: {
		node: PaneNode;
		onUpdate: (n: PaneNode) => void;
		onMoveTab?:
			| ((
					tab: Tab,
					sourceLeafId: string,
					targetLeafId: string,
					zone: "bottom" | "right" | "left" | "top" | null,
			  ) => void)
			| null;
		onClose?: (() => void) | null;
		guild: Guild | null;
		spaceId: string | null;
		space: GatewaySpace | null;
		members: MemberOnSidebar[];
		focusedPaneId: string | null;
		onFocus: (id: string) => void;
		isActive?: boolean;
	} = $props();

	// ── Leaf: message loading ─────────────────────────────────────────────────
	const loadedChannels = new Set<string>();
	const fetchingChannels = new Set<string>();
	let isLoadingMore = $state(false);
	let isLoadingMoreBelow = $state(false);
	let channelHasMore = $state<Partial<Record<string, boolean>>>({});
	let channelHasMoreBelow = $state<Partial<Record<string, boolean>>>({});
	// After a jump, where a room's next page below starts: after the newest message the jump's pages have loaded, never
	// after one that came meanwhile (another member's, or one the user sent), whose messages before it would never load.
	let channelLoadedBelowTo = $state<Partial<Record<string, string>>>({});
	// When a room's last page above or below failed: the page is asked for again on a scroll there once RETRY_WAIT has
	// passed (the list also scrolls by itself, which must not ask again at once), rather than taken for the end.
	const aboveFailedAt = new Map<string, number>();
	const belowFailedAt = new Map<string, number>();
	const RETRY_WAIT = 2_000;
	// A room's jumps so far: what an earlier jump, or a page asked for before the latest one, fetched is dropped.
	const channelJumps = new Map<string, number>();
	// A room's page below while it's asked for, which a jump aborts.
	const belowRequests = new Map<string, AbortController>();
	// The pane going (a READY remounts the app, or the pane closes) leaves its rooms' jumps for the next view of them.
	onDestroy(() => keepRoomJumps(channelHasMoreBelow, channelHasMore, channelLoadedBelowTo));
	let channelInitialLoading = $state<Partial<Record<string, boolean>>>({});
	// Rooms whose first page failed, with nothing of them loaded since: the list says so, with Try again, rather than
	// showing the room's start.
	let channelLoadFailed = $state<Partial<Record<string, boolean>>>({});
	let channelHighlightedMessage = $state<Partial<Record<string, string | null>>>({});
	// last-read message ID per channel, used to render the unread divider
	let channelUnreadAfter = $state<Partial<Record<string, string | null>>>({});
	let paneIsAtBottom = $state(false);
	let inviteOpen = $state(false);
	// Plain let (not $state) to avoid self-reactive mutation in $effect
	let lastAckChannelId: string | null = null;
	// Non-reactive dedup map — prevents sending the same ACK twice. It also sets the divider on re-entry,
	// without making that effect rerun on every ack.
	const ackedMsgIds = new Map<string, string>();
	// track handled jump request ids to avoid double-processing
	let lastHandledJumpId = $state<string | null>(null);

	// A room this pane hasn't fetched yet counts as loading from its first render: the fetch below starts after it,
	// and a list placed on the messages already in the store would keep that place behind the skeleton (a pane
	// mounted again for a new gateway session).
	const isInitialLoading = $derived(
		!!(
			node.kind === "leaf" &&
			node.activeChannelId &&
			(channelInitialLoading[node.activeChannelId] ?? !loadedChannels.has(node.activeChannelId))
		),
	);
	// Returns true when the channel still has older messages to load.
	// Must use !== false because undefined means "not yet determined" (has more).
	function channelStillHasMore(channelId: string): boolean {
		return channelHasMore[channelId] !== false;
	}

	// The room's messages, and the ephemeral ones bots sent this user there, which show among them though no
	// history has them.
	const activeMessages = $derived.by(() => {
		if (node.kind !== "leaf" || !node.activeChannelId) return [];
		const channelId = node.activeChannelId;
		const all = $channelMessages[channelId] ?? [];
		// While newer messages are still to load below a jump's pages, what came live past them waits for the pages.
		const history =
			channelHasMoreBelow[channelId] === true ? inWindow(all, channelLoadedBelowTo[channelId] ?? "") : all;
		const ephemeral = $ephemeralMessages[channelId];
		return ephemeral?.length ? [...history, ...ephemeral] : history;
	});

	// Derive channel/space/members from the active tab's own spaceId,
	// so tabs from different servers always show the correct data.
	const activeTab = $derived(
		node.kind === "leaf" && node.activeChannelId
			? (node.tabs.find((t) => t.channelId === node.activeChannelId) ?? null)
			: null,
	);
	const activeTabSpace = $derived(
		activeTab?.spaceId ? ($gatewaySpaces.find((s) => s.id === activeTab.spaceId) ?? null) : null,
	);
	const activeTabMembers = $derived(activeTabSpace ? gatewaySpaceToMembers(activeTabSpace, userStatusCache) : members);
	const activeRoomDescription = $derived(tabDescription(activeTab, $gatewaySpaces));
	// Channel info comes directly from the tab — no cross-guild lookup needed.
	// A conversation's tab shows the conversation, as the friends view did; one that left the list (the user left the
	// group) shows nothing until the page drops its tab.
	const activeConversation = $derived(
		activeTab && isConversationTab(activeTab)
			? ($conversations.find((c) => c.id === activeTab.channelId) ?? null)
			: null,
	);

	const activeChannel = $derived(
		activeTab
			? {
					id: activeTab.channelId,
					name: activeTab.channelName,
					type: activeTab.channelType,
				}
			: null,
	);
	// Whether the active room is one its space lists: the gateway takes away a room the user can no longer view
	// (ROOM_DELETE, its loaded messages with it) and gives it back (ROOM_CREATE). A space not loaded yet doesn't count.
	const activeRoomListed = $derived(
		!activeTab || !activeTabSpace || activeTabSpace.rooms.some((r) => r.id === activeTab.channelId),
	);

	// The newest confirmed (non-pending) message of the room: an ephemeral one isn't the room's, which the read
	// state is about. UUIDv7 IDs compare by time as strings.
	function newestConfirmedId(msgs: { id: string; nonce?: string | null; flags?: number }[]): string | null {
		let newestId: string | null = null;
		for (const m of msgs) {
			if (m.id === m.nonce || isEphemeral(m)) continue;
			if (!newestId || m.id > newestId) newestId = m.id;
		}
		return newestId;
	}

	// Acks the channel's newest confirmed message, unless that one already was, and clears its unread
	// badge and mention count.
	function ackNewest(channelId: string, msgs: { id: string; nonce?: string | null }[]) {
		const newestId = newestConfirmedId(msgs);
		if (!newestId || newestId === ackedMsgIds.get(channelId)) return;
		ackedMsgIds.set(channelId, newestId);
		unreadChannels.update((s) => {
			s.delete(channelId);
			return s;
		});
		mentionCounts.update((all) => {
			const copy = { ...all };
			delete copy[channelId];
			return copy;
		});
		ackRoom(channelId, newestId).catch((err) => console.error("[ack] network error:", err));
	}

	// ACK when leaving the channel (channel switch, the Friends view hiding the pane, unmount) — only if
	// at bottom. It comes before the effect below, which resets paneIsAtBottom for the next channel:
	// Svelte reruns effects in order, and this cleanup has to read the value of the channel being left.
	// Only the bottom reads a channel, not opening it, and only the bottom of a list that reaches the room's newest
	// message: a jump's pages, with newer messages still to load below, are no sign of having read those (leaving). One
	// left read through loses its unread divider: the next visit opens at the bottom, unless new messages came meanwhile.
	// One left above its newest messages keeps its divider, and is unread again in the sidebar, as the server still has
	// it.
	$effect(() => {
		const channelId = isActive && node.kind === "leaf" ? node.activeChannelId : null;
		return () => {
			if (!channelId) return;
			const msgs = get(channelMessages)[channelId] ?? [];
			const left = leaving(
				{
					atBottom: paneIsAtBottom,
					newest: newestConfirmedId(msgs) ?? "",
					moreBelow: channelHasMoreBelow[channelId] === true,
					loadedBelowTo: channelLoadedBelowTo[channelId] ?? "",
				},
				channelUnreadAfter[channelId],
				ackedMsgIds.get(channelId),
				get(lastReadRooms)[channelId],
			);
			if (left.ack) ackNewest(channelId, msgs);
			if (!left.unread) {
				if (channelUnreadAfter[channelId]) channelUnreadAfter[channelId] = null;
			} else {
				unreadChannels.update((s) => {
					s.add(channelId);
					return s;
				});
			}
		};
	});

	// Track the active text room globally so MESSAGE_CREATE can skip adding it to unread.
	// Also detects re-entry into an already-loaded channel that received new messages while away.
	$effect(() => {
		if (isActive && node.kind === "leaf" && node.activeChannelId && activeChannel?.type === "text") {
			const channelId = node.activeChannelId;
			// Reset immediately so the ACK effect (which runs after this one in
			// the same batch) cannot use a stale true from the previous channel.
			// The sync effect in MessageList will set the correct value later.
			paneIsAtBottom = false;
			activeTextRoomId.set(channelId);
			// Check for unread BEFORE clearing the badge (get() is a non-reactive snapshot)
			const hadUnread = get(unreadChannels).has(channelId);
			unreadChannels.update((s) => {
				s.delete(channelId);
				return s;
			});
			// Set the unread divider position (re-entry only — first entry is
			// handled in the load effect's .then() where we have real messages).
			// A channel loaded while the pane was hidden has no ack of this session: READY has its read position.
			if (hadUnread && loadedChannels.has(channelId)) {
				const lastRead = ackedMsgIds.get(channelId) ?? get(lastReadRooms)[channelId] ?? get(lastMsgRooms)[channelId];
				if (lastRead) channelUnreadAfter[channelId] = lastRead;
			}
		} else {
			activeTextRoomId.set(null);
		}
	});

	// The room this pane shows is on screen while the panes show (lib/on-screen.ts): every pane's, a split's included,
	// which activeTextRoomId, written by each pane's effect in turn, can't tell. A voice room's view counts too: its
	// tiles show the streams, so the floating window stays away while it shows (desktop#299).
	$effect(() => {
		if (
			isActive &&
			node.kind === "leaf" &&
			node.activeChannelId &&
			(activeChannel?.type === "text" || activeChannel?.type === "voice")
		)
			return showChat(node.activeChannelId);
	});

	// The room's list stays in the store while this pane has the room, shown or under the Friends view, whose panes keep
	// their chats mounted (#320).
	// Only when the room shown changes, or the pane goes: not each time the pane's node is made anew.
	const heldRoom = $derived(node.kind === "leaf" ? node.activeChannelId : null);
	$effect(() => {
		const room = heldRoom;
		if (!room) return;
		const release = channelMessages.keep(room);
		return () => {
			// Left at the present, its list goes back to its newest page, which is all the next visit opens on (at its bottom
			// or its divider): older ones load again on a scroll up (#326). Not as a READY takes the panes down, as the
			// reader's place is kept for the next ones (lib/kept-places.ts).
			if (!channelHasMoreBelow[room] && get(friendsReady)) channelMessages.trim(room, MESSAGE_PAGE);
			release();
		};
	});

	// On screen, a list is cut back to its newest page once its reader is at its bottom with more than LIST_ON_SCREEN_MAX
	// messages in it, from a long read up there or from what came since: the rows above, out of sight, unmount (#326).
	// After the update that brought the message, which the list reads first to follow its bottom (lib/arrivals.ts).
	$effect(() => {
		const room = heldRoom;
		if (!room || !paneIsAtBottom || channelHasMoreBelow[room]) return;
		if (($channelMessages[room]?.length ?? 0) > LIST_ON_SCREEN_MAX) {
			void tick().then(() => channelMessages.trim(room, LIST_ON_SCREEN_MAX));
		}
	});

	// A list cut back here or in another pane has older messages to load again.
	onMount(() =>
		channelMessages.onTrim((room) => {
			channelHasMore[room] = true;
		}),
	);

	// A room read up to the newest message its list has from elsewhere (the space's Mark all as read moves its read
	// position there) has nothing new after its unread divider: the divider goes, shown or kept from an earlier visit.
	$effect(() => {
		const readUpTo = $lastReadRooms;
		untrack(() => {
			for (const [channelId, after] of Object.entries(channelUnreadAfter)) {
				if (!after) continue;
				const list = {
					newest: newestConfirmedId(get(channelMessages)[channelId] ?? []) ?? "",
					moreBelow: channelHasMoreBelow[channelId] === true,
					loadedBelowTo: channelLoadedBelowTo[channelId] ?? "",
				};
				if (readWhenLeft(list, ackedMsgIds.get(channelId), readUpTo[channelId])) channelUnreadAfter[channelId] = null;
			}
		});
	});

	// ACK helper — sends an ack for the newest confirmed message if at bottom.
	function tryAckChannel() {
		if (node.kind !== "leaf" || !node.activeChannelId || activeChannel?.type !== "text") return;
		const channelId = node.activeChannelId;
		if (!isActive || !!channelInitialLoading[channelId] || !paneIsAtBottom || !get(pageVisible)) return;
		if (fetchingChannels.has(channelId)) return;
		if (channelHasMoreBelow[channelId] === true) return;
		const msgs = $channelMessages[channelId] ?? [];
		if (msgs.length === 0) return;
		// Clear the unread divider
		if (channelUnreadAfter[channelId] != null) {
			channelUnreadAfter[channelId] = null;
		}
		ackNewest(channelId, msgs);
	}

	// A message that came past a jump's pages shows only when the pages below reach it, yet the room is unread: its
	// divider goes after the read position (this session's ack, or READY's), so leaving keeps the dot, and the pages below
	// show it in its place.
	$effect(() => {
		if (node.kind !== "leaf" || !node.activeChannelId) return;
		const channelId = node.activeChannelId;
		const all = $channelMessages[channelId] ?? [];
		if (channelHasMoreBelow[channelId] !== true || channelUnreadAfter[channelId] != null) return;
		const acked = ackedMsgIds.get(channelId);
		const lastRead = $lastReadRooms[channelId];
		const readUpTo = acked && (!lastRead || acked > lastRead) ? acked : lastRead;
		const at = dividerPastWindow(all, channelLoadedBelowTo[channelId] ?? "", $currentUser?.id, readUpTo);
		if (at !== null) channelUnreadAfter[channelId] = at;
	});

	// ACK reactively when at bottom and messages change.
	// All reactive deps must be read inline (not inside tryAckChannel) so Svelte
	// tracks them properly — function calls don't create reactive subscriptions.
	$effect(() => {
		const msgs = activeMessages;
		const atBottom = paneIsAtBottom;
		const visible = $pageVisible;
		if (node.kind !== "leaf" || !node.activeChannelId || activeChannel?.type !== "text") return;
		const channelId = node.activeChannelId;
		const loading = !!channelInitialLoading[channelId];
		if (!isActive || loading || !atBottom || !visible) return;
		if (fetchingChannels.has(channelId)) return;
		if (channelHasMoreBelow[channelId] === true) return;
		if (msgs.length === 0) return;
		if (channelUnreadAfter[channelId] != null) {
			channelUnreadAfter[channelId] = null;
		}
		ackNewest(channelId, msgs);
	});

	// ACK on a 5-second interval as a safety net.
	let ackInterval: ReturnType<typeof setInterval> | null = null;
	$effect(() => {
		// Track channel id so we restart the interval on channel switch.
		const _channelId = node.kind === "leaf" ? node.activeChannelId : null;
		if (ackInterval) {
			clearInterval(ackInterval);
			ackInterval = null;
		}
		ackInterval = setInterval(tryAckChannel, 5000);
		return () => {
			if (ackInterval) {
				clearInterval(ackInterval);
				ackInterval = null;
			}
		};
	});

	// Fetch initial messages only for text channels. Not for a room taken away from the user: given back, it loads what it
	// missed, at once if it's on screen, as its loaded messages went when it was taken away.
	$effect(() => {
		if (node.kind !== "leaf" || !node.activeChannelId || activeChannel?.type !== "text" || !activeRoomListed) {
			return;
		}
		const channelId = node.activeChannelId;
		if (fetchingChannels.has(channelId)) return; // fetch already in-flight
		if (loadedChannels.has(channelId)) {
			// Self-heal: if marked loaded but store is empty and server knows
			// the channel has messages, the original fetch silently failed (or the room was taken away and given
			// back) — load it again. So is a list the store dropped: it keeps 50, and lets go of one a page of messages
			// came to while no pane showed it (#326).
			const hasServerMsgs = !!get(lastMsgRooms)[channelId];
			const list = get(channelMessages)[channelId];
			if (list && (list.length > 0 || !hasServerMsgs)) return;
		}
		// Shown again in the middle of a jump's pages (after a READY, or in another pane): the list goes on from them, as a
		// conversation's does, rather than putting the newest page beside them with the messages between left out.
		const kept = takeJump(channelId, get(channelMessages)[channelId]);
		if (kept) {
			loadedChannels.add(channelId);
			channelLoadFailed[channelId] = false;
			channelHasMore[channelId] = kept.hasMore;
			channelHasMoreBelow[channelId] = true;
			channelLoadedBelowTo[channelId] = kept.loadedBelowTo;
			channelInitialLoading[channelId] = false;
			return;
		}
		loadFirstPage(channelId);
	});

	// The room's newest page, which its list opens on. One that fails leaves the room unloaded, which its list says
	// (channelLoadFailed): Try again asks for it again, as the room's next visit does.
	function loadFirstPage(channelId: string) {
		loadedChannels.add(channelId);
		fetchingChannels.add(channelId);
		channelLoadFailed[channelId] = false;
		// Mutate instead of spread-replace — spreading reads the $state object
		// which makes it a reactive dependency of the $effect above, causing spurious
		// re-runs when *other* channels finish loading and corrupting the
		// dependency set so the effect misses the activeChannelId change.
		channelInitialLoading[channelId] = true;
		// A jump that starts meanwhile (to a message of a room just opened) puts its own pages in the list: this newest
		// page would go in beside them, leaving the messages between out.
		const jump = channelJumps.get(channelId) ?? 0;

		getMessages(channelId)
			.then((raw) => {
				if (jump !== (channelJumps.get(channelId) ?? 0)) {
					channelInitialLoading[channelId] = false;
					return;
				}
				const msgs = raw.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
				channelMessages.update((all) => {
					const existing = all[channelId] ?? [];
					if (existing.length === 0) return { ...all, [channelId]: msgs };
					// Merge: keep pending/real-time messages, add history that isn't already present
					const existingIds = new Set(existing.map((m) => m.id));
					const newMsgs = msgs.filter((m) => !existingIds.has(m.id));
					if (newMsgs.length === 0) return all;
					return { ...all, [channelId]: [...existing, ...newMsgs] };
				});
				// Determine unread divider position now that we have REAL messages.
				// Compare the newest fetched message against every known read-position.
				if (raw.length > 0) {
					const readPos =
						get(lastReadRooms)[channelId] ?? ackedMsgIds.get(channelId) ?? get(lastMsgRooms)[channelId] ?? null;
					if (readPos) {
						let newest = "";
						for (const m of raw) {
							if (m.id > newest) newest = m.id;
						}
						if (newest > readPos) {
							channelUnreadAfter[channelId] = readPos;
						}
					} else if (get(unreadChannels).has(channelId) || channelUnreadAfter[channelId] === "0") {
						// Never ACK'd but known unread — all messages are new
						channelUnreadAfter[channelId] = "0";
					}
				}
				channelInitialLoading[channelId] = false;
				channelHasMore[channelId] = raw.length >= 100;
				// The newest page reaches the room's newest message: nothing newer to load below it.
				channelHasMoreBelow[channelId] = false;
				channelLoadedBelowTo[channelId] = "";
			})
			.catch((err) => {
				console.error("Failed to fetch history:", err);
				loadedChannels.delete(channelId);
				channelLoadFailed[channelId] = true;
				channelInitialLoading[channelId] = false;
			})
			.finally(() => fetchingChannels.delete(channelId));
	}

	// Try again, on the active room's first page that failed.
	function retryActiveRoom() {
		if (node.kind === "leaf" && node.activeChannelId && !fetchingChannels.has(node.activeChannelId)) {
			loadFirstPage(node.activeChannelId);
		}
	}

	// The room's older messages load above as the reader scrolls up to them, a page at a time. A page that fails, or
	// hasn't come in 10 s, is asked for again on a scroll there once RETRY_WAIT has passed: it isn't the room's start.
	async function loadMoreMessages() {
		if (node.kind !== "leaf" || !node.activeChannelId || isLoadingMore || activeChannel?.type !== "text") {
			return;
		}
		const channelId = node.activeChannelId;
		if (channelHasMore[channelId] === false) {
			return;
		}
		if (Date.now() - (aboveFailedAt.get(channelId) ?? 0) < RETRY_WAIT) {
			return;
		}

		const current = $channelMessages[channelId];
		// Still fetching initial messages — don't interfere
		if (current === undefined || current === null) {
			return;
		}
		// Loaded but empty channel → no history to fetch
		if (current.length === 0) {
			channelHasMore[channelId] = false;
			return;
		}

		let oldest = current.at(0)!.id;
		for (const m of current) {
			if (m.id < oldest) {
				oldest = m.id;
			}
		}

		isLoadingMore = true;

		// Abort the fetch after 10 s to avoid a permanent spinner
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort();
		}, 10_000);

		try {
			const raw = await getMessages(channelId, oldest, controller.signal);
			clearTimeout(timeoutId);
			// A list cut back meanwhile (#326) no longer goes on from this page's cursor: the page is dropped, and the next
			// scroll up asks from its oldest message.
			if (!get(channelMessages)[channelId]?.some((m) => m.id === oldest)) return;
			if (raw.length === 0) {
				channelHasMore[channelId] = false;
			} else {
				const msgs = raw.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
				channelMessages.update((all) => {
					const existing = all[channelId] || [];
					const existingIds = new Set(existing.map((m) => m.id));
					return {
						...all,
						[channelId]: [...existing, ...msgs.filter((m) => !existingIds.has(m.id))],
					};
				});
				// Fewer than a full page means we've reached the beginning
				if (raw.length < 100) {
					channelHasMore[channelId] = false;
				}
			}
		} catch (err) {
			clearTimeout(timeoutId);
			console.error("Failed to load more:", err);
			aboveFailedAt.set(channelId, Date.now());
		} finally {
			isLoadingMore = false;
		}
	}

	// A new jump of the room's (or a trip to its newest messages) starts: what earlier ones asked for is dropped as it
	// comes, and its page below in flight is called off, so the new pages' next one can be asked for at once.
	function startJump(channelId: string): number {
		const jump = (channelJumps.get(channelId) ?? 0) + 1;
		channelJumps.set(channelId, jump);
		const inFlight = belowRequests.get(channelId);
		if (inFlight) {
			belowRequests.delete(channelId);
			inFlight.abort();
			isLoadingMoreBelow = false;
		}
		belowFailedAt.delete(channelId);
		return jump;
	}

	// After a jump, the newer messages load below as the reader scrolls down to them, a page at a time, each after the
	// newest of the jump's pages. A page that fails, or hasn't come in 10 s, is asked for again on a scroll there once
	// RETRY_WAIT has passed: newer messages are still to load.
	async function loadMoreMessagesBelow() {
		if (node.kind !== "leaf" || !node.activeChannelId || isLoadingMoreBelow || activeChannel?.type !== "text") {
			return;
		}
		const channelId = node.activeChannelId;
		const after = channelLoadedBelowTo[channelId];
		if (channelHasMoreBelow[channelId] !== true || !after) {
			return;
		}
		if (Date.now() - (belowFailedAt.get(channelId) ?? 0) < RETRY_WAIT) {
			return;
		}

		const jump = channelJumps.get(channelId) ?? 0;
		isLoadingMoreBelow = true;
		const controller = new AbortController();
		belowRequests.set(channelId, controller);
		const timeoutId = setTimeout(() => controller.abort(), 10_000);

		try {
			const raw = await getMessagesAfter(channelId, after, controller.signal);
			if (jump !== (channelJumps.get(channelId) ?? 0)) return;
			const msgs = raw.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
			channelLoadedBelowTo[channelId] = loadedTo(after, raw);
			channelMessages.update((all) => {
				const existing = all[channelId] || [];
				const existingIds = new Set(existing.map((m) => m.id));
				return {
					...all,
					[channelId]: [...existing, ...msgs.filter((m) => !existingIds.has(m.id))],
				};
			});
			// Fewer than a full page: it reached the newest message.
			channelHasMoreBelow[channelId] = raw.length >= 100;
		} catch (err) {
			if (jump === (channelJumps.get(channelId) ?? 0)) belowFailedAt.set(channelId, Date.now());
			console.error("Failed to load more below:", err);
		} finally {
			clearTimeout(timeoutId);
			if (belowRequests.get(channelId) === controller) {
				belowRequests.delete(channelId);
				isLoadingMoreBelow = false;
			}
		}
	}

	// A message sent from a jump's pages takes the reader to the present: the room's newest page takes the place of the
	// jump's pages, with the messages still being sent and what came after that page. True once it's there. One at a
	// time: a second message sent meanwhile waits for the same trip.
	const presentLoads = new Map<string, Promise<boolean>>();
	function jumpToPresent(): Promise<boolean> {
		if (node.kind !== "leaf" || !node.activeChannelId) return Promise.resolve(false);
		const channelId = node.activeChannelId;
		let load = presentLoads.get(channelId);
		if (!load) {
			load = loadPresent(channelId).finally(() => presentLoads.delete(channelId));
			presentLoads.set(channelId, load);
		}
		return load;
	}

	async function loadPresent(channelId: string): Promise<boolean> {
		const jump = startJump(channelId);
		try {
			const raw = await getMessages(channelId);
			if (jump !== channelJumps.get(channelId)) return false;
			const page = raw.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
			channelMessages.update((all) => ({ ...all, [channelId]: withPresent(all[channelId] ?? [], page) }));
			channelHasMore[channelId] = raw.length >= 100;
			channelHasMoreBelow[channelId] = false;
			channelLoadedBelowTo[channelId] = "";
			return true;
		} catch (err) {
			console.error("Failed to load the newest messages:", err);
			return false;
		}
	}

	async function jumpToMessage(channelId: string, messageId: string) {
		if (node.kind !== "leaf") return;

		// An ephemeral message has no history around it to load: it's only here, where the list shows it.
		if (get(ephemeralMessages)[channelId]?.some((m) => m.id === messageId)) {
			channelHighlightedMessage[channelId] = messageId;
			setTimeout(() => {
				channelHighlightedMessage[channelId] = null;
			}, 3000);
			return;
		}

		const jump = startJump(channelId);
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10_000);

		try {
			// Fetch the anchor message to get its UUID cursor
			const anchor = await getMessageById(channelId, messageId, controller.signal);
			const anchorId = anchor.id;

			// Fetch messages before and after the anchor in parallel
			const [rawAbove, rawBelow] = await Promise.all([
				getMessages(channelId, anchorId, controller.signal),
				getMessagesAfter(channelId, anchorId, controller.signal),
			]);
			clearTimeout(timeoutId);
			// Of two jumps in a row, the last one's pages stay.
			if (jump !== channelJumps.get(channelId)) return;

			const anchorMsg = gatewayMessageToMessage(anchor, $gatewaySpaces);
			const above = rawAbove.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
			const below = rawBelow.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));

			const allIds = new Set<string>();
			const combined: typeof above = [];
			for (const m of [...above, anchorMsg, ...below]) {
				if (!allIds.has(m.id)) {
					allIds.add(m.id);
					combined.push(m);
				}
			}

			// Replace channel messages with context around anchor
			loadedChannels.add(channelId);
			channelLoadFailed[channelId] = false;
			channelMessages.update((all) => ({ ...all, [channelId]: combined }));
			channelHasMore[channelId] = rawAbove.length >= 100;
			channelHasMoreBelow[channelId] = rawBelow.length >= 100;
			channelLoadedBelowTo[channelId] = loadedTo(anchorId, rawBelow);
			channelHighlightedMessage[channelId] = messageId;
			channelInitialLoading[channelId] = false;

			// Clear highlight after 3 seconds
			setTimeout(() => {
				channelHighlightedMessage[channelId] = null;
			}, 3000);
		} catch (err) {
			clearTimeout(timeoutId);
			console.error("Failed to jump to message:", err);
		}
	}

	// ── Handle jump-to-message requests ──────────────────────────────────────
	$effect(() => {
		const req = $jumpToMessageRequest;
		if (!req || req.id === lastHandledJumpId) return;
		if (node.kind !== "leaf") return;
		// A conversation's: the page opens its tab, and its ConversationView jumps.
		if (req.conversationId) return;

		const hasRoom = node.tabs.some((t) => t.channelId === req.roomId);
		const thisPaneIsFocused = focusedPaneId === node.id;
		if (!hasRoom && !thisPaneIsFocused) return;

		// Claim this request
		lastHandledJumpId = req.id;
		jumpToMessageRequest.set(null);

		if (!hasRoom) {
			// Open the tab first (find tab info from gateway spaces)
			const reqSpace = $gatewaySpaces.find((s) => s.id === req.spaceId);
			const room = reqSpace?.rooms.find((r) => r.id === req.roomId);
			if (room) {
				openTab({
					channelId: room.id,
					channelName: room.name,
					channelType: roomTypeToChannelType(room.type),
					spaceId: req.spaceId,
				});
			}
		} else {
			// Switch to existing tab
			if (node.activeChannelId !== req.roomId) {
				handleTabSelect(req.roomId);
			}
		}

		if (req.messageId) void jumpToMessage(req.roomId, req.messageId);
	});

	// ── Leaf: tab management ──────────────────────────────────────────────────
	function openTab(tab: Tab) {
		if (node.kind !== "leaf") {
			return;
		}
		const tabs = node.tabs.some((t) => t.channelId === tab.channelId) ? node.tabs : [...node.tabs, tab];
		onUpdate({ ...node, tabs, activeChannelId: tab.channelId });
	}

	function handleTabSelect(channelId: string) {
		if (node.kind !== "leaf") {
			return;
		}
		onUpdate({ ...node, activeChannelId: channelId });
		onFocus(node.id);
	}

	// Closes these tabs in one update. When the active one goes, the first tab left after it takes its
	// place, or else the last one before it.
	function handleTabClose(channelIds: string[]) {
		if (node.kind !== "leaf") {
			return;
		}
		const { tabs, activeChannelId } = closeTabsIn(node, channelIds);
		if (tabs.length === 0 && onClose) {
			onClose();
			return;
		}
		// Focus this pane AFTER the update (onUpdate triggers syncSidebarToLeaf
		// with the already-updated tree, so sidebarSpaceId gets the right guild).
		const leafId = node.id;
		onUpdate({ ...node, tabs, activeChannelId });
		onFocus(leafId);
	}

	// ── Leaf: split actions ───────────────────────────────────────────────────
	function splitH() {
		if (node.kind !== "leaf") {
			return;
		}
		onUpdate(makeSplit(node, makeLeaf(), "h"));
	}

	function splitV() {
		if (node.kind !== "leaf") {
			return;
		}
		onUpdate(makeSplit(node, makeLeaf(), "v"));
	}

	// ── Split: resize handle ──────────────────────────────────────────────────
	let containerEl = $state<HTMLElement | undefined>(undefined);
	let localRatio = $state(0.5);
	let isDragging = $state(false);

	$effect(() => {
		if (node.kind === "split" && !isDragging) {
			localRatio = node.ratio;
		}
	});

	function startResize(e: MouseEvent) {
		e.preventDefault();
		isDragging = true;
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	}

	function onMouseMove(e: MouseEvent) {
		if (!isDragging || !containerEl || node.kind !== "split") {
			return;
		}
		const rect = containerEl.getBoundingClientRect();
		const r = node.direction === "h" ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
		localRatio = Math.max(0.1, Math.min(0.9, r));
	}

	function onMouseUp() {
		if (!isDragging) {
			return;
		}
		isDragging = false;
		window.removeEventListener("mousemove", onMouseMove);
		window.removeEventListener("mouseup", onMouseUp);
		if (node.kind === "split") {
			onUpdate({ ...node, ratio: localRatio });
		}
	}

	onDestroy(() => {
		if (typeof window === "undefined") return;
		window.removeEventListener("mousemove", onMouseMove);
		window.removeEventListener("mouseup", onMouseUp);
	});

	const isFocused = $derived(node.kind === "leaf" && focusedPaneId === node.id);

	function handleCtrlW(e: KeyboardEvent) {
		if (!e.ctrlKey || e.key !== "w") return;
		if (node.kind !== "leaf" || focusedPaneId !== node.id) return;
		if (!node.activeChannelId) return;
		e.preventDefault();
		handleTabClose([node.activeChannelId]);
	}

	onMount(() => window.addEventListener("keydown", handleCtrlW));
	onDestroy(() => {
		if (typeof window === "undefined") return;
		window.removeEventListener("keydown", handleCtrlW);
	});

	// ── Leaf: drag-to-split ───────────────────────────────────────────────────
	let contentDragOver = $state(false);
	let splitZone = $state<"bottom" | "right" | "left" | "top" | null>(null);

	function isTabOrChannelDrag(e: DragEvent): boolean {
		if (!e.dataTransfer) return false;
		// File drags have items with kind "file"
		for (const item of Array.from(e.dataTransfer.items)) {
			if (item.kind === "file") return false;
		}
		return e.dataTransfer.types.includes("text/plain");
	}

	function handleContentDragOver(e: DragEvent) {
		if (!isTabOrChannelDrag(e)) return;
		e.preventDefault();
		contentDragOver = true;
		if (e.dataTransfer) {
			const allowed = e.dataTransfer.effectAllowed;
			e.dataTransfer.dropEffect =
				allowed === "move" || allowed === "copyMove" || allowed === "linkMove" ? "move" : "copy";
		}
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = (e.clientX - rect.left) / rect.width;
		const y = (e.clientY - rect.top) / rect.height;
		const margin = 0.25;
		if (x < margin) {
			splitZone = "left";
		} else if (x > 1 - margin) {
			splitZone = "right";
		} else if (y < margin) {
			splitZone = "top";
		} else if (y > 1 - margin) {
			splitZone = "bottom";
		} else {
			splitZone = null;
		}
	}

	function handleContentDragLeave(e: DragEvent) {
		const el = e.currentTarget as HTMLElement;
		if (!el.contains(e.relatedTarget as Node)) {
			contentDragOver = false;
			splitZone = null;
		}
	}

	function handleContentDrop(e: DragEvent) {
		e.preventDefault();
		contentDragOver = false;
		// Recompute zone from drop coordinates — dragleave resets splitZone before drop fires
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = (e.clientX - rect.left) / rect.width;
		const y = (e.clientY - rect.top) / rect.height;
		const margin = 0.25;
		let zone: "bottom" | "right" | "left" | "top" | null = null;
		if (x < margin) {
			zone = "left";
		} else if (x > 1 - margin) {
			zone = "right";
		} else if (y < margin) {
			zone = "top";
		} else if (y > 1 - margin) {
			zone = "bottom";
		}
		splitZone = null;
		if (node.kind !== "leaf") {
			return;
		}
		const raw = e.dataTransfer?.getData("text/plain") ?? "";
		let tab: null | Tab = null;
		let dragType: "channel" | "tab" | null = null;
		let sourceLeafId: string | null = null;
		try {
			const data = JSON.parse(raw) as {
				type?: string;
				sourceLeafId?: string;
				channelId?: string;
				channelName?: string;
				channelType?: string;
				spaceId?: string;
				kind?: unknown;
			};
			dragType = data.type === "tab" ? "tab" : "channel";
			sourceLeafId = data.sourceLeafId ?? null;
			tab = tabFromDragData(data);
		} catch {
			return;
		}
		if (!tab) {
			return;
		}

		if (dragType === "tab" && sourceLeafId === node.id) {
			const fromIndex = node.tabs.findIndex((t) => t.channelId === tab.channelId);
			if (fromIndex === -1) {
				return;
			}
			if (zone === null) {
				handleTabSelect(tab.channelId);
				return;
			}
			const remainingTabs = node.tabs.filter((t) => t.channelId !== tab.channelId);
			const remainingActive =
				node.activeChannelId === tab.channelId
					? ((remainingTabs[fromIndex] ?? remainingTabs[fromIndex - 1])?.channelId ?? null)
					: node.activeChannelId;
			const currentLeaf = {
				...node,
				tabs: remainingTabs,
				activeChannelId: remainingActive,
			};
			const newLeaf = makeLeaf([tab], tab.channelId);
			if (zone === "left") {
				onUpdate(makeSplit(newLeaf, currentLeaf, "h"));
			} else if (zone === "right") {
				onUpdate(makeSplit(currentLeaf, newLeaf, "h"));
			} else if (zone === "top") {
				onUpdate(makeSplit(newLeaf, currentLeaf, "v"));
			} else {
				onUpdate(makeSplit(currentLeaf, newLeaf, "v"));
			}
			return;
		}

		if (dragType === "tab" && sourceLeafId && sourceLeafId !== node.id && onMoveTab) {
			onMoveTab(tab, sourceLeafId, node.id, zone);
			return;
		}

		const newLeaf = makeLeaf([tab], tab.channelId);
		if (zone === "left") {
			onUpdate(makeSplit(newLeaf, node, "h"));
		} else if (zone === "right") {
			onUpdate(makeSplit(node, newLeaf, "h"));
		} else if (zone === "top") {
			onUpdate(makeSplit(newLeaf, node, "v"));
		} else if (zone === "bottom") {
			onUpdate(makeSplit(node, newLeaf, "v"));
		} else {
			// Center: open in this pane without splitting
			openTab(tab);
		}
	}

	// shared props forwarded to children
	const childProps = $derived({
		guild,
		spaceId,
		space,
		members,
		focusedPaneId,
		onFocus,
		onMoveTab,
		// A split's panes are hidden with it (the Friends view), as the root pane is.
		isActive,
	});

	// ── Leaf: the bar's actions ──────────────────────────────────────────────
	// The pane's one bar has the active chat's actions after its tabs (or its name). A room's are the pane's own; a
	// conversation's are its view's, which hands them here while it shows.
	const roomEmojis = $derived(activeTab?.spaceId ? ($spaceEmojis[activeTab.spaceId] ?? []) : []);
	let conversationActions = $state<{ conversationId: string; actions: Snippet } | null>(null);

	function showConversationActions(conversationId: string, actions: Snippet | null) {
		if (actions) conversationActions = { conversationId, actions };
		else if (conversationActions?.conversationId === conversationId) conversationActions = null;
	}

	// ── Leaf: the header's title ─────────────────────────────────────────────
	// A room's mark is its Space's icon, with the # or the speaker written before its name.
	const activeTabSpaceIcon = $derived(
		activeTabSpace
			? {
					name: activeTabSpace.name,
					icon: activeTabSpace.icon ? (getAvatarURL(activeTabSpace.id, activeTabSpace.icon) ?? null) : null,
				}
			: null,
	);
	// The line under the name: who's typing there, else a room's Space and what the room is for, or a conversation's
	// kind.
	const activeTabLine = $derived.by(() => {
		if (!activeTab) return null;
		const typing = typingSentence($typingNow[activeTab.channelId]);
		if (typing) return typing;
		if (activeConversation) {
			if (activeConversation.type !== 2) return "Direct message";
			const count = activeConversation.members.length;
			return count === 1 ? "1 member" : `${count} members`;
		}
		return [activeTabSpace?.name, activeRoomDescription].filter(Boolean).join(" · ") || null;
	});
</script>

{#if node.kind === "split"}
	<!-- ── Split ─────────────────────────────────────────────────────────────── -->
	<div
		bind:this={containerEl}
		class="flex {node.direction === 'h' ? 'flex-row' : 'flex-col'} h-full w-full overflow-hidden"
	>
		<!-- Child A -->
		<div
			class="flex min-h-0 min-w-0 flex-col overflow-hidden"
			style="{node.direction === 'h' ? 'width' : 'height'}: {localRatio * 100}%"
		>
			<PaneView
				node={node.a}
				onUpdate={(newA) => {
					onUpdate({ ...node, a: newA });
				}}
				onClose={() => {
					onUpdate(node.b);
				}}
				{...childProps}
			/>
		</div>

		<!-- Resize handle: a wider area to press than the hairline it draws, which thickens under the pointer and
		     turns accent while dragged. A double click evens the two sides. -->
		<button
			type="button"
			class="group/gutter relative z-[7] shrink-0 {node.direction === 'h'
				? '-mx-1 w-[9px] cursor-col-resize'
				: '-my-1 h-[9px] cursor-row-resize'}"
			onmousedown={startResize}
			ondblclick={() => node.kind === "split" && onUpdate({ ...node, ratio: 0.5 })}
			aria-label="Resize split"
		>
			<span
				class="absolute transition-[background-color,inset] duration-150 motion-reduce:transition-none {node.direction ===
				'h'
					? 'inset-y-0 right-1 left-1 group-hover/gutter:right-[3px] group-hover/gutter:left-[3px]'
					: 'inset-x-0 top-1 bottom-1 group-hover/gutter:top-[3px] group-hover/gutter:bottom-[3px]'} {isDragging
					? 'bg-duvet-accent'
					: 'bg-duvet-line group-hover/gutter:bg-duvet-accent-tint'}"
			></span>
		</button>

		<!-- Child B -->
		<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<PaneView
				node={node.b}
				onUpdate={(newB) => {
					onUpdate({ ...node, b: newB });
				}}
				onClose={() => {
					onUpdate(node.a);
				}}
				{...childProps}
			/>
		</div>
	</div>
{:else}
	<!-- ── Leaf ───────────────────────────────────────────────────────────────── -->
	<!-- Clicking a pane focuses it; following DOM focus instead would also move it on programmatic
	     focus, like a split remounting its chat inputs. The keyboard has no pane focus to move. Only a pane of a
	     split (which has onClose) rings when focused: a lone pane is always the focused one. -->
	<!-- The pane is the container its bar's search field collapses in when the pane is narrow. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<div
		class="bg-duvet-bg @container/pane relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden {isFocused &&
		onClose
			? 'ring-duvet-accent/40 ring-1 ring-inset'
			: ''}"
		role="region"
		aria-label="Chat pane"
		data-pane-focused={isFocused ? "true" : undefined}
		onclick={() => onFocus(node.id)}
	>
		<!-- The pane's header (S-11): the chat it shows, then the chat's actions and the pane's own. The open chats are
		     the title bar's tabs (TitleStrip), or the sidebar's list. In a split, the pane that isn't focused fades its
		     title. -->
		<div class="border-duvet-line bg-duvet-bg flex h-[52px] min-w-0 shrink-0 items-center gap-2.5 border-b pr-2.5 pl-3">
			<div
				class="flex min-w-0 flex-1 items-center gap-2.5 transition-opacity duration-150 motion-reduce:transition-none {onClose &&
				!isFocused
					? 'opacity-55'
					: ''}"
			>
				{#if activeTab}
					<span class="grid size-7 shrink-0 place-items-center">
						<TabIcon tab={activeTab} size={24} space={activeTabSpaceIcon} />
					</span>
					<div class="flex min-w-0 flex-col">
						<h2
							class="text-duvet-ink flex min-w-0 items-center gap-1 font-serif text-[16.5px] leading-[1.15] font-medium tracking-[-0.012em]"
						>
							{#if activeChannel?.type === "voice"}
								<SpeakerIcon class="text-duvet-ink2 size-[15px] shrink-0" aria-hidden="true" />
							{:else if activeChannel?.type === "text"}
								<Hash class="text-duvet-ink2 size-[15px] shrink-0" aria-hidden="true" />
							{/if}
							<span class="truncate">{tabTitle(activeTab, $conversations, $currentUser?.id)}</span>
						</h2>
						<!-- What the room is for, under its name: one line, whole on hover -->
						{#if activeTabLine}
							<span class="text-duvet-ink2 truncate text-[11.5px] leading-[1.3]" title={activeRoomDescription}
								>{activeTabLine}</span
							>
						{/if}
					</div>
				{/if}
			</div>

			<!-- The active chat's actions -->
			<div class="flex shrink-0 items-center gap-0.5">
				{#if activeChannel?.type === "text"}
					{#key node.activeChannelId}
						<PinnedMessages
							space={activeTabSpace}
							channelId={node.activeChannelId ?? ""}
							members={activeTabMembers}
							customEmojis={roomEmojis}
						/>
					{/key}
					{#key activeTab?.spaceId}
						<MessageSearch space={activeTabSpace} members={activeTabMembers} customEmojis={roomEmojis} />
					{/key}
				{:else if activeChannel?.type === "voice" && $activeVoiceRoomId === node.activeChannelId}
					<span class="bg-duvet-accent-tint text-duvet-accent-text rounded-full px-2 py-0.5 text-xs font-medium"
						>Connected</span
					>
				{:else if conversationActions && conversationActions.conversationId === activeConversation?.id}
					{@render conversationActions.actions()}
				{/if}
				<!-- A room's members open from their faces, in a popover: nothing is docked beside the chat (#357). -->
				{#if activeTabSpace && activeTab && !isConversationTab(activeTab)}
					<MembersButton space={activeTabSpace} channelId={activeTab.channelId} />
				{/if}

				<!-- The pane's own actions: the app's splits, to the right or below, at any depth. -->
				<Menu align="end" label="Pane">
					{#snippet trigger(props)}
						<IconButton {...props} label="More"><EllipsisIcon size={16} /></IconButton>
					{/snippet}
					<MenuItem icon={ColumnsIcon} onSelect={splitH}>Split horizontally</MenuItem>
					<MenuItem icon={RowsIcon} onSelect={splitV}>Split vertically</MenuItem>
					{#if onClose}
						<MenuSeparator />
						<MenuItem icon={XIcon} onSelect={() => onClose?.()}>Close pane</MenuItem>
					{/if}
				</Menu>
				<!-- Close pane. The click stops here: the pane is gone once onClose has run, and its own click (which focuses
				     it) would read a pane that isn't there. -->
				{#if onClose}
					<button
						type="button"
						class={iconButtonClass()}
						title="Close pane"
						aria-label="Close pane"
						onclick={(e) => {
							e.stopPropagation();
							onClose?.();
						}}
					>
						<XIcon size={16} />
					</button>
				{/if}
			</div>
		</div>

		<!-- Content -->
		<div
			class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
			ondragover={handleContentDragOver}
			ondragleave={handleContentDragLeave}
			ondrop={handleContentDrop}
			role="group"
			aria-label="Pane content area"
		>
			<!-- Drag-to-split overlay: the zone under the pointer, and what a drop there does. The middle opens the chat
			     in this pane; an edge puts it in a new pane on that side. -->
			{#if contentDragOver}
				<div class="bg-duvet-accent-tint/40 pointer-events-none absolute inset-0 z-30">
					<div
						class="bg-duvet-accent-tint ring-duvet-accent absolute grid place-items-center rounded-[18px] ring-2 transition-[inset] duration-100 ring-inset motion-reduce:transition-none {splitZone ===
						'left'
							? 'inset-y-2.5 right-3/4 left-2.5'
							: splitZone === 'right'
								? 'inset-y-2.5 right-2.5 left-3/4'
								: splitZone === 'top'
									? 'inset-x-2.5 top-2.5 bottom-3/4'
									: splitZone === 'bottom'
										? 'inset-x-2.5 top-3/4 bottom-2.5'
										: 'inset-2.5'}"
					>
						<span
							class="bg-duvet-card text-duvet-accent-text shadow-duvet-float flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold whitespace-nowrap"
						>
							{#if splitZone === "top" || splitZone === "bottom"}
								<RowsIcon size={16} />
							{:else if splitZone}
								<ColumnsIcon size={16} />
							{:else}
								<AppWindowIcon size={16} />
							{/if}
							{splitZone === "left"
								? "Split left"
								: splitZone === "right"
									? "Split right"
									: splitZone === "top"
										? "Split up"
										: splitZone === "bottom"
											? "Split down"
											: "Open here"}
						</span>
					</div>
				</div>
			{/if}

			{#if activeChannel?.type === "text"}
				{@const introRoom = activeTabSpace?.rooms.find((r) => r.id === activeChannel.id)}
				{#snippet roomIntro()}
					<ChatIntro title={`#${activeChannel.name}`}>
						{#snippet icon()}
							<div
								class="bg-duvet-card shadow-duvet-raised text-duvet-ink2 grid size-14 place-items-center rounded-2xl"
							>
								<Hash class="size-7" />
							</div>
						{/snippet}
						<p>
							The start of #{activeChannel.name}{activeTabSpace ? ` in ${activeTabSpace.name}` : ""}.
						</p>
						{#if activeTabSpace && introRoom && hasPermission(activeTabSpace, introRoom, Permission.CreateInvites)}
							<div class="mt-3 flex flex-wrap gap-2">
								<button
									type="button"
									class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised hover:text-duvet-ink flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-bold transition-colors motion-reduce:transition-none"
									onclick={() => (inviteOpen = true)}
								>
									<UserPlus class="size-4" />
									Invite people
								</button>
							</div>
						{/if}
					</ChatIntro>
				{/snippet}
				<Chat
					intro={roomIntro}
					messages={activeMessages}
					channelId={node.activeChannelId ?? ""}
					spaceId={activeTab?.spaceId ?? ""}
					space={activeTabSpace}
					channelName={activeChannel.name}
					members={activeTabMembers}
					bind:failedNonces={failedRoomSends}
					bind:isAtBottom={paneIsAtBottom}
					{isInitialLoading}
					retryFirstPage={node.activeChannelId && channelLoadFailed[node.activeChannelId] ? retryActiveRoom : null}
					{isLoadingMore}
					{isLoadingMoreBelow}
					hasMoreMessages={node.activeChannelId ? channelStillHasMore(node.activeChannelId) : true}
					hasMoreMessagesBelow={node.activeChannelId ? channelHasMoreBelow[node.activeChannelId] === true : false}
					highlightedMessageId={node.activeChannelId ? (channelHighlightedMessage[node.activeChannelId] ?? null) : null}
					unreadAfterMessageId={node.activeChannelId ? (channelUnreadAfter[node.activeChannelId] ?? null) : null}
					onLoadMore={loadMoreMessages}
					onLoadMoreBelow={loadMoreMessagesBelow}
					onJumpToPresent={jumpToPresent}
					onUnreadMark={(msgId) => {
						const chId = node.kind === "leaf" ? node.activeChannelId : null;
						if (chId && channelUnreadAfter[chId] == null) {
							channelUnreadAfter[chId] = msgId;
						}
					}}
					paneFocused={isFocused}
				/>
			{:else if activeTab && isConversationTab(activeTab)}
				<!-- Only while the panes show: the friends view hides them, and a conversation on screen counts as read
				     (activeDMConvId) and is acked. -->
				{#if isActive && activeConversation}
					{#key activeConversation.id}
						<ConversationView
							conversation={activeConversation}
							paneFocused={isFocused}
							onBarActions={showConversationActions}
							onMemberAdded={(m) => {
								const convId = activeConversation?.id;
								if (!convId) return;
								conversations.update((list) =>
									list.map((c) => {
										if (c.id !== convId) return c;
										if (c.members.some((x) => x.id === m.id || x.user_id === m.user_id)) return c;
										return { ...c, members: [...c.members, m] };
									}),
								);
							}}
						/>
					{/key}
				{/if}
			{:else if activeChannel?.type === "voice"}
				<VoiceChannelView
					showHeader={false}
					channelId={node.activeChannelId ?? ""}
					channelName={activeChannel.name}
					spaceId={activeTab?.spaceId ?? ""}
				/>
			{:else}
				<EmptyPane onOpen={(conversation) => openTab(conversationTab(conversation, $currentUser?.id))} />
			{/if}
		</div>
	</div>
{/if}

{#if activeChannel?.type === "text"}
	<InviteModal bind:open={inviteOpen} channel={activeChannel} spaceId={activeTab?.spaceId ?? ""} />
{/if}
