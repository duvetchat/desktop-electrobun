<script lang="ts">
	import { hasPermission, mentionableRooms, Permission } from "$lib/permissions";
	import { onDestroy, onMount, tick, type Snippet } from "svelte";
	import {
		Eye as EyeIcon,
		Phone as PhoneIcon,
		Pin as PinIcon,
		PinOff as PinOffIcon,
		Reply as ReplyIcon,
		Users as UsersIcon,
	} from "@lucide/svelte";
	import { updateMessage, deleteMessage, getMessageThread, pinRoomMessage, unpinRoomMessage } from "$lib/api/messages";
	import { sendComponentInteraction, type ComponentUse } from "$lib/api/interactions";
	import {
		getConversationMessageThread,
		pinConversationMessage,
		unpinConversationMessage,
	} from "$lib/api/conversations";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { keyboard } from "$lib/keyboard.svelte";
	import { Dialog, Popover } from "bits-ui";
	import {
		currentUser,
		jumpToMessageRequest,
		pinsPanelRequest,
		gatewaySpaces,
		pageVisible,
		friends,
		sentFriendRequests,
		pendingFriendRequests,
		conversations,
		dropEphemeral,
		friendsReady,
		openRoomMention,
		onOpenElsewhere,
		reactorsRequest,
		lastReadConvs,
	} from "$lib/stores.svelte";
	import { toggleReaction } from "$lib/api/reactions";
	import { arrival, arrivalAction, listEnd } from "$lib/arrivals";
	import { callNoticeLine } from "$lib/call-notices";
	import { copyCode } from "$lib/code-copy";
	import { belowIndicator } from "$lib/jumps";
	import { threadNow } from "$lib/threads";
	import { keepPlace, takePlace } from "$lib/kept-places";
	import { largeEmojis } from "$lib/emoji";
	import { customEmojiMapOf, mentionMapOf, sameNames } from "$lib/markdown";
	import { nameColors } from "$lib/name-colors";

	import {
		gatewayMessageToMessage,
		isComponentsV2,
		isEphemeral,
		isLoading,
		isNotice,
		mentionsByReply,
		messageText,
		previewReplacesText,
	} from "$lib/types";
	import { MessageType, type MemberOnSidebar, type GatewaySpace, type Message, type SpaceEmoji } from "$lib/types";
	import { DUVET_DOMAIN } from "$lib/common/common";

	import AuthorTag from "$lib/components/AuthorTag.svelte";
	import DeferredResponse from "$lib/components/DeferredResponse.svelte";
	import MessageCards from "$lib/components/MessageCards.svelte";
	import MessageReactions from "$lib/components/MessageReactions.svelte";
	import MessageReference from "$lib/components/MessageReference.svelte";
	import MessageText from "$lib/components/MessageText.svelte";
	import MessageAttachments from "$lib/components/MessageAttachments.svelte";
	import MessageComponents from "$lib/components/MessageComponents.svelte";
	import MessagePreview from "$lib/components/MessagePreview.svelte";
	import MascotPeek from "$lib/components/MascotPeek.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import ChatInput from "$lib/components/ChatInput.svelte";
	import EmojiPicker from "$lib/components/EmojiPicker.svelte";
	import ImagePreview from "$lib/components/ImagePreview.svelte";
	import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";
	import MentionProfile from "$lib/components/MentionProfile.svelte";
	import { sendFriendRequest, getSentRequests } from "$lib/api/friends";
	import { updateUserFlagsBadges } from "$lib/api/user";
	import { getApiError } from "$lib/api/api";
	import { toast } from "$lib/stores/toast.svelte";
	import { get } from "svelte/store";
	import { FLAGS, BADGES, isStaff as checkStaff } from "$lib/badges";
	import { banRequest, kickFromSpace, moderationOf } from "$lib/moderation";

	let {
		messages,
		members = [],
		channelId = "",
		spaceId = "",
		space = null,
		isInitialLoading = false,
		isLoadingMore = false,
		isLoadingMoreBelow = false,
		hasMoreMessages = true,
		hasMoreMessagesBelow = false,
		highlightedMessageId = null,
		unreadAfterMessageId = null,
		onLoadMore = () => {},
		onLoadMoreBelow = () => {},
		onJumpToPresent = undefined,
		onRetry = () => {},
		onDismiss = () => {},
		onReply = undefined,
		onSaveEdit = undefined,
		onDeleteMsg = undefined,
		failedNonces = new Set<string>(),
		editingMessageId = $bindable<string | null>(null),
		editContent = $bindable(""),
		isAtBottom = $bindable(true),
		onUnreadMark = undefined,
		customEmojis = [],
		intro = undefined,
		retryFirstPage = null,
		threadComposer = undefined,
		onThreadReply = undefined,
	}: {
		messages: Message[];
		members?: MemberOnSidebar[];
		channelId?: string;
		spaceId?: string;
		space?: GatewaySpace | null;
		isInitialLoading?: boolean;
		isLoadingMore?: boolean;
		isLoadingMoreBelow?: boolean;
		hasMoreMessages?: boolean;
		hasMoreMessagesBelow?: boolean;
		highlightedMessageId?: string | null;
		unreadAfterMessageId?: string | null;
		onLoadMore?: () => Promise<void> | void;
		onLoadMoreBelow?: () => Promise<void> | void;
		/** Takes the list from a jump's pages to the present (the newest messages); true once it's there. */
		onJumpToPresent?: () => Promise<boolean>;
		onRetry?: (message: Message) => void;
		onDismiss?: (nonce: string) => void;
		onReply?: (message: Message) => void;
		onSaveEdit?: (messageId: string, content: string) => Promise<void> | void;
		onDeleteMsg?: (messageId: string) => Promise<void> | void;
		failedNonces?: Set<string>;
		editingMessageId?: string | null;
		editContent?: string;
		isAtBottom?: boolean;
		onUnreadMark?: (messageId: string) => void;
		customEmojis?: SpaceEmoji[];
		/** Shown above the oldest message once there's nothing older to load, and alone in a chat with no messages. */
		intro?: Snippet;
		/**
		 * Set while the chat's first page has failed: with nothing of the chat here, the list says so, with Try again,
		 * which calls this, rather than showing the chat's start.
		 */
		retryFirstPage?: (() => void) | null;
		/** The message box of a thread (its root), under the thread's messages: it replies in the thread. */
		threadComposer?: Snippet<[Message]>;
		/** A message of the thread of root picked to reply to, from the thread. */
		onThreadReply?: (message: Message, root: Message) => void;
	} = $props();

	// ── State ──────────────────────────────────────────────────────────────────
	let scrollEl: HTMLElement;
	// The list's newest end as the new-message effect last saw it.
	let prevEnd = listEnd([]);
	// Whether newer messages were still to load below (after a jump) when the new-message effect last ran: the last
	// page to load there comes with hasMoreMessagesBelow already off, so the list as it was before it is what tells.
	let newerBelow = false;
	// Non-reactive snapshot — updated by handleScroll, read by the new-message
	// effect BEFORE the DOM mutation triggers a synchronous scroll event that
	// would flip isAtBottom to false in flex-col-reverse.
	let wasAtBottom = true;
	// Newest confirmed message ID the user has seen (updated only while at bottom & visible).
	let lastSeenMsgId = "";
	let deletingMessageId = $state<string | null>(null);
	let activePopoverMsgId = $state<string | null>(null);
	let avatarPopoverWasOpen = false;
	let mentionProfile: MentionProfile;
	const openMention = (e: MouseEvent) => mentionProfile.open(e);

	// User context menu
	let userMenuPos = $state<{ x: number; y: number } | null>(null);
	let userMenuTargetId = $state<string | null>(null);

	function openUserMenu(e: MouseEvent, userId: string) {
		e.preventDefault();
		userMenuPos = { x: e.clientX, y: e.clientY };
		userMenuTargetId = userId;
	}

	function closeUserMenu() {
		userMenuPos = null;
		userMenuTargetId = null;
	}

	function isFriend(userId: string): boolean {
		return get(friends).some((f) => f.sender_id === userId || f.recipient_id === userId);
	}

	function hasPendingRequest(userId: string): boolean {
		return (
			get(sentFriendRequests).some((r) => r.recipient_id === userId) ||
			get(pendingFriendRequests).some((r) => r.sender_id === userId)
		);
	}

	async function handleSendFriendRequest(userId: string) {
		closeUserMenu();
		try {
			await sendFriendRequest(userId);
			const sent = await getSentRequests();
			sentFriendRequests.set(sent);
			toast("Friend request sent", "success");
		} catch (err) {
			toast(getApiError(err, "Failed to send friend request"), "error");
		}
	}

	// Staff flags/badges editor
	let flagsBadgesTarget = $state<{ id: string; flags: number; badges: number } | null>(null);
	let flagsBadgesOpen = $state(false);
	let flagsBadgesSaving = $state(false);
	let editFlags = $state(0);
	let editBadges = $state(0);

	const isStaff = $derived(checkStaff($currentUser?.flags ?? 0));

	function openFlagsBadgesEditor(userId: string) {
		closeUserMenu();
		const user = space?.users.find((u) => u.id === userId);
		if (!user) return;
		flagsBadgesTarget = { id: user.id, flags: user.flags ?? 0, badges: user.badges ?? 0 };
		editFlags = flagsBadgesTarget.flags;
		editBadges = flagsBadgesTarget.badges;
		flagsBadgesOpen = true;
	}

	async function saveFlagsBadges() {
		if (!flagsBadgesTarget) return;
		flagsBadgesSaving = true;
		try {
			await updateUserFlagsBadges(flagsBadgesTarget.id, { flags: editFlags, badges: editBadges });
			flagsBadgesOpen = false;
		} catch (err) {
			toast(getApiError(err, "Failed to update flags/badges"), "error");
		} finally {
			flagsBadgesSaving = false;
		}
	}

	function toggleFlag(flag: number) {
		editFlags = editFlags ^ flag;
	}

	function toggleBadge(badge: number) {
		editBadges = editBadges ^ badge;
	}

	let threadModalOpen = $state(false);
	let threadLoading = $state(false);
	let threadError = $state("");
	let threadMessages = $state.raw<Message[]>([]);
	let threadRootMessage = $state.raw<Message | null>(null);
	// The thread as it is now, with the replies the list has since it loaded, the user's own being sent among them.
	const threadShown = $derived(threadNow(threadMessages, messages));
	// A reply that comes while the thread shows goes at its end, which scrolls into view.
	let threadScrollEl = $state<HTMLElement | null>(null);
	let threadCount = 0;
	$effect(() => {
		const count = threadShown.length;
		const grew = threadCount > 0 && count > threadCount;
		threadCount = count;
		if (grew) void tick().then(() => threadScrollEl?.scrollTo({ top: threadScrollEl.scrollHeight }));
	});
	// What a thread's message opens elsewhere (its quote's message, a link's chip or card, an invite, who reacted) would
	// show under the thread: the thread closes first.
	onMount(() => onOpenElsewhere(() => (threadModalOpen = false)));
	let now = $state(Date.now());
	let intervalId: number;

	// The room's name, for the players' "now playing" (none in a conversation).
	const channelName = $derived(space?.rooms.find((r) => r.id === channelId)?.name ?? "");

	const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
	// Words are English, as next to them ("Today", "just now") and in the rest of the UI; clock times keep
	// the system's format.
	const dateFormatter = new Intl.DateTimeFormat("en", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
	const relativeFormatter = new Intl.RelativeTimeFormat("en", {
		numeric: "auto",
	});

	// ── Load-more on scroll ───────────────────────────────────────────────────
	// Blocked until the visit is placed (placeVisit): before that, a scroll event (the skeleton→messages
	// swap fires one) would set isAtBottom from a position that isn't the visit's yet.
	let scrollUnlocked = false;

	function handleScroll() {
		if (!scrollEl) return;

		// In flex-col-reverse, scrollTop=0 means the user is at the visual bottom (newest messages).
		if (scrollUnlocked) {
			const val = scrollEl.scrollTop >= -50;
			isAtBottom = val;
			wasAtBottom = val;
		}

		const scrollRect = scrollEl.getBoundingClientRect();

		if (!isLoadingMore && hasMoreMessages) {
			const sentinelTop = scrollEl.querySelector("[data-sentinel-top]");
			if (sentinelTop) {
				const r = sentinelTop.getBoundingClientRect();
				if (r.top < scrollRect.bottom && r.bottom > scrollRect.top) {
					void onLoadMore();
				}
			}
		}

		if (hasMoreMessagesBelow) checkBelow();
	}

	// The "newer messages below" indicator in view: the list stays a pixel off its very bottom (belowIndicator), also
	// while a page loads, and the page is asked for unless one is loading. The page goes in below what the reader sees,
	// and the browser keeps it in place (scroll anchoring), but not for a list scrolled to its very end, its bottom here.
	function checkBelow() {
		const sentinelBottom = scrollEl?.querySelector("[data-sentinel-bottom]");
		if (!scrollEl || !sentinelBottom) return;
		const scrollRect = scrollEl.getBoundingClientRect();
		const r = sentinelBottom.getBoundingClientRect();
		if (r.top >= scrollRect.bottom || r.bottom <= scrollRect.top) return;
		const next = belowIndicator(scrollEl.scrollTop, isLoadingMoreBelow);
		if (next.scrollTop !== null) scrollEl.scrollTop = next.scrollTop;
		if (next.ask) void onLoadMoreBelow();
	}

	function topObserverAction(_node: HTMLElement) {
		return { destroy() {} };
	}

	// ── Scroll to highlighted message ─────────────────────────────────────────
	// tick() waits for Svelte's DOM patch, but the browser still needs to
	// finish layout (especially with flex-col-reverse + many messages).
	// Two requestAnimationFrame calls ensure layout is complete before scrolling.
	$effect(() => {
		const id = highlightedMessageId;
		if (!id) return;
		void tick().then(() => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					const el = scrollEl?.querySelector(`[data-message-id="${id}"]`);
					if (el) {
						el.scrollIntoView({ behavior: "instant", block: "center" });
					}
				});
			});
		});
	});

	onMount(() => {
		intervalId = window.setInterval(() => {
			now = Date.now();
		}, 30_000);
		scrollEl?.addEventListener("click", copyCode);
		// In the capture phase, so the quote a mention sits in doesn't jump to its message too.
		scrollEl?.addEventListener("click", openRoomMention, true);
		scrollEl?.addEventListener("click", openMention, true);
	});

	// Once the list is gone, what it still waits for (a frame, a tick) stops before reading its props: a conversation's
	// view, gone with it (another tab shows), hands it a null conversation (desktop-electrobun#164).
	let gone = false;
	onDestroy(() => {
		gone = true;
		if (typeof window === "undefined") return;
		if (intervalId) {
			window.clearInterval(intervalId);
		}
		scrollEl?.removeEventListener("click", copyCode);
		scrollEl?.removeEventListener("click", openRoomMention, true);
		scrollEl?.removeEventListener("click", openMention, true);
	});

	// ── Sorting ────────────────────────────────────────────────────────────────
	// Each message's date read once, not twice per comparison (#324).
	const sortedMessages = $derived(
		messages
			.map((m, i) => ({ m, i, at: Date.parse(m.created_at) }))
			.sort((a, b) => {
				const aPending = a.m.id === a.m.nonce;
				const bPending = b.m.id === b.m.nonce;
				if (aPending !== bPending) {
					return aPending ? -1 : 1;
				}
				if (aPending && bPending) {
					return b.i - a.i;
				}
				return b.at - a.at;
			})
			.map(({ m }) => m),
	);

	// The user's membership here (their member_id): a conversation's, minted as they joined it, which its call notices
	// go by. A room has no call notices.
	const joined = $derived(members.find((m) => m.id === $currentUser?.id)?.member_id);
	// What each call notice says to this user, by its ID: its row, and the quote of a reply to it.
	const callNoticeLines = $derived(
		new Map(
			messages.flatMap((m) => {
				const line = callNoticeLine(m, $currentUser?.id, joined);
				return line ? [[m.id, line] as const] : [];
			}),
		),
	);
	const authorColors = $derived(nameColors(members));
	// The names mentions show: a new map only when one of them changes, not with every change of the members (a
	// presence, a voice state), which drew every message's text again (#324).
	let mentionNames: Record<string, string> = {};
	const mentionMap = $derived.by(() => {
		const next = mentionMapOf(members);
		if (!sameNames(next, mentionNames)) mentionNames = next;
		return mentionNames;
	});
	const customEmojiMap = $derived(customEmojiMapOf(customEmojis));
	// The rooms "#" suggests while a message is edited.
	const mentionRooms = $derived(space ? mentionableRooms(space) : []);

	// Uses a component of a bot's message. A modal the bot answers with opens with this room's members, roles
	// and rooms for its selects, under the bot's name.
	function interact(message: Message, use: ComponentUse) {
		return sendComponentInteraction(channelId, message.id, use, {
			space,
			members,
			from: { name: message.author_name, avatarUrl: message.author_avatar_url },
		});
	}

	// ── Image preview ─────────────────────────────────────────────────────────
	let previewSrc = $state("");
	let previewAlt = $state("");
	let previewOpen = $state(false);

	function openPreview(src: string, alt = "") {
		previewSrc = src;
		previewAlt = alt;
		previewOpen = true;
	}

	// ── Reaction helpers ──────────────────────────────────────────────────────
	let reactingMessageId = $state<string | null>(null);
	// The row the pointer is on, the one whose action toolbar is mounted, followed by one handler on the list: every row
	// mounted its own toolbar, hidden until hovered (#326).
	let hoveredMessageId = $state<string | null>(null);
	function hoverRow(e: MouseEvent) {
		const row = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-message-id]") : null;
		hoveredMessageId = row?.dataset.messageId ?? null;
	}

	const isConversation = $derived(!spaceId);

	function handleReactionToggle(message: Message, emojiName: string, emojiId?: string | null) {
		if (!$currentUser || !channelId) return;
		void toggleReaction({ spaceId, channelId }, message, $currentUser.id, emojiName, emojiId);
	}

	// Who reacted to a message: from its menu, on its first reaction, or from a reaction's right click, on that one.
	function showReactors(message: Message, picked = message.reactions?.[0]?.emoji_name ?? "") {
		reactorsRequest.set({ messageId: message.id, reactions: message.reactions ?? [], picked, members, customEmojiMap });
	}

	function handleReactionPick(messageId: string, emoji: string) {
		reactingMessageId = null;
		const message = messages.find((m) => m.id === messageId);
		if (!message) return;
		// Custom emoji: <:id:>
		if (emoji.startsWith("<:") && emoji.endsWith(":>")) {
			const id = emoji.slice(2, -2);
			const ce = customEmojis.find((e) => e.id === id);
			handleReactionToggle(message, ce?.name ?? id, id);
		} else {
			// Unicode emoji
			handleReactionToggle(message, emoji);
		}
	}

	// ── Unread divider ─────────────────────────────────────────────────────────
	// UUID v7 is lexicographically sortable, so string comparison gives chronological order.
	// unreadDividerIdx = first index in sortedMessages where the message id <= unreadAfterMessageId
	// (i.e. that message is read). All messages before that index are unread.
	const unreadDividerIdx = $derived.by(() => {
		if (!unreadAfterMessageId) return null;
		for (let i = 0; i < sortedMessages.length; i++) {
			if (sortedMessages[i].id <= unreadAfterMessageId) {
				return i;
			}
		}
		return sortedMessages.length; // all loaded messages are unread
	});
	const unreadCount = $derived(unreadDividerIdx ?? 0);

	// ── Where a visit opens ────────────────────────────────────────────────────
	// The list stays mounted across channels and while hidden (the friends view hides it), and a hidden
	// list has no size: it can't be scrolled, and it loses its position. So each visit (another channel,
	// or the list showing again) is placed once it's loaded and visible: at the unread divider, with the
	// last read message at the top, when there is one, else at the bottom (a jump to a highlighted
	// message places itself). Only then does isAtBottom follow the real position, which unblocks the acks.
	let visitChannel = "";
	let placedFor = "";
	// The dividers this visit has scrolled to: one placed later in it (new messages while away from the
	// bottom) is scrolled to once.
	let scrolledUnreadIds = new Set<string>();

	function startVisit() {
		placedFor = "";
		scrolledUnreadIds = new Set();
		scrollUnlocked = false;
		isAtBottom = false;
	}

	function placeVisit() {
		const chId = channelId;
		if (
			placedFor === chId ||
			isInitialLoading ||
			sortedMessages.length === 0 ||
			!scrollEl ||
			scrollEl.clientHeight === 0
		)
			return;
		placedFor = chId;
		const id = unreadAfterMessageId;
		const unread = !!id && !!unreadDividerIdx;
		if (id && unread) scrolledUnreadIds.add(id);
		const jumping = !!highlightedMessageId;
		const kept = takePlace(chId);
		void tick().then(() => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (gone || channelId !== chId || !scrollEl) return;
					const keptEl = kept && scrollEl.querySelector(`[data-message-id="${kept.messageId}"]`);
					if (kept && keptEl && !jumping) {
						// Back where the reader was when a new gateway session unmounted the app (keepReaderPlace).
						const listTop = scrollEl.getBoundingClientRect().top;
						scrollEl.scrollTop += keptEl.getBoundingClientRect().top - listTop - kept.offset;
					} else if (!jumping) {
						const target = unread
							? (scrollEl.querySelector(`[data-message-id="${id}"]`) ?? scrollEl.querySelector("[data-unread-divider]"))
							: null;
						if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
						else scrollEl.scrollTop = 0;
					}
					// One more frame, so the position read is the one just set.
					requestAnimationFrame(() => {
						if (gone || channelId !== chId || !scrollEl) return;
						isAtBottom = scrollEl.scrollTop >= -50;
						wasAtBottom = isAtBottom;
						scrollUnlocked = true;
						// A visit that opens on the indicator (a jump's pages shown again) needs no scroll to ask for the page
						// below: there, at the list's very bottom, scrolling down fires nothing.
						if (hasMoreMessagesBelow) checkBelow();
					});
				});
			});
		});
	}

	// A new gateway session (the gateway restarted, or the connection was lost for longer than a resume allows)
	// unmounts the app until that session's friends and conversations are in: its READY clears friendsReady. While the
	// list is still on screen then, the place of a reader up in it is kept, and the list mounted after it goes back
	// there (placeVisit) rather than to its bottom.
	function keepReaderPlace() {
		if (!scrollEl || !scrollUnlocked || wasAtBottom || scrollEl.clientHeight === 0) return;
		const view = scrollEl.getBoundingClientRect();
		// The message at the bottom of the view: the first one in the DOM wholly in it, as the list runs bottom to top,
		// or else the first one in it at all (a message taller than the view).
		let partly: { messageId: string; offset: number } | null = null;
		for (const el of scrollEl.querySelectorAll<HTMLElement>("[data-message-id]")) {
			const r = el.getBoundingClientRect();
			if (r.bottom <= view.top || r.top >= view.bottom) continue;
			const place = { messageId: el.dataset.messageId ?? "", offset: r.top - view.top };
			if (r.top >= view.top && r.bottom <= view.bottom) {
				keepPlace(channelId, place);
				return;
			}
			partly ??= place;
		}
		if (partly) keepPlace(channelId, partly);
	}

	onMount(() => {
		let ready = get(friendsReady);
		return friendsReady.subscribe((isReady) => {
			if (ready && !isReady) keepReaderPlace();
			ready = isReady;
		});
	});

	$effect(() => {
		const chId = channelId;
		if (chId !== visitChannel) {
			visitChannel = chId;
			// Before the new-message effect below sees this channel's messages: compared with the last
			// channel's, they would pass for new ones.
			prevEnd = listEnd([]);
			lastSeenMsgId = "";
			startVisit();
		}
		placeVisit();
	});

	// The list showing again is a visit too; while hidden, it's at the bottom of nothing anyone sees.
	$effect(() => {
		const el = scrollEl;
		let shown = el.clientHeight > 0;
		const observer = new ResizeObserver(() => {
			const showing = el.clientHeight > 0;
			if (showing && !shown) {
				startVisit();
				placeVisit();
			} else if (!showing && shown) {
				isAtBottom = false;
				wasAtBottom = false;
			}
			shown = showing;
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	// A divider placed later in the visit (new messages while the window was away) is scrolled to once, when the
	// list was at its bottom. Not while the user reads further up: there it only shows, rather than move them.
	$effect(() => {
		const id = unreadAfterMessageId;
		const idx = unreadDividerIdx;
		const chId = channelId;
		if (placedFor !== chId || !id || !idx || scrolledUnreadIds.has(id) || !wasAtBottom) return;
		scrolledUnreadIds.add(id);
		void tick().then(() => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (gone || channelId !== chId || !scrollEl) return;
					const target =
						scrollEl.querySelector(`[data-message-id="${id}"]`) ?? scrollEl.querySelector("[data-unread-divider]");
					target?.scrollIntoView({ behavior: "instant", block: "start" });
				});
			});
		});
	});

	// ── Auto-scroll / unread divider when new messages arrive ──────────────────
	$effect(() => {
		const end = listEnd(messages);
		const visible = $pageVisible;

		// When page becomes visible again, sync scroll state with actual position
		// (it may be stale if messages arrived while the tab was hidden). Not before the visit is placed,
		// nor while the list is hidden: its scrollTop is then no position anyone sees.
		if (visible && scrollUnlocked && scrollEl && scrollEl.clientHeight > 0) {
			const val = scrollEl.scrollTop >= -50;
			wasAtBottom = val;
			isAtBottom = val;
		}

		// The list also grows when scrolling up loads older messages: only what made its newest end newer is new. And
		// after a jump, what loads below is history the reader scrolls into. A conversation's read position says what
		// the user has read already: a call notice of a call they saw (DM_MESSAGE_CREATE moved it there first).
		const arrived = arrival(prevEnd, end);
		const readUpTo = isConversation ? get(lastReadConvs)?.[channelId] : undefined;
		const action = arrived && arrivalAction(arrived, $currentUser?.id, wasAtBottom && visible, newerBelow, readUpTo);
		if (action === "bottom") {
			// A message this window sends, or any while the user is at the bottom and looking.
			tick().then(() => {
				if (scrollEl) scrollEl.scrollTop = 0;
			});
		} else if (action === "present") {
			// A message this window sends from a jump's pages: the list goes to the present, then down to the message. Should
			// the newest messages not load, it goes down to the bottom it has, where the pages below load as before.
			const chId = channelId;
			void tick()
				.then(() => (onJumpToPresent ? onJumpToPresent() : false))
				.catch(() => false)
				.then(() => tick())
				.then(() => {
					if (!gone && channelId === chId && scrollEl) scrollEl.scrollTop = 0;
				});
		} else if (action === "unread" && lastSeenMsgId) {
			// Scrolled up or page hidden — place the unread divider.
			onUnreadMark?.(lastSeenMsgId);
		}

		// Keep lastSeenMsgId in sync while the user is actively viewing.
		// Update when at bottom AND (page visible OR first initialisation).
		// Without the init path, lastSeenMsgId stays "" and onUnreadMark
		// never fires when the page is hidden before any scroll event.
		if (wasAtBottom && (visible || !lastSeenMsgId) && end.newest) {
			lastSeenMsgId = end.newest.id;
		}

		prevEnd = end;
		newerBelow = hasMoreMessagesBelow;
	});

	// ── Formatting ─────────────────────────────────────────────────────────────
	function isSameCalendarDay(a: string, b: string): boolean {
		const da = new Date(a);
		const db = new Date(b);
		return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
	}

	function formatDateSeparator(dateStr: string): string {
		const date = new Date(dateStr);
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);
		if (isSameCalendarDay(dateStr, today.toISOString())) {
			return "Today";
		}
		if (isSameCalendarDay(dateStr, yesterday.toISOString())) {
			return "Yesterday";
		}
		return dateFormatter.format(date);
	}

	function formatTimestamp(dateStr: string, _now: number) {
		const then = new Date(dateStr).getTime();
		if (Number.isNaN(then)) {
			return "just now";
		}
		const seconds = Math.round((then - _now) / 1000);
		if (Math.abs(seconds) < 45) {
			return "just now";
		}
		const minutes = Math.round(seconds / 60);
		if (Math.abs(minutes) < 60) {
			return relativeFormatter.format(minutes, "minute");
		}
		const hours = Math.round(minutes / 60);
		if (Math.abs(hours) < 24) {
			return relativeFormatter.format(hours, "hour");
		}
		const days = Math.round(hours / 24);
		if (Math.abs(days) < 7) {
			return relativeFormatter.format(days, "day");
		}
		return relativeFormatter.format(Math.round(days / 7), "week");
	}

	// ── Message actions ────────────────────────────────────────────────────────
	function startEdit(message: Message) {
		editingMessageId = message.id;
		editContent = message.content ?? "";
	}

	function cancelEdit() {
		editingMessageId = null;
		editContent = "";
	}

	function saveEdit(messageId: string, content: string) {
		const original = messages.find((m) => m.id === messageId)?.content;
		const trimmed = content.trim();
		if (trimmed && trimmed !== original) {
			if (onSaveEdit) {
				Promise.resolve(onSaveEdit(messageId, trimmed)).catch(console.error);
			} else {
				updateMessage(messageId, trimmed, channelId).catch(console.error);
			}
		}
		cancelEdit();
	}

	function handleCopy(e: ClipboardEvent) {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;
		const fragment = selection.getRangeAt(0).cloneContents();
		function extractText(node: Node): string {
			if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
			if (node.nodeName === "IMG") return (node as HTMLImageElement).alt ?? "";
			return Array.from(node.childNodes).map(extractText).join("");
		}
		const text = extractText(fragment);
		e.clipboardData?.setData("text/plain", text);
		e.preventDefault();
	}

	// Asks first, as deleting a channel does: there's no undo. A failure shows in the dialog.
	function handleDelete(messageId: string) {
		return confirmAction("Delete this message? This can't be undone.", "Delete", async () => {
			deletingMessageId = messageId;
			try {
				if (onDeleteMsg) {
					await onDeleteMsg(messageId);
				} else {
					await deleteMessage(messageId, channelId);
				}
			} finally {
				deletingMessageId = null;
			}
		});
	}

	async function openThreadModal(message: Message) {
		threadModalOpen = true;
		threadLoading = true;
		threadError = "";
		threadMessages = [];
		threadRootMessage = message;

		try {
			// A conversation's thread has an endpoint of its own: channelId is the conversation there.
			const thread = isConversation
				? await getConversationMessageThread(channelId, message.id)
				: await getMessageThread(channelId, message.id);
			threadMessages = thread.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
		} catch (e) {
			threadError = getApiError(e, "Failed to load message thread.");
		} finally {
			threadLoading = false;
		}
	}

	// An image of the thread opens over the app, and the thread closes first: under the image, it would keep
	// the keyboard, and Escape would close it instead of the image.
	function previewFromThread(src: string, alt?: string) {
		threadModalOpen = false;
		openPreview(src, alt);
	}

	// Whether the current user has a permission in this room (the owner has every one); false outside spaces.
	function currentUserCan(flag: number): boolean {
		if (!$currentUser || !space) {
			return false;
		}
		const room = space.rooms.find((r) => r.id === channelId);
		return !!room && hasPermission(space, room, flag);
	}

	// Pins are for those with PinMessages in a room, and for every member of a conversation.
	const canPin = $derived(isConversation || currentUserCan(Permission.PinMessages));

	// A notice isn't its author's to delete (a pin notice's pinner, a call notice's caller), as the API has it:
	// ManageMessages deletes it in a room, the owner in a group, and either member in a DM.
	const canDeleteNotices = $derived.by(() => {
		if (!isConversation) return currentUserCan(Permission.ManageMessages);
		const conversation = $conversations.find((c) => c.id === channelId);
		return !!conversation && (conversation.type !== 2 || conversation.owner_id === $currentUser?.id);
	});
	let pinningMessageId = $state<string | null>(null);

	async function togglePin(message: Message) {
		const pin = !message.pinned_at;
		pinningMessageId = message.id;
		try {
			if (isConversation) await (pin ? pinConversationMessage : unpinConversationMessage)(channelId, message.id);
			else await (pin ? pinRoomMessage : unpinRoomMessage)(channelId, message.id);
		} catch (err) {
			toast(getApiError(err, pin ? "Couldn't pin the message" : "Couldn't unpin the message"), "error");
		} finally {
			pinningMessageId = null;
		}
	}

	// A pin notice's link to the message it pinned.
	function jumpToPinned(message: Message) {
		const messageId = message.referenced_message?.message_id;
		if (!messageId) return;
		jumpToMessageRequest.set(
			isConversation
				? { id: crypto.randomUUID(), spaceId: "", roomId: "", messageId, conversationId: channelId }
				: { id: crypto.randomUUID(), spaceId, roomId: channelId, messageId },
		);
	}
