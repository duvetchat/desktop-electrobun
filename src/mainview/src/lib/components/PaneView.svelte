<script lang="ts">
	import {
		activeVoiceRoomId,
		channelMessages,
		gatewaySpaces,
		jumpToMessageRequest,
		unreadChannels,
		activeTextRoomId,
		lastReadRooms,
		lastMsgRooms,
		pageVisible,
		mentionCounts,
	} from "$lib/stores.svelte";
	import { get } from "svelte/store";
	import { makeSplit, makeLeaf } from "$lib/pane";
	import { getMessages, getMessagesAfter, getMessageById, ackRoom } from "$lib/api/messages";
	import { onMount, onDestroy } from "svelte";

	import type { MemberOnSidebar, GatewaySpace, PaneNode, Guild, Tab } from "$lib/types";

	import { gatewayMessageToMessage, gatewaySpaceToMembers, roomTypeToChannelType } from "$lib/types";
	import { userStatusCache } from "$lib/api/ws/connection";
	import PaneView from "$lib/components/PaneView.svelte";
	import TabBar from "$lib/components/TabBar.svelte";
	import Chat from "$lib/components/Chat.svelte";
	import VoiceChannelView from "$lib/components/VoiceChannelView.svelte";
	import { PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen } from "@lucide/svelte";

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
		showChannelsSidebar = true,
		onToggleChannels = null,
		showMembersSidebar = true,
		onToggleMembers = null,
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
		showChannelsSidebar?: boolean;
		onToggleChannels?: (() => void) | null;
		showMembersSidebar?: boolean;
		onToggleMembers?: (() => void) | null;
		isActive?: boolean;
	} = $props();

	// ── Leaf: message loading ─────────────────────────────────────────────────
	const loadedChannels = new Set<string>();
	const fetchingChannels = new Set<string>();
	let isLoadingMore = $state(false);
	let isLoadingMoreBelow = $state(false);
	let channelHasMore = $state<Partial<Record<string, boolean>>>({});
	let channelHasMoreBelow = $state<Partial<Record<string, boolean>>>({});
	let channelInitialLoading = $state<Partial<Record<string, boolean>>>({});
	let channelHighlightedMessage = $state<Partial<Record<string, string | null>>>({});
	// last-read message ID per channel, used to render the unread divider
	let channelUnreadAfter = $state<Partial<Record<string, string | null>>>({});
	// last message ID that was ACK'd per channel (used to set the divider on re-entry)
	let channelLastAcked = $state<Partial<Record<string, string>>>({});
	let paneIsAtBottom = $state(false);
	// Plain let (not $state) to avoid self-reactive mutation in $effect
	let lastAckChannelId: string | null = null;
	// Non-reactive dedup map — prevents sending the same ACK twice
	const ackedMsgIds = new Map<string, string>();
	// track handled jump request ids to avoid double-processing
	let lastHandledJumpId = $state<string | null>(null);

	const isInitialLoading = $derived(
		!!(node.kind === "leaf" && node.activeChannelId && channelInitialLoading[node.activeChannelId]),
	);
	// Returns true when the channel still has older messages to load.
	// Must use !== false because undefined means "not yet determined" (has more).
	function channelStillHasMore(channelId: string): boolean {
		return channelHasMore[channelId] !== false;
	}

	const activeMessages = $derived(
		node.kind === "leaf" && node.activeChannelId ? ($channelMessages[node.activeChannelId] ?? []) : [],
	);

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
	// Channel info comes directly from the tab — no cross-guild lookup needed.
	const activeChannel = $derived(
		activeTab
			? {
					id: activeTab.channelId,
					name: activeTab.channelName,
					type: activeTab.channelType,
				}
			: null,
	);

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
			if (hadUnread && loadedChannels.has(channelId) && channelLastAcked[channelId]) {
				channelUnreadAfter[channelId] = channelLastAcked[channelId];
			}
		} else {
			activeTextRoomId.set(null);
		}
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
		// Find newest confirmed (non-pending) message via UUID v7 lex order
		let newestId: string | null = null;
		for (const m of msgs) {
			if (m.id === m.nonce) continue;
			if (!newestId || m.id > newestId) newestId = m.id;
		}
		if (newestId && newestId !== ackedMsgIds.get(channelId)) {
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
			channelLastAcked[channelId] = newestId;
			ackRoom(channelId, newestId).catch((err) => console.error("[ack] network error:", err));
		}
	}

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
		let newestId: string | null = null;
		for (const m of msgs) {
			if (m.id === m.nonce) continue;
			if (!newestId || m.id > newestId) newestId = m.id;
		}
		if (newestId && newestId !== ackedMsgIds.get(channelId)) {
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
			channelLastAcked[channelId] = newestId;
			ackRoom(channelId, newestId).catch((err) => console.error("[ack] network error:", err));
		}
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

	// ACK when leaving the channel (channel switch / unmount) — only if at bottom.
	$effect(() => {
		const channelId = node.kind === "leaf" ? node.activeChannelId : null;
		return () => {
			if (!channelId || !paneIsAtBottom) return;
			const msgs = get(channelMessages)[channelId] ?? [];
			if (msgs.length === 0) return;
			let newestId: string | null = null;
			for (const m of msgs) {
				if (m.id === m.nonce) continue;
				if (!newestId || m.id > newestId) newestId = m.id;
			}
			if (newestId && newestId !== ackedMsgIds.get(channelId)) {
				ackedMsgIds.set(channelId, newestId);
				channelLastAcked[channelId] = newestId;
				unreadChannels.update((s) => {
					s.delete(channelId);
					return s;
				});
				mentionCounts.update((all) => {
					const copy = { ...all };
					delete copy[channelId];
					return copy;
				});
				ackRoom(channelId, newestId).catch((err) => console.error("[ack] cleanup error:", err));
			}
		};
	});

	// Fetch initial messages only for text channels
	$effect(() => {
		if (node.kind !== "leaf" || !node.activeChannelId || activeChannel?.type !== "text") {
			return;
		}
		const channelId = node.activeChannelId;
		if (fetchingChannels.has(channelId)) return; // fetch already in-flight
		if (loadedChannels.has(channelId)) {
			// Self-heal: if marked loaded but store is empty and server knows
			// the channel has messages, the original fetch silently failed — retry.
			const hasServerMsgs = !!get(lastMsgRooms)[channelId];
			const hasClientMsgs = (get(channelMessages)[channelId]?.length ?? 0) > 0;
			if (hasClientMsgs || !hasServerMsgs) return;
		}
		loadedChannels.add(channelId);
		fetchingChannels.add(channelId);
		// Mutate instead of spread-replace — spreading reads the $state object
		// which makes it a reactive dependency of this $effect, causing spurious
		// re-runs when *other* channels finish loading and corrupting the
		// dependency set so the effect misses the activeChannelId change.
		channelInitialLoading[channelId] = true;

		getMessages(channelId)
			.then((raw) => {
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
				if (raw.length < 100) {
					console.log("[loadmore] initial fetch: only", raw.length, "msgs → marking hasMore=false for", channelId);
					channelHasMore[channelId] = false;
				} else {
					console.log("[loadmore] initial fetch: got", raw.length, "msgs → hasMore=true for", channelId);
				}
			})
			.catch((err) => {
				console.error("Failed to fetch history:", err);
				loadedChannels.delete(channelId);
				channelInitialLoading[channelId] = false;
			})
			.finally(() => fetchingChannels.delete(channelId));
	});

	async function loadMoreMessages() {
		console.log("[loadmore] loadMoreMessages called", {
			kind: node.kind,
			activeChannelId: node.kind === "leaf" ? node.activeChannelId : null,
			isLoadingMore,
			hasMore: node.kind === "leaf" && node.activeChannelId ? channelHasMore[node.activeChannelId] : "?",
		});
		if (node.kind !== "leaf" || !node.activeChannelId || isLoadingMore || activeChannel?.type !== "text") {
			return;
		}
		const channelId = node.activeChannelId;
		if (channelHasMore[channelId] === false) {
			console.log("[loadmore] skipped — channelHasMore is false for", channelId);
			return;
		}

		const current = $channelMessages[channelId];
		// Still fetching initial messages — don't interfere
		if (current === undefined || current === null) {
			console.log("[loadmore] skipped — no messages in store yet for", channelId);
			return;
		}
		// Loaded but empty channel → no history to fetch
		if (current.length === 0) {
			console.log("[loadmore] skipped — empty channel", channelId);
			channelHasMore[channelId] = false;
			return;
		}
		console.log("[loadmore] fetching older messages before oldest in", current.length, "msgs");

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
			console.log("[loadmore] loadMore fetch returned", raw.length, "msgs for", channelId);
			if (raw.length === 0) {
				console.log("[loadmore] no older msgs → marking hasMore=false");
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
			// On any error (including timeout), stop trying so the spinner clears
			channelHasMore[channelId] = false;
		} finally {
			isLoadingMore = false;
		}
	}

	async function loadMoreMessagesBelow() {
		if (node.kind !== "leaf" || !node.activeChannelId || isLoadingMoreBelow || activeChannel?.type !== "text") {
			return;
		}
		const channelId = node.activeChannelId;
		if (channelHasMoreBelow[channelId] !== true) {
			return;
		}

		const current = $channelMessages[channelId];
		if (!current || current.length === 0) {
			return;
		}

		let newest = current.at(0)!.id;
		for (const m of current) {
			if (m.id > newest) newest = m.id;
		}

		isLoadingMoreBelow = true;

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10_000);

		try {
			const raw = await getMessagesAfter(channelId, newest, controller.signal);
			clearTimeout(timeoutId);
			if (raw.length === 0) {
				channelHasMoreBelow[channelId] = false;
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
				if (raw.length < 100) {
					channelHasMoreBelow[channelId] = false;
				}
			}
		} catch (err) {
			clearTimeout(timeoutId);
			console.error("Failed to load more below:", err);
			channelHasMoreBelow[channelId] = false;
		} finally {
			isLoadingMoreBelow = false;
		}
	}

	async function jumpToMessage(channelId: string, messageId: string) {
		if (node.kind !== "leaf") return;

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
			channelMessages.update((all) => ({ ...all, [channelId]: combined }));
			channelHasMore[channelId] = rawAbove.length >= 100;
			channelHasMoreBelow[channelId] = rawBelow.length >= 100;
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

		const hasRoom = node.tabs.some((t) => t.channelId === req.roomId);
		const thisPaneIsFocused = focusedPaneId === node.id;
		if (!hasRoom && !thisPaneIsFocused) return;

		// Claim this request
		lastHandledJumpId = req.id;
		jumpToMessageRequest.set(null);

		if (!hasRoom) {
			// Open the tab first (find tab info from gateway spaces)
			const space = $gatewaySpaces.find((s) => s.id === req.spaceId);
			const room = space?.rooms.find((r) => r.id === req.roomId);
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

		void jumpToMessage(req.roomId, req.messageId);
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

	function handleTabClose(channelId: string) {
		if (node.kind !== "leaf") {
			return;
		}
		const idx = node.tabs.findIndex((t) => t.channelId === channelId);
		const tabs = node.tabs.filter((t) => t.channelId !== channelId);
		if (tabs.length === 0 && onClose) {
			onClose();
			return;
		}
		let activeChannelId = node.activeChannelId;
		if (activeChannelId === channelId) {
			activeChannelId = (tabs[idx] ?? tabs[idx - 1])?.channelId ?? null;
		}
		// Focus this pane AFTER the update (onUpdate triggers syncSidebarToLeaf
		// with the already-updated tree, so sidebarSpaceId gets the right guild).
		const leafId = node.id;
		onUpdate({ ...node, tabs, activeChannelId });
		onFocus(leafId);
	}

	function handleTabReorder(newTabs: Tab[]) {
		if (node.kind !== "leaf") {
			return;
		}
		onUpdate({ ...node, tabs: newTabs });
	}

	function handleChannelDrop(tab: Tab) {
		openTab(tab);
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
		handleTabClose(node.activeChannelId);
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
			};
			dragType = data.type === "tab" ? "tab" : "channel";
			sourceLeafId = data.sourceLeafId ?? null;
			if (data.channelId) {
				tab = {
					channelId: data.channelId,
					channelName: data.channelName ?? data.channelId,
					channelType: data.channelType ?? "text",
					spaceId: data.spaceId ?? "",
				};
			}
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
		showChannelsSidebar,
		onToggleChannels,
		showMembersSidebar,
		onToggleMembers,
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

		<!-- Resize handle -->
		<button
			type="button"
			class="shrink-0 {node.direction === 'h'
				? 'w-1 cursor-col-resize'
				: 'h-1 cursor-row-resize'} bg-zinc-800 transition-colors hover:bg-blue-500 active:bg-blue-400 {isDragging
				? 'bg-blue-500'
				: ''}"
			onmousedown={startResize}
			aria-label="Resize split"
		></button>

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
	     focus, like a split remounting its chat inputs. The keyboard has no pane focus to move. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<div
		class="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden {isFocused
			? 'ring-1 ring-blue-500/40 ring-inset'
			: ''}"
		role="region"
		aria-label="Chat pane"
		onclick={() => onFocus(node.id)}
	>
		<!-- Tab bar + pane actions -->
		<div class="flex min-w-0 shrink-0 items-stretch border-b border-zinc-800">
			<div class="min-w-0 flex-1 overflow-hidden">
				<TabBar
					tabs={node.tabs}
					activeTabId={node.activeChannelId}
					leafId={node.id}
					onSelect={handleTabSelect}
					onClose={handleTabClose}
					onReorder={handleTabReorder}
					onChannelDrop={handleChannelDrop}
				/>
			</div>

			<!-- Pane action buttons -->
			<div class="flex shrink-0 items-center gap-0.5 bg-zinc-900 px-1">
				{#if onToggleChannels}
					<button
						type="button"
						class="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
						onclick={onToggleChannels}
						aria-label={showChannelsSidebar ? "Collapse channels panel" : "Expand channels panel"}
						title={showChannelsSidebar ? "Hide channels" : "Show channels"}
					>
						{#if showChannelsSidebar}
							<PanelLeftClose class="size-4" />
						{:else}
							<PanelLeftOpen class="size-4" />
						{/if}
					</button>
				{/if}

				{#if onToggleMembers}
					<button
						type="button"
						class="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
						onclick={onToggleMembers}
						aria-label={showMembersSidebar ? "Collapse members panel" : "Expand members panel"}
						title={showMembersSidebar ? "Hide members" : "Show members"}
					>
						{#if showMembersSidebar}
							<PanelRightClose class="size-4" />
						{:else}
							<PanelRightOpen class="size-4" />
						{/if}
					</button>
				{/if}

				{#if onToggleChannels || onToggleMembers}
					<div class="mx-1 h-4 w-px bg-zinc-700"></div>
				{/if}

				<!-- Split horizontal -->
				<button
					type="button"
					class="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
					title="Split horizontally"
					onclick={splitH}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
					</svg>
				</button>
				<!-- Split vertical -->
				<button
					type="button"
					class="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
					title="Split vertically"
					onclick={splitV}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="12" x2="21" y2="12" />
					</svg>
				</button>
				<!-- Close pane -->
				{#if onClose}
					<button
						type="button"
						class="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-red-400"
						title="Close pane"
						onclick={onClose}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M18 6 6 18" /><path d="m6 6 12 12" />
						</svg>
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
			<!-- Drag-to-split overlay -->
			{#if contentDragOver}
				<div class="pointer-events-none absolute inset-0 z-30">
					<div
						class="absolute top-0 left-0 h-full w-1/4 transition-colors {splitZone === 'left'
							? 'border-2 border-blue-500 bg-blue-500/30'
							: 'border-2 border-transparent bg-blue-500/5'}"
					></div>
					<div
						class="absolute top-0 right-0 h-full w-1/4 transition-colors {splitZone === 'right'
							? 'border-2 border-blue-500 bg-blue-500/30'
							: 'border-2 border-transparent bg-blue-500/5'}"
					></div>
					<div
						class="absolute top-0 right-0 left-0 h-1/4 transition-colors {splitZone === 'top'
							? 'border-2 border-blue-500 bg-blue-500/30'
							: 'border-2 border-transparent bg-blue-500/5'}"
					></div>
					<div
						class="absolute right-0 bottom-0 left-0 h-1/4 transition-colors {splitZone === 'bottom'
							? 'border-2 border-blue-500 bg-blue-500/30'
							: 'border-2 border-transparent bg-blue-500/5'}"
					></div>
					{#if splitZone}
						<div class="absolute inset-0 flex items-center justify-center">
							<span
								class="rounded border border-blue-500/50 bg-zinc-900/90 px-2 py-1 text-xs font-medium text-blue-400"
							>
								{splitZone === "left"
									? "← Split left"
									: splitZone === "right"
										? "Split right →"
										: splitZone === "top"
											? "↑ Split up"
											: "Split down ↓"}
							</span>
						</div>
					{/if}
				</div>
			{/if}

			{#if activeChannel?.type === "text"}
				<Chat
					messages={activeMessages}
					channelId={node.activeChannelId ?? ""}
					spaceId={activeTab?.spaceId ?? ""}
					space={activeTabSpace}
					channelName={activeChannel.name}
					members={activeTabMembers}
					bind:isAtBottom={paneIsAtBottom}
					{isInitialLoading}
					{isLoadingMore}
					{isLoadingMoreBelow}
					hasMoreMessages={node.activeChannelId ? channelStillHasMore(node.activeChannelId) : true}
					hasMoreMessagesBelow={node.activeChannelId ? channelHasMoreBelow[node.activeChannelId] === true : false}
					highlightedMessageId={node.activeChannelId ? (channelHighlightedMessage[node.activeChannelId] ?? null) : null}
					unreadAfterMessageId={node.activeChannelId ? (channelUnreadAfter[node.activeChannelId] ?? null) : null}
					onLoadMore={loadMoreMessages}
					onLoadMoreBelow={loadMoreMessagesBelow}
					onUnreadMark={(msgId) => {
						const chId = node.kind === "leaf" ? node.activeChannelId : null;
						if (chId && channelUnreadAfter[chId] == null) {
							channelUnreadAfter[chId] = msgId;
						}
					}}
				/>
			{:else if activeChannel?.type === "voice"}
				<VoiceChannelView
					channelId={node.activeChannelId ?? ""}
					channelName={activeChannel.name}
					spaceId={activeTab?.spaceId ?? ""}
				/>
			{:else}
				<div class="flex flex-1 flex-col items-center justify-center gap-2 text-zinc-500">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="32"
						height="32"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="opacity-40"
					>
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
					<p class="text-sm opacity-50">Drag a channel here</p>
				</div>
			{/if}
		</div>
	</div>
{/if}