</script>

<!-- The space under the newest message is the list's padding (pb-4), not that message's margin: a margin that changes
     when another message comes below it stops the browser from keeping the reader's place (scroll anchoring). -->
<!-- Its mouse handlers only follow the pointer's row, for that row's action toolbar (hoverRow), as :hover did. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div
	bind:this={scrollEl}
	class="flex flex-1 flex-col-reverse overflow-x-clip overflow-y-auto px-4 pt-2 pb-4"
	onscroll={handleScroll}
	oncopy={handleCopy}
	onmouseover={hoverRow}
	onmouseleave={() => (hoveredMessageId = null)}
>
	{#if isInitialLoading}
		<div class="flex flex-col-reverse gap-4 pb-2">
			{#each { length: 6 } as _, i}
				{@const wide = i % 3 === 0}
				<div class="-mx-4 mt-4 flex items-start gap-3 px-4">
					<div class="size-10 shrink-0 animate-pulse rounded-full bg-zinc-700"></div>
					<div class="flex flex-1 flex-col gap-2">
						<div class="h-3 w-24 animate-pulse rounded bg-zinc-700"></div>
						<div class="h-3 {wide ? 'w-4/5' : 'w-2/5'} animate-pulse rounded bg-zinc-700"></div>
						{#if wide}
							<div class="h-3 w-3/5 animate-pulse rounded bg-zinc-700"></div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else if messages.length === 0}
		{#if retryFirstPage}
			<div class="my-auto flex flex-col items-center px-6 py-16 text-center" role="status">
				<MascotPeek class="w-24" mood="shy" />
				<p class="text-duvet-ink mt-4 text-base font-bold">Couldn't load messages</p>
				<button
					type="button"
					class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised hover:text-duvet-ink mt-5 flex h-8 items-center rounded-xl px-3 text-[13px] font-bold transition-colors motion-reduce:transition-none"
					onclick={() => retryFirstPage?.()}
				>
					Try again
				</button>
			</div>
		{:else if intro}
			{@render intro()}
		{:else}
			<div class="mb-5 py-4 text-center text-zinc-400 italic">No messages yet. Send the first message.</div>
		{/if}
	{:else}
		<!-- Bottom sentinel: first in DOM → appears at visual bottom in flex-col-reverse.
             Visible when user scrolls to the bottom (newest messages area). One height whether it spins or not, and
             shrink-0, as the list's flex column would shrink it to its content: a change would move the list (scroll
             anchoring), whose scroll asks for the page below again. Never the node the browser keeps in view as a page
             goes in (overflow-anchor none): Firefox picked it, and so took the reader to each new page's end. -->
		{#if hasMoreMessagesBelow}
			<div
				data-sentinel-bottom
				class="flex h-11 w-full shrink-0 flex-col items-center justify-center gap-1 [overflow-anchor:none]"
			>
				{#if isLoadingMoreBelow}
					<svg
						class="h-5 w-5 animate-spin text-zinc-400"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
				{:else}
					<span class="text-xs text-zinc-500">Newer messages below</span>
				{/if}
			</div>
		{/if}

		{#each sortedMessages as message, i (message.id)}
			{@const chronoPrev = sortedMessages.at(i + 1)}
			{@const isConsecutive =
				chronoPrev &&
				!isNotice(chronoPrev) &&
				chronoPrev.author_id === message.author_id &&
				chronoPrev.author_name === message.author_name &&
				isEphemeral(chronoPrev) === isEphemeral(message) &&
				new Date(message.created_at).getTime() - new Date(chronoPrev.created_at).getTime() <= 5 * 60 * 1_000}
			{@const showHeader = !isConsecutive || !!message.referenced_message || !!message.interaction_metadata}
			{@const isDifferentDay = !chronoPrev || !isSameCalendarDay(message.created_at, chronoPrev.created_at)}
			{@const isPending = message.id === message.nonce}
			{@const isFailed = isPending && failedNonces.has(message.nonce ?? "")}
			{@const ephemeral = isEphemeral(message)}
			{@const emojiOnly = largeEmojis(message.content ?? "")}

			{@const isHighlighted = highlightedMessageId === message.id}
			{@const isMention =
				!!$currentUser &&
				message.author_id !== $currentUser.id &&
				(messageText(message).includes(`<@${$currentUser.id}>`) || mentionsByReply(message, $currentUser.id))}
			{@const msgMember = members.find((m) => m.id === message.author_id)}
			{@const callLine = callNoticeLines.get(message.id)}
			{#if message.type === MessageType.PinNotice || callLine}
				<!-- A notice: who pinned which message, as Discord shows it, or a call of the conversation that ended -->
				<div
					data-message-id={message.id}
					class="group relative -mx-3 mb-1 flex items-center rounded-md px-3 py-1 {showHeader
						? 'mt-4'
						: 'mt-1'} {isHighlighted ? 'bg-yellow-500/15' : 'hover:bg-zinc-800/55'} {keyboard.cursor === message.id
						? 'outline-duvet-accent outline-2 -outline-offset-2'
						: ''}"
				>
					<div class="mr-3 flex w-10 shrink-0 justify-end">
						{#if callLine}
							<!-- Red for a call the user missed -->
							<PhoneIcon class="size-4 {callLine.missed ? 'text-red-400' : 'text-zinc-500'}" />
						{:else}
							<PinIcon class="size-4 text-zinc-500" />
						{/if}
					</div>
					<p class="min-w-0 text-sm text-zinc-400">
						{#if callLine}
							{callLine.before}<span class="font-medium text-zinc-200">{callLine.name}</span>{callLine.after}
						{:else}
							<span class="font-medium text-zinc-200">{message.author_name}</span>
							pinned
							<button
								type="button"
								class="font-medium text-zinc-200 hover:underline"
								onclick={() => jumpToPinned(message)}>a message</button
							>
							to this {isConversation ? "conversation" : "room"}. See all
							<button
								type="button"
								class="font-medium text-zinc-200 hover:underline"
								onclick={() => pinsPanelRequest.set({ id: crypto.randomUUID(), channelId })}>pinned messages</button
							>.
						{/if}
						<span class="ml-1 text-xs text-zinc-500">{formatTimestamp(message.created_at, now)}</span>
					</p>
					{#if canDeleteNotices && hoveredMessageId === message.id}
						<div
							class="absolute -top-3 right-2 z-10 flex overflow-hidden rounded border border-zinc-800 bg-zinc-700 shadow-sm"
						>
							{@render deleteButton(message)}
						</div>
					{/if}
				</div>
			{:else}
				<div
					data-message-id={message.id}
					class="group relative mb-1 flex flex-col rounded-md px-3 {message.referenced_message ||
					message.interaction_metadata
						? 'mt-2 pt-2'
						: showHeader
							? 'mt-3'
							: 'mt-0'} {isFailed
						? 'bg-red-500/10 hover:bg-red-500/15'
						: isHighlighted
							? 'bg-yellow-500/15 hover:bg-yellow-500/20'
							: isMention
								? 'border-l-2 border-yellow-500/60 bg-yellow-500/10 hover:bg-yellow-500/15'
								: 'hover:bg-zinc-800/55'} -mx-3 {keyboard.cursor === message.id
						? 'outline-duvet-accent outline-2 -outline-offset-2'
						: ''}"
					style={isFailed ? "" : isPending ? "opacity: 0.5; pointer-events: none;" : ""}
				>
					{#if keyboard.cursor === message.id && !isPending && !ephemeral}
						<!-- What the keys do here, while keyboard navigation's cursor is on this message. -->
						<span
							class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised pointer-events-none absolute right-3 -bottom-3 z-10 flex items-center gap-2 rounded-lg px-2 py-0.5 text-[11px] font-medium"
							aria-hidden="true"
						>
							<span><kbd class="text-duvet-ink font-bold">r</kbd> reply</span>
							{#if $currentUser && message.author_id === $currentUser.id}
								<span><kbd class="text-duvet-ink font-bold">e</kbd> edit</span>
							{/if}
						</span>
					{/if}
					<MessageReference
						{message}
						quotedCall={callNoticeLines.get(message.referenced_message?.message_id ?? "")}
						{mentionMap}
						{customEmojiMap}
						{spaceId}
						{channelId}
					/>
					<div class="flex items-start">
						{#if showHeader}
							{#key message.author_avatar_url}
								<button
									type="button"
									class="mt-0.5 mr-3 shrink-0 rounded-full {msgMember ? 'cursor-pointer' : 'cursor-default'}"
									onmousedown={() => {
										avatarPopoverWasOpen = activePopoverMsgId === message.id;
									}}
									onclick={() => {
										if (!msgMember) return;
										if (avatarPopoverWasOpen) return;
										activePopoverMsgId = message.id;
									}}
								>
									<UserAvatar
										src={message.author_avatar_url}
										name={message.author_name}
										size={40}
										oncontextmenu={(e) => openUserMenu(e, message.webhook_id ? "" : message.author_id)}
									/>
								</button>
							{/key}
						{:else}
							<div class="mr-3 w-10 shrink-0 text-right">
								<span
									class="text-xxs leading-5 whitespace-nowrap text-zinc-500 opacity-0 select-none group-hover:opacity-100"
								>
									{new Date(message.created_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
								</span>
							</div>
						{/if}

						<div class="flex min-w-0 flex-1 flex-col">
							{#if showHeader}
								<div class="flex items-center leading-5">
									{#if msgMember}
										<MemberProfilePopover
											member={msgMember}
											{spaceId}
											{space}
											side="right"
											open={activePopoverMsgId === message.id}
											onOpenChange={(o) => {
												activePopoverMsgId = o ? message.id : null;
											}}
											triggerClass="font-semibold mr-2 hover:underline cursor-pointer"
											triggerStyle={authorColors[message.author_id] || "color: var(--color-zinc-100)"}
										>
											{#snippet children()}
												{message.author_name}
											{/snippet}
										</MemberProfilePopover>
									{:else}
										<span
											class="mr-2 cursor-default font-semibold"
											style={authorColors[message.author_id] || "color: var(--color-zinc-100)"}
										>
											{message.author_name}
										</span>
									{/if}
									<AuthorTag {message} class="mr-1.5" />
									<span class="text-xs font-medium text-zinc-400">{formatTimestamp(message.created_at, now)}</span>
								</div>
							{/if}

							{#if editingMessageId === message.id}
								<div class="relative flex w-full flex-col gap-1">
									<ChatInput
										initialValue={editContent}
										onValueChange={(text) => {
											editContent = text;
										}}
										onSubmit={(text) => saveEdit(message.id, text)}
										onCancel={cancelEdit}
										showActions={false}
										autofocus
										{members}
										{customEmojis}
										rooms={mentionRooms}
									/>
									<div class="text-xxs text-zinc-400">
										escape to <button
											type="button"
											class="cursor-pointer text-stone-300 hover:underline"
											onclick={cancelEdit}>cancel</button
										>
										• enter to
										<button
											type="button"
											class="cursor-pointer text-stone-300 hover:underline"
											onclick={() => saveEdit(message.id, editContent)}>save</button
										>
									</div>
								</div>
							{:else if message.type === MessageType.Voice || message.sticker_attachment_id}
								<MessageAttachments {message} {channelName} onPreview={openPreview} />
							{:else if isLoading(message)}
								<!-- A bot's deferred response: it has 15 minutes to complete it -->
								<DeferredResponse {message} />
							{:else if isComponentsV2(message)}
								<!-- The components are all of it: its files show where they place them -->
								<MessageComponents
									components={message.components ?? []}
									{space}
									{members}
									{mentionMap}
									{customEmojiMap}
									onPreview={openPreview}
									onInteract={isConversation ? undefined : (use) => interact(message, use)}
								/>
							{:else}
								{#if !previewReplacesText(message)}
									<div
										role="textbox"
										aria-readonly="true"
										tabindex="-1"
										class="{isFailed ? 'text-red-400' : 'text-zinc-200'} {emojiOnly
											? ''
											: showHeader
												? ''
												: 'leading-5'} cursor-text pr-12 text-left wrap-break-word select-text"
										style={emojiOnly ? "line-height: 3rem" : ""}
										onclick={(e) => {
											if (e.detail === 3 && $currentUser && message.author_id === $currentUser.id) {
												startEdit(message);
											}
										}}
										onkeydown={(e) => {
											if (e.key === "Enter" && $currentUser && message.author_id === $currentUser.id) {
												startEdit(message);
											}
										}}
									>
										<MessageText
											content={message.content ?? ""}
											large={emojiOnly}
											{mentionMap}
											{customEmojiMap}
											edited={message.updated_at !== message.created_at
												? `edited ${formatTimestamp(message.updated_at, now)}`
												: null}
										/>
									</div>
								{/if}
								<MessageCards
									content={message.content ?? ""}
									embeds={message.embeds}
									onPreview={(src) => openPreview(src)}
								/>
								<MessageAttachments {message} {channelName} onPreview={openPreview} />
								{#if message.components?.length}
									<!-- Rows of buttons and selects below the content -->
									<MessageComponents
										components={message.components}
										{space}
										{members}
										{mentionMap}
										{customEmojiMap}
										onPreview={openPreview}
										onInteract={isConversation ? undefined : (use) => interact(message, use)}
									/>
								{/if}
							{/if}

							<MessageReactions
								reactions={message.reactions ?? []}
								{customEmojiMap}
								onToggle={(r) => handleReactionToggle(message, r.emoji_name, r.emoji_id)}
								onShowReactors={(r) => showReactors(message, r.emoji_name)}
							/>
							{#if ephemeral}
								<!-- A bot's to this user alone, and not the room's: it lasts until dismissed or the app reloads.
								     Nothing of the room's (reactions, replies, pins, links) applies to it, so it has no toolbar. -->
								<p class="mt-1 flex items-center gap-1 text-xs text-zinc-400">
									<EyeIcon class="size-4 shrink-0" />
									<span>Only you can see this</span>
									<span aria-hidden="true">·</span>
									<button
										type="button"
										class="cursor-pointer text-stone-300 hover:underline"
										onclick={() => dropEphemeral(channelId, message.id)}>Dismiss message</button
									>
								</p>
							{/if}
						</div>
					</div>
					<!-- end inner row -->

					<!-- Action toolbar -->
					{#if isFailed}
						<div
							class="absolute -top-3 right-4 z-10 flex overflow-hidden rounded border border-zinc-800 bg-zinc-700 shadow-sm"
						>
							<button
								class="px-2 py-1.5 text-xs text-stone-300 transition-colors hover:bg-zinc-600"
								onclick={() => onRetry(message)}>Retry</button
							>
							<div class="w-px bg-zinc-800"></div>
							<button
								class="px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-white"
								onclick={() => onDismiss(message.nonce!)}>Dismiss</button
							>
						</div>
					{:else if (hoveredMessageId === message.id || reactingMessageId === message.id) && !isPending && !ephemeral && $currentUser && message.author_id === $currentUser.id && editingMessageId !== message.id}
						<div
							class="absolute -top-3 right-2 z-10 flex overflow-hidden rounded border border-zinc-800 bg-zinc-700 shadow-sm"
						>
							<Popover.Root
								bind:open={() => reactingMessageId === message.id, (v) => (reactingMessageId = v ? message.id : null)}
							>
								<Popover.Trigger
									class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
									title="Add reaction"
									aria-label="Add reaction"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line
											x1="9"
											x2="9.01"
											y1="9"
											y2="9"
										/><line x1="15" x2="15.01" y1="9" y2="9" /></svg
									>
								</Popover.Trigger>
								<!-- Mounted only while open: bits-ui's Portal mounts what it holds as it's created, open or not (#319). -->
								{#if reactingMessageId === message.id}
									<Popover.Portal>
										<Popover.Content side="top" align="end" sideOffset={8} class="z-100">
											<EmojiPicker onSelect={(emoji) => handleReactionPick(message.id, emoji)} {customEmojis} />
										</Popover.Content>
									</Popover.Portal>
								{/if}
							</Popover.Root>
							{@render reactionsButton(message)}
							<div class="w-px bg-zinc-800"></div>
							<button
								class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
								onclick={() => onReply?.(message)}
								title="Reply"
								aria-label="Reply"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg
								>
							</button>
							<div class="w-px bg-zinc-800"></div>
							<button
								class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
								onclick={() => {
									navigator.clipboard
										.writeText(
											`${isConversation ? `${DUVET_DOMAIN}/conversations/${channelId}/${message.id}` : `${DUVET_DOMAIN}/channels/${spaceId}/${channelId}/${message.id}`}`,
										)
										.catch(console.error);
								}}
								title="Copy message link"
								aria-label="Copy message link"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path
										d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
									/></svg
								>
							</button>
							<div class="w-px bg-zinc-800"></div>
							<button
								class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
								onclick={() => openThreadModal(message)}
								title="View thread"
								aria-label="View thread"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg
								>
							</button>
							{#if canPin}
								<div class="w-px bg-zinc-800"></div>
								<button
									class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
									onclick={() => togglePin(message)}
									disabled={pinningMessageId === message.id}
									title={message.pinned_at ? "Unpin message" : "Pin message"}
									aria-label={message.pinned_at ? "Unpin message" : "Pin message"}
								>
									{#if message.pinned_at}
										<PinOffIcon class="size-4" />
									{:else}
										<PinIcon class="size-4" />
									{/if}
								</button>
							{/if}
							<div class="w-px bg-zinc-800"></div>
							<button
								class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-white"
								onclick={() => {
									startEdit(message);
								}}
								title="Edit message"
								aria-label="Edit message"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path
										d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
									/><path d="m15 5 4 4" /></svg
								>
							</button>
							<div class="w-px bg-zinc-800"></div>
							{@render deleteButton(message)}
						</div>
					{:else if (hoveredMessageId === message.id || reactingMessageId === message.id) && !isPending && !ephemeral && $currentUser && message.author_id !== $currentUser.id && editingMessageId !== message.id}
						<div
							class="absolute -top-3 right-2 z-10 flex overflow-hidden rounded border border-zinc-800 bg-zinc-700 shadow-sm"
						>
							<Popover.Root
								bind:open={() => reactingMessageId === message.id, (v) => (reactingMessageId = v ? message.id : null)}
							>
								<Popover.Trigger
									class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
									title="Add reaction"
									aria-label="Add reaction"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line
											x1="9"
											x2="9.01"
											y1="9"
											y2="9"
										/><line x1="15" x2="15.01" y1="9" y2="9" /></svg
									>
								</Popover.Trigger>
								<!-- Mounted only while open: bits-ui's Portal mounts what it holds as it's created, open or not (#319). -->
								{#if reactingMessageId === message.id}
									<Popover.Portal>
										<Popover.Content side="top" align="end" sideOffset={8} class="z-100">
											<EmojiPicker onSelect={(emoji) => handleReactionPick(message.id, emoji)} {customEmojis} />
										</Popover.Content>
									</Popover.Portal>
								{/if}
							</Popover.Root>
							{@render reactionsButton(message)}
							<div class="w-px bg-zinc-800"></div>
							<button
								class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
								onclick={() => onReply?.(message)}
								title="Reply"
								aria-label="Reply"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg
								>
							</button>
							<div class="w-px bg-zinc-800"></div>
							<button
								class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
								onclick={() => {
									navigator.clipboard
										.writeText(
											`${isConversation ? `${DUVET_DOMAIN}/conversations/${channelId}/${message.id}` : `${DUVET_DOMAIN}/channels/${spaceId}/${channelId}/${message.id}`}`,
										)
										.catch(console.error);
								}}
								title="Copy message link"
								aria-label="Copy message link"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path
										d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
									/></svg
								>
							</button>
							<div class="w-px bg-zinc-800"></div>
							<button
								class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
								onclick={() => openThreadModal(message)}
								title="View thread"
								aria-label="View thread"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg
								>
							</button>
							{#if canPin}
								<div class="w-px bg-zinc-800"></div>
								<button
									class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
									onclick={() => togglePin(message)}
									disabled={pinningMessageId === message.id}
									title={message.pinned_at ? "Unpin message" : "Pin message"}
									aria-label={message.pinned_at ? "Unpin message" : "Pin message"}
								>
									{#if message.pinned_at}
										<PinOffIcon class="size-4" />
									{:else}
										<PinIcon class="size-4" />
									{/if}
								</button>
							{/if}
							{#if currentUserCan(Permission.ManageMessages)}
								<div class="w-px bg-zinc-800"></div>
								{@render deleteButton(message)}
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if isDifferentDay}
				<div class="my-3 flex items-center gap-3 px-2 select-none">
					<div class="h-px flex-1 bg-zinc-700"></div>
					<span class="text-xs font-medium whitespace-nowrap text-zinc-500">
						{formatDateSeparator(message.created_at)}
					</span>
					<div class="h-px flex-1 bg-zinc-700"></div>
				</div>
			{/if}

			{#if unreadDividerIdx !== null && unreadCount > 0 && i === unreadDividerIdx - 1}
				<div data-unread-divider class="my-2 flex items-center gap-3 px-2 select-none">
					<div class="h-px flex-1 bg-red-500/50"></div>
					<span class="shrink-0 text-xs font-semibold whitespace-nowrap text-red-400">
						{unreadCount === 1 ? "1 new message" : `${unreadCount} new messages`}
					</span>
					<div class="h-px flex-1 bg-red-500/50"></div>
				</div>
			{/if}
		{/each}

		{#if hasMoreMessages}
			<div data-sentinel-top use:topObserverAction class="flex w-full justify-center py-4">
				{#if isLoadingMore}
					<svg
						class="h-5 w-5 animate-spin text-zinc-400"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
				{/if}
			</div>
		{:else if intro}
			{@render intro()}
		{/if}
	{/if}
</div>

<Dialog.Root bind:open={threadModalOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-51 flex items-center justify-center p-4">
			<div
				class="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
			>
				<div class="flex shrink-0 items-center justify-between border-b border-zinc-700 px-5 py-4">
					<div>
						<h2 class="text-base font-semibold text-white">Message thread</h2>
						{#if threadRootMessage}
							<p class="text-xs text-zinc-400">From {threadRootMessage.author_name}</p>
						{/if}
					</div>
					<button
						class="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
						onclick={() => (threadModalOpen = false)}
						aria-label="Close"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
						>
					</button>
				</div>
				<div bind:this={threadScrollEl} class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{#if threadLoading}
						<div class="flex items-center justify-center py-8">
							<div class="h-6 w-6 animate-spin rounded-full border-2 border-stone-400 border-t-transparent"></div>
						</div>
					{:else if threadError}
						<p class="text-sm text-red-400">{threadError}</p>
					{:else if threadShown.length === 0}
						<p class="text-sm text-zinc-400">No thread messages found.</p>
					{:else}
						{@const threadMsgMap = new Map(threadShown.map((m) => [m.id, m]))}
						<div class="flex flex-col gap-2" onclickcapture={openMention}>
							{#each threadShown as threadMsg (threadMsg.id)}
								{@const parentMsg = threadMsg.ref_message_id ? threadMsgMap.get(threadMsg.ref_message_id) : null}
								{@const parentCall = parentMsg ? callNoticeLine(parentMsg, $currentUser?.id, joined) : null}
								{@const root = threadRootMessage}
								<div class="group relative rounded-md border border-zinc-800 bg-zinc-800/30 px-3 py-2">
									<!-- As the pins and the search show a message, a reply's quote above it: its quote of a call notice
									     says what the call's row does -->
									<MessagePreview
										message={threadMsg}
										{spaceId}
										{channelId}
										{members}
										{mentionMap}
										{customEmojiMap}
										quotedCall={parentCall}
										onPreview={previewFromThread}
									/>
									<!-- A message of the thread is replied to from here, as from the chat; not a notice, an ephemeral
									     message, nor one still being sent (its ID is its nonce) -->
									{#if onThreadReply && root && !isNotice(threadMsg) && !isEphemeral(threadMsg) && threadMsg.id !== threadMsg.nonce}
										<button
											type="button"
											class="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded text-zinc-400 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-100 focus-visible:opacity-100"
											title="Reply"
											aria-label="Reply to {threadMsg.author_name}"
											onclick={() => onThreadReply(threadMsg, root)}
										>
											<ReplyIcon class="size-3.5" />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<!-- The thread's own message box, which replies in it -->
				{#if threadComposer && threadRootMessage && !threadLoading && !threadError}
					{@render threadComposer(threadRootMessage)}
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<!-- Who reacted, in the menu of a message that has reactions -->
{#snippet reactionsButton(message: Message)}
	{#if message.reactions?.length}
		<div class="w-px bg-zinc-800"></div>
		<button
			class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-zinc-200"
			onclick={() => showReactors(message)}
			title="Reactions"
			aria-label="Reactions"
		>
			<UsersIcon class="size-4" />
		</button>
	{/if}
{/snippet}

{#snippet deleteButton(message: Message)}
	<button
		class="p-1.5 text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
		onclick={() => handleDelete(message.id)}
		disabled={deletingMessageId === message.id}
		title="Delete message"
		aria-label="Delete message"
	>
		{#if deletingMessageId === message.id}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg
			>
		{:else}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path
					d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
				/><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg
			>
		{/if}
	</button>
{/snippet}

<ImagePreview src={previewSrc} alt={previewAlt} bind:open={previewOpen} />

<MentionProfile bind:this={mentionProfile} {members} {space} />

<!-- User context menu (right-click avatar) -->
<svelte:window
	onkeydown={(e) => {
		if (userMenuPos && e.key === "Escape") closeUserMenu();
	}}
/>
{#if userMenuPos && userMenuTargetId}
	<!-- Escape closes it too (svelte:window above), so the backdrop's click is mouse-only on purpose. -->
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-200"
		onclick={closeUserMenu}
		oncontextmenu={(e) => {
			e.preventDefault();
			closeUserMenu();
		}}
	></div>
	{@const isSelf = userMenuTargetId === $currentUser?.id}
	{@const alreadyFriend = !isSelf && isFriend(userMenuTargetId)}
	{@const pending = !isSelf && !alreadyFriend && hasPendingRequest(userMenuTargetId)}
	{@const canSendRequest = !isSelf && !alreadyFriend && !pending}
	<!-- Kick and Ban, for a member of the room's space whom the API would let the user act on. -->
	{@const moderation = moderationOf(
		space,
		members.find((m) => m.id === userMenuTargetId),
	)}
	<div
		class="fixed z-201 min-w-44 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl"
		style="left: {userMenuPos.x}px; top: {userMenuPos.y}px;"
	>
		{#if !isSelf}
			<button
				class="w-full px-3 py-2 text-left text-sm transition-colors {canSendRequest
					? 'text-zinc-100 hover:bg-zinc-700'
					: 'cursor-not-allowed text-zinc-500'}"
				disabled={!canSendRequest}
				onclick={() => handleSendFriendRequest(userMenuTargetId!)}
			>
				{alreadyFriend ? "Already Friends" : pending ? "Request Pending" : "Send Friend Request"}
			</button>
		{/if}
		<button
			class="w-full px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
			onclick={() => {
				navigator.clipboard.writeText(userMenuTargetId!);
				closeUserMenu();
			}}
		>
			Copy User ID
		</button>
		{#if moderation}
			<div class="my-1 border-t border-zinc-700"></div>
			{#if moderation.kick}
				<button
					class="w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-zinc-700"
					onclick={() => {
						const { target } = moderation;
						closeUserMenu();
						void kickFromSpace(target);
					}}
				>
					Kick {moderation.target.name}
				</button>
			{/if}
			{#if moderation.ban}
				<button
					class="w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-zinc-700"
					onclick={() => {
						banRequest.set(moderation.target);
						closeUserMenu();
					}}
				>
					Ban {moderation.target.name}
				</button>
			{/if}
		{/if}
		{#if isStaff}
			<div class="my-1 border-t border-zinc-700"></div>
			<button
				class="w-full px-3 py-2 text-left text-sm text-amber-400 transition-colors hover:bg-zinc-700"
				onclick={() => openFlagsBadgesEditor(userMenuTargetId!)}
			>
				Edit Flags & Badges
			</button>
		{/if}
	</div>
{/if}

<!-- Staff: Flags & Badges Editor -->
{#if flagsBadgesTarget}
	<Dialog.Root bind:open={flagsBadgesOpen}>
		<Dialog.Portal>
			<Dialog.Overlay class="fixed inset-0 z-500 bg-black/70 backdrop-blur-sm" />
			<Dialog.Content class="fixed inset-0 z-501 flex items-center justify-center p-4">
				<div class="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl">
					<h2 class="mb-4 text-lg font-semibold">Edit Flags & Badges</h2>
					<p class="mb-4 text-xs text-zinc-400">User: {flagsBadgesTarget.id}</p>

					<div class="mb-4 space-y-2">
						<h3 class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Flags</h3>
						{#each FLAGS as f}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={!!(editFlags & f.flag)}
									onchange={() => toggleFlag(f.flag)}
									class="accent-amber-500"
								/>
								{f.name}
							</label>
						{/each}
					</div>

					<div class="mb-6 space-y-2">
						<h3 class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Badges</h3>
						{#each BADGES as b}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={!!(editBadges & b.flag)}
									onchange={() => toggleBadge(b.flag)}
									class="accent-amber-500"
								/>
								{b.name}
							</label>
						{/each}
					</div>

					<div class="flex gap-3">
						<button
							class="text-fixed-white rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-amber-500 disabled:opacity-50"
							disabled={flagsBadgesSaving}
							onclick={saveFlagsBadges}
						>
							{flagsBadgesSaving ? "Saving…" : "Save"}
						</button>
						<button
							class="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600"
							onclick={() => (flagsBadgesOpen = false)}
						>
							Cancel
						</button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{/if}
