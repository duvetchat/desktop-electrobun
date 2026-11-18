<script lang="ts">
	import { hasPermission, Permission } from "$lib/permissions";
	import { onDestroy, onMount, tick, type Snippet } from "svelte";
	import {
		ArrowDown as ArrowDownIcon,
		BadgeCheck as BadgeCheckIcon,
		Ban as BanIcon,
		Copy as CopyIcon,
		Ellipsis as EllipsisIcon,
		Eye as EyeIcon,
		Link as LinkIcon,
		LoaderCircle as SpinnerIcon,
		MessagesSquare as ThreadIcon,
		Pencil as PencilIcon,
		Phone as PhoneIcon,
		PhoneMissed as PhoneMissedIcon,
		Pin as PinIcon,
		PinOff as PinOffIcon,
		Reply as ReplyIcon,
		Trash2 as TrashIcon,
		User as UserIcon,
		UserMinus as KickIcon,
		UserPlus as UserPlusIcon,
		Users as UsersIcon,
	} from "@lucide/svelte";
	import SmilePlusIcon from "$lib/components/ui/icons/SmilePlus.svelte";
	import { deleteMessage, getMessageThread, pinRoomMessage, unpinRoomMessage } from "$lib/api/messages";
	import { sendComponentInteraction, type ComponentUse } from "$lib/api/interactions";
	import {
		getConversationMessageThread,
		pinConversationMessage,
		unpinConversationMessage,
	} from "$lib/api/conversations";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { keyboard } from "$lib/keyboard.svelte";
	import { rowKey, rowToward, staysWithRow, tabStop } from "$lib/message-focus";
	import { DropdownMenu, Popover } from "bits-ui";
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
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
	import { largeEmojis, renderEmoji } from "$lib/emoji";
	import { customEmojiMapOf, mentionMapOf, sameNames } from "$lib/markdown";
	import { nameColors } from "$lib/name-colors";
	import { clockTime, dayLabel, groupShapes, headTime, shortClockTime } from "$lib/message-groups";
	import { messageLayout } from "$lib/stores/message-layout.svelte";
	import { PRISM_BUBBLE, PRISM_LIGHT, PRISM_RIM, PRISM_WASH, placePrism, slidePrism } from "$lib/prism";

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
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";
	import MenuSub from "$lib/components/ui/MenuSub.svelte";
	import { buttonClass, GLASS, MENU_PANEL } from "$lib/components/ui/recipes";
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
		onDeleteMsg?: (messageId: string) => Promise<void> | void;
		failedNonces?: Set<string>;
		/** The message being edited, which the chat's message box holds (Chat.svelte): its bubble is ringed, and it has no
		 * hover bar. An edit starts here (the hover bar, the menu, three clicks on one's own text) by setting both. */
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
	// The profile a click on an author's name or avatar opens, beside what was clicked: one popover for the list. A second
	// click on the same one closes it, whichever comes first: the click, with the profile still open, or the popover's own
	// closing on that press outside it (profileClosed), after which the click doesn't open it again.
	let profileFor = $state.raw<{ member: MemberOnSidebar; anchor: HTMLElement } | null>(null);
	let profileClosed: { anchor: HTMLElement; at: number } | null = null;
	function openProfile(member: MemberOnSidebar | undefined, anchor: HTMLElement) {
		if (!member) return;
		if (profileFor?.anchor === anchor) {
			profileFor = null;
			profileClosed = null;
			return;
		}
		const justClosed = profileClosed?.anchor === anchor && performance.now() - profileClosed.at < 500;
		profileClosed = null;
		if (!justClosed) profileFor = { member, anchor };
	}
	function closeProfile() {
		if (profileFor) profileClosed = { anchor: profileFor.anchor, at: performance.now() };
		profileFor = null;
	}
	let mentionProfile: MentionProfile;
	const openMention = (e: MouseEvent) => mentionProfile.open(e);

	// The menu a right-click opens, one for the whole list: a message's, or its author's from their avatar. A message's
	// More button opens the same items from the hover bar (moreMenuFor: its bar stays while its menu is open).
	type MenuTarget = { kind: "message"; id: string } | { kind: "author"; userId: string };
	let menuTarget = $state<MenuTarget | null>(null);
	let menuOpen = $state(false);
	let moreMenuFor = $state<string | null>(null);
	// The More menu's layer, claimed as it opens as ui/Menu.svelte's is: its author submenu, which claims the next,
	// is then in front of it wherever it lands (lib/overlay-layers.ts).
	const moreMenuLayer = $derived(moreMenuFor ? claimLayer() : 0);
	$effect(() => {
		const mine = moreMenuLayer;
		if (mine) return () => releaseLayer(mine);
	});
	const menuMessage = $derived.by(() => {
		const target = menuTarget;
		return target?.kind === "message" ? messages.find((m) => m.id === target.id) : undefined;
	});

	// What a right-click is on, and whether the list's menu is for it. A link, a picture, a video and selected text
	// keep the system's own menu (open the link, save the picture, copy the selection); a message being sent and a bot's
	// ephemeral one have no menu, and a notice only for those who can delete it. A webhook's avatar has none.
	function pickMenu(e: MouseEvent): boolean {
		const el = e.target instanceof Element ? e.target : null;
		if (!el) return false;
		const author = el.closest<HTMLElement>("[data-author-menu]")?.dataset.authorMenu;
		if (author !== undefined) {
			if (author === "") return false;
			menuTarget = { kind: "author", userId: author };
			return true;
		}
		if (el.closest("a[href], img:not(.emoji-img), video, audio, input, textarea")) return false;
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed && selection.anchorNode && scrollEl.contains(selection.anchorNode))
			return false;
		const id = el.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
		const message = id ? messages.find((m) => m.id === id) : undefined;
		if (!message || message.id === message.nonce || isEphemeral(message)) return false;
		if (isNotice(message) && !canDeleteNotices) return false;
		menuTarget = { kind: "message", id: message.id };
		return true;
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
		// The jump button shows from 320 px above the bottom; told only when it changes, not with every scroll event.
		const far = scrollEl.scrollTop < -JUMP_BUTTON_FROM;
		if (far !== farFromBottom) farFromBottom = far;
		if (prisms.size > 0) slidePrisms();

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
		if (prismFrame) cancelAnimationFrame(prismFrame);
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
	// The colour of each member's name where a message mentions them: their role's, as above their own messages. Kept
	// while every style stays, as the names are (#324).
	let mentionColours: Record<string, string> = {};
	const mentionStyles = $derived.by(() => {
		const next = Object.fromEntries(Object.entries(authorColors).filter(([, style]) => style !== ""));
		if (!sameNames(next, mentionColours)) mentionColours = next;
		return mentionColours;
	});

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

	// The keyboard's way to the same bar (lib/message-focus.ts): one message of the list is a tab stop, the arrows move
	// the focus between messages, and the one the keyboard put the focus in mounts its bar, which Tab then enters.
	// Enter, the menu key or Shift+F10 opens its menu. A click's focus mounts nothing: the pointer has its own way.
	let focusedMessageId = $state<string | null>(null);
	let lastFocusedId = $state<string | null>(null);
	const rowIds = $derived(sortedMessages.map((m) => m.id));
	const tabStopId = $derived(tabStop(rowIds, lastFocusedId));
	const rowOf = (target: EventTarget | null) =>
		target instanceof Element ? target.closest<HTMLElement>("[data-message-id]") : null;
	function focusRow(e: FocusEvent) {
		const id = rowOf(e.target)?.dataset.messageId ?? null;
		if (id) lastFocusedId = id;
		focusedMessageId = id && e.target instanceof Element && e.target.matches(":focus-visible") ? id : null;
	}
	function blurRow(e: FocusEvent) {
		const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
		const inList = !!to && scrollEl.contains(to);
		// Within the same message (its text, its bar), the next focusin says so.
		if (inList && rowOf(to)?.dataset.messageId === focusedMessageId) return;
		const layerOpen = moreMenuFor === focusedMessageId || reactingMessageId === focusedMessageId;
		if (!staysWithRow(to, inList, layerOpen)) focusedMessageId = null;
	}
	function rowKeys(e: KeyboardEvent) {
		// A key in a message's text, a link or a button of its bar is that element's.
		const row = e.target instanceof HTMLElement && e.target.matches("[data-message-id]") ? e.target : null;
		const id = row?.dataset.messageId;
		const key = id && !e.defaultPrevented ? rowKey(e) : null;
		if (!id || !key) return;
		if (key === "menu") {
			const message = messages.find((m) => m.id === id);
			// What has no bar has no menu to open: a notice, a message still sending, one only the user sees.
			if (!message || isNotice(message) || message.id === message.nonce || isEphemeral(message) || !$currentUser)
				return;
			e.preventDefault();
			focusedMessageId = id;
			moreMenuFor = id;
			return;
		}
		e.preventDefault();
		const to = rowToward(rowIds, id, key);
		if (to) scrollEl.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(to)}"]`)?.focus();
	}

	const isConversation = $derived(!spaceId);

	// ── Layout ─────────────────────────────────────────────────────────────────
	// Bubbles, or flat rows (the user's choice, lib/message-layout.ts). In bubbles, a direct conversation shows no
	// names and no avatars: the two sides say who wrote what. A group, a room and every flat row show both.
	const flat = $derived(messageLayout.value === "flat");
	const isDirect = $derived.by(() => {
		if (!isConversation) return false;
		const conversation = $conversations.find((c) => c.id === channelId);
		return !!conversation && conversation.type !== 2;
	});
	const showAuthors = $derived(flat || !isDirect);

	// What the hover bar and the menu's first row react with at one click.
	const QUICK_REACTIONS = ["😂", "❤️", "👍"];
	const MENU_REACTIONS = ["😀", "🙂", "🤭", "👍", "❤️"];

	function copyLink(message: Message) {
		const link = isConversation
			? `${DUVET_DOMAIN}/conversations/${channelId}/${message.id}`
			: `${DUVET_DOMAIN}/channels/${spaceId}/${channelId}/${message.id}`;
		navigator.clipboard.writeText(link).catch(console.error);
	}

	// A hover bar sits beside its bubble; where there's no room for it there (a wide bubble in a narrow pane), it sits
	// along the bubble's top edge instead, as on a flat row. Measured once, as the bar mounts.
	function fitBar(node: HTMLElement) {
		if (!scrollEl || flat) return;
		const bar = node.getBoundingClientRect();
		const view = scrollEl.getBoundingClientRect();
		if (bar.left < view.left + 4 || bar.right > view.right - 4) node.dataset.above = "";
	}

	// ── Jump to the newest ─────────────────────────────────────────────────────
	const JUMP_BUTTON_FROM = 320;
	let farFromBottom = $state(false);

	// Down to the newest message: from a jump's pages, the list goes to the present first. A short way is scrolled
	// smoothly; a long one, or with reduced motion, at once.
	async function jumpToNewest() {
		const chId = channelId;
		if (hasMoreMessagesBelow && onJumpToPresent) {
			await onJumpToPresent().catch(() => false);
			await tick();
		}
		if (gone || channelId !== chId || !scrollEl) return;
		const near = -scrollEl.scrollTop < scrollEl.clientHeight * 3;
		const smooth = near && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		scrollEl.scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" });
	}

	// ── Prism ──────────────────────────────────────────────────────────────────
	// The bubbles that mention the user (lib/prism.ts), each placed as it mounts and when its size changes; their side
	// lights follow the scroll, once a frame.
	const prisms = new Set<HTMLElement>();
	let prismFrame = 0;
	function slidePrisms() {
		if (prismFrame) return;
		prismFrame = requestAnimationFrame(() => {
			prismFrame = 0;
			if (gone || !scrollEl) return;
			for (const bubble of prisms) slidePrism(bubble, scrollEl);
		});
	}
	// On a message's text; userId is the user's while the text is a bubble that mentions them, else null.
	function prism(node: HTMLElement, userId: string | null) {
		let observer: ResizeObserver | null = null;
		function light(id: string | null) {
			observer?.disconnect();
			observer = null;
			prisms.delete(node);
			if (!id || typeof ResizeObserver === "undefined") return;
			prisms.add(node);
			// Its first call comes as it starts to observe: the bubble is laid out by then.
			observer = new ResizeObserver(() => {
				if (scrollEl) placePrism(node, scrollEl, id);
			});
			observer.observe(node);
		}
		light(userId);
		return { update: light, destroy: () => light(null) };
	}

	// Whether a message's text shows in a bubble: it has text, which isn't only emoji (those show large, with no bubble),
	// nor a lone link whose preview takes its place. A voice note, a sticker, a bot's pending answer and a message made of
	// components have no text of their own.
	function bubbled(message: Message): boolean {
		if (message.type === MessageType.Voice || message.sticker_attachment_id) return false;
		if (isLoading(message) || isComponentsV2(message) || previewReplacesText(message)) return false;
		const text = message.content ?? "";
		return text !== "" && !largeEmojis(text);
	}
	const LONE = { first: true, last: true, newDay: false };

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
			if (sortedMessages[i]!.id <= unreadAfterMessageId) {
				return i;
			}
		}
		return sortedMessages.length; // all loaded messages are unread
	});
	const unreadCount = $derived(unreadDividerIdx ?? 0);
	// Each message's place in its group and its day (lib/message-groups.ts), in the list's order.
	const shapes = $derived(groupShapes(sortedMessages, unreadDividerIdx));

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
		farFromBottom = false;
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
	// The chat's message box takes the edit (Chat.svelte): it saves, or cancels, and clears both.
	function startEdit(message: Message) {
		editingMessageId = message.id;
		editContent = message.content ?? "";
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

<!-- The list runs bottom to top (flex-col-reverse): it keeps to its bottom while pictures, fonts and the message box
     settle, and its newest message clears the glass message box over its foot by the box's height (--composer-h, which
     Chat sets), plus the 24 px where who's typing shows. A pane's header that floats over the list says how tall it is
     (--pane-header-h). The space under the newest message is the list's padding, not that message's margin: a margin
     that changes when another message comes below it stops the browser from keeping the reader's place (scroll
     anchoring). -->
<!-- Its mouse handlers only follow the pointer's row, for that row's hover bar (hoverRow), as :hover did, and its
     focus and key handlers the keyboard's (focusRow, rowKeys); its
     right-click opens the one menu of the list, for the message or the avatar under the pointer (pickMenu). -->
<ContextMenu bind:open={menuOpen} label={menuTarget?.kind === "author" ? "Member" : "Message"}>
	{#snippet target(props)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_mouse_events_have_key_events -->
		<div
			{...props}
			bind:this={scrollEl}
			class="@container flex flex-1 flex-col-reverse overflow-x-clip overflow-y-auto overscroll-contain pt-[calc(var(--pane-header-h,0px)+16px)] pb-[calc(var(--composer-h,64px)+24px)] {flat
				? 'px-[calc(var(--duvet-pad-x)-8px)]'
				: 'px-(--duvet-pad-x)'}"
			onscroll={handleScroll}
			oncopy={handleCopy}
			onmouseover={hoverRow}
			onmouseleave={() => (hoveredMessageId = null)}
			onfocusin={focusRow}
			onfocusout={blurRow}
			onkeydown={rowKeys}
			oncontextmenu={(e) => {
				// Shift+F10 opened the message's own menu already (rowKeys); where the system sends its menu event too,
				// that one isn't a second menu.
				if (moreMenuFor) {
					e.preventDefault();
					return;
				}
				if (pickMenu(e)) (props.oncontextmenu as ((e: MouseEvent) => void) | undefined)?.(e);
			}}
		>
			{#if isInitialLoading}
				<div class="flex flex-col-reverse gap-3 pb-2">
					{#each { length: 6 } as _, i}
						{@const wide = i % 3 === 0}
						{@const right = !flat && i % 4 === 1}
						<div class="flex items-end gap-2 {right ? 'flex-row-reverse' : ''}">
							{#if flat}
								<div class="bg-duvet-secondary-fill size-9 shrink-0 animate-pulse rounded-full"></div>
							{/if}
							<div class="flex flex-1 flex-col gap-1.5 {right ? 'items-end' : 'items-start'}">
								<div class="bg-duvet-secondary-fill h-9 animate-pulse rounded-2xl {wide ? 'w-3/5' : 'w-2/5'}"></div>
								{#if wide}
									<div class="bg-duvet-secondary-fill h-9 w-1/4 animate-pulse rounded-2xl"></div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else if messages.length === 0}
				{#if retryFirstPage}
					<div class="my-auto flex flex-col items-center px-6 py-16 text-center" role="status">
						<MascotPeek class="w-24" mood="shy" />
						<p class="text-duvet-ink mt-4 font-serif text-[22px] leading-tight">Couldn't load messages</p>
						<button type="button" class="{buttonClass('secondary')} mt-5" onclick={() => retryFirstPage?.()}>
							Try again
						</button>
					</div>
				{:else if intro}
					{@render intro()}
				{:else}
					<div class="text-duvet-ink2 mb-5 py-4 text-center text-[12.5px]">
						No messages yet. Send the first message.
					</div>
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
							<SpinnerIcon class="text-duvet-ink2 size-5 animate-spin" />
						{:else}
							<span class="text-duvet-ink2 text-xs">Newer messages below</span>
						{/if}
					</div>
				{/if}

				{#each sortedMessages as message, i (message.id)}
					{@const shape = shapes[i] ?? LONE}
					{@const isPending = message.id === message.nonce}
					{@const isFailed = isPending && failedNonces.has(message.nonce ?? "")}
					{@const ephemeral = isEphemeral(message)}
					{@const isHighlighted = highlightedMessageId === message.id}
					{@const mine = !!$currentUser && message.author_id === $currentUser.id}
					{@const isMention =
						!!$currentUser &&
						!mine &&
						(messageText(message).includes(`<@${$currentUser.id}>`) || mentionsByReply(message, $currentUser.id))}
					{@const callLine = callNoticeLines.get(message.id)}
					{@const barShown =
						(hoveredMessageId === message.id ||
							focusedMessageId === message.id ||
							reactingMessageId === message.id ||
							moreMenuFor === message.id) &&
						!isPending &&
						!ephemeral &&
						!!$currentUser &&
						editingMessageId !== message.id}
					{@const cursorOn = keyboard.cursor === message.id}
					{#if message.type === MessageType.PinNotice || callLine}
						<!-- A notice: who pinned which message, or a call of the conversation that ended -->
						<!-- The list's tab stop, or reached from it by the arrows (lib/message-focus.ts). -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							data-message-id={message.id}
							tabindex={tabStopId === message.id ? 0 : -1}
							class="group/row text-duvet-ink2 relative my-3 flex flex-wrap items-center justify-center gap-1.5 rounded-xl px-10 py-1 text-[12.5px] leading-[1.3] {isHighlighted
								? 'bg-duvet-accent-tint'
								: ''} {cursorOn ? 'outline-duvet-accent outline-2 -outline-offset-2' : ''}"
						>
							{#if callLine?.missed}
								<!-- Red for a call the user missed -->
								<PhoneMissedIcon class="text-duvet-danger size-3.5 shrink-0" />
							{:else if callLine}
								<PhoneIcon class="text-duvet-ink2 size-3.5 shrink-0" />
							{:else}
								<PinIcon class="text-duvet-ink2 size-3.5 shrink-0" />
							{/if}
							<p class="min-w-0 text-center">
								{#if callLine}
									{callLine.before}<span class="text-duvet-ink font-medium">{callLine.name}</span>{callLine.after}
								{:else}
									<span class="text-duvet-ink font-medium">{message.author_name}</span>
									pinned
									<button
										type="button"
										class="text-duvet-ink font-medium hover:underline"
										onclick={() => jumpToPinned(message)}>a message</button
									>
									to this {isConversation ? "chat" : "room"}. See all
									<button
										type="button"
										class="text-duvet-accent-text font-medium hover:underline"
										onclick={() => pinsPanelRequest.set({ id: crypto.randomUUID(), channelId })}>pinned messages</button
									>.
								{/if}
								<span class="ml-1 text-[11px] tabular-nums opacity-75">{clockTime(message.created_at, locale)}</span>
							</p>
							{#if canDeleteNotices && (hoveredMessageId === message.id || focusedMessageId === message.id)}
								<div class="{GLASS} absolute top-1/2 right-1 z-10 flex -translate-y-1/2 rounded-xl p-[3px]">
									{@render deleteButton(message)}
								</div>
							{/if}
						</div>
					{:else if flat}
						<!-- A flat row: the avatar's gutter, then the author's line on a group's first row, and the message -->
						<!-- The list's tab stop, or reached from it by the arrows (lib/message-focus.ts). -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							data-message-id={message.id}
							tabindex={tabStopId === message.id ? 0 : -1}
							class="group/row relative grid grid-cols-[52px_minmax(0,1fr)] rounded-xl px-2 py-[3px] {shape.first
								? 'mt-3 pt-1.5'
								: ''} {isFailed
								? 'bg-duvet-danger/10'
								: isHighlighted
									? 'bg-duvet-accent-tint'
									: isMention
										? PRISM_WASH
										: 'hover:bg-duvet-hover-soft'} {isPending && !isFailed
								? 'pointer-events-none opacity-50'
								: ''} {cursorOn ? 'outline-duvet-accent outline-2 -outline-offset-2' : ''}"
						>
							{@render cursorHint(message, mine, isPending || ephemeral)}
							<div class="min-w-0">
								{#if shape.first}
									{@render avatar(message, 36)}
								{:else}
									<span
										class="text-duvet-ink2 block pt-[5px] text-[10.5px] leading-none tabular-nums opacity-0 select-none group-hover/row:opacity-100"
									>
										{shortClockTime(message.created_at, locale)}
									</span>
								{/if}
							</div>
							<div class="flex min-w-0 flex-col items-start gap-1">
								<MessageReference
									{message}
									quotedCall={callNoticeLines.get(message.referenced_message?.message_id ?? "")}
									{mentionMap}
									{customEmojiMap}
									{spaceId}
									{channelId}
								/>
								{#if shape.first}
									<div class="flex max-w-full items-baseline gap-2 text-sm leading-[1.2] font-semibold">
										{@render authorName(message, "var(--duvet-ink)")}
										<AuthorTag {message} class="self-center" />
										<span class="text-duvet-ink2 shrink-0 text-[11.5px] font-normal tabular-nums"
											>{headTime(message.created_at, now, locale)}</span
										>
									</div>
								{/if}
								{@render content(message, mine, isFailed, isMention, isHighlighted)}
								<MessageReactions
									reactions={message.reactions ?? []}
									{customEmojiMap}
									onToggle={(r) => handleReactionToggle(message, r.emoji_name, r.emoji_id)}
									onShowReactors={(r) => showReactors(message, r.emoji_name)}
									onAdd={ephemeral || isPending ? undefined : () => (reactingMessageId = message.id)}
								/>
								{#if ephemeral}
									{@render ephemeralNote(message)}
								{/if}
							</div>
							{#if isFailed}
								{@render failedBar(message, mine)}
							{:else if barShown}
								{@render hoverBar(message, mine, null)}
							{/if}
						</div>
					{:else}
						<!-- A bubble's row: yours to the right. In a group or a room, the others' avatar sits beside their
						     group's last bubble and their name over its first; the time is under the last. -->
						<!-- The list's tab stop, or reached from it by the arrows (lib/message-focus.ts). -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							data-message-id={message.id}
							tabindex={tabStopId === message.id ? 0 : -1}
							class="group/row relative flex flex-col rounded-2xl py-px {mine
								? 'items-end'
								: 'items-start'} {shape.first ? 'mt-2.5' : ''} {isPending && !isFailed
								? 'pointer-events-none opacity-50'
								: ''} {cursorOn ? 'outline-duvet-accent outline-2 outline-offset-2' : ''}"
						>
							{@render cursorHint(message, mine, isPending || ephemeral)}
							<div class="flex w-full items-end gap-2 {mine ? 'flex-row-reverse' : ''}">
								{#if showAuthors && !mine}
									<div class="w-7 shrink-0">
										{#if shape.last}{@render avatar(message, 28)}{/if}
									</div>
								{/if}
								<div
									class="relative flex max-w-[65%] min-w-0 flex-col gap-1 @max-xl:max-w-[86%] {mine
										? 'items-end'
										: 'items-start'} {isHighlighted && !bubbled(message)
										? 'outline-duvet-accent rounded-2xl outline-[3px] outline-offset-2'
										: ''}"
								>
									{#if showAuthors && !mine && shape.first}
										<div class="flex max-w-full items-center gap-1.5 px-1 text-[12.5px] leading-[1.2] font-semibold">
											{@render authorName(message, "var(--duvet-ink2)")}
											<AuthorTag {message} />
										</div>
									{/if}
									<MessageReference
										{message}
										quotedCall={callNoticeLines.get(message.referenced_message?.message_id ?? "")}
										{mentionMap}
										{customEmojiMap}
										{spaceId}
										{channelId}
									/>
									{@render content(message, mine, isFailed, isMention, isHighlighted)}
									{#if isFailed}
										{@render failedBar(message, mine)}
									{:else if barShown}
										{@render hoverBar(message, mine, shape.last ? null : clockTime(message.created_at, locale))}
									{/if}
								</div>
							</div>
							{#if shape.last || ephemeral || message.reactions?.length}
								<div
									class="mt-1 flex max-w-[65%] flex-col gap-1 @max-xl:max-w-[86%] {mine
										? 'items-end'
										: 'items-start'} {showAuthors && !mine ? 'ml-9' : ''}"
								>
									<MessageReactions
										reactions={message.reactions ?? []}
										{customEmojiMap}
										end={mine}
										onToggle={(r) => handleReactionToggle(message, r.emoji_name, r.emoji_id)}
										onShowReactors={(r) => showReactors(message, r.emoji_name)}
										onAdd={ephemeral || isPending ? undefined : () => (reactingMessageId = message.id)}
									/>
									{#if ephemeral}
										{@render ephemeralNote(message)}
									{/if}
									{#if shape.last}
										<span class="text-duvet-ink2 px-1 text-[11px] leading-[1.3] tabular-nums select-none"
											>{clockTime(message.created_at, locale)}</span
										>
									{/if}
								</div>
							{/if}
						</div>
					{/if}

					{#if shape.newDay}
						<!-- In its place in the list: it doesn't stick to the top -->
						<div
							class="text-duvet-ink2 pointer-events-none mt-[18px] mb-2 flex justify-center text-[11.5px] leading-none font-semibold tracking-[0.01em] select-none"
						>
							{dayLabel(message.created_at, now)}
						</div>
					{/if}

					{#if unreadDividerIdx !== null && unreadCount > 0 && i === unreadDividerIdx - 1}
						<div
							data-unread-divider
							class="text-duvet-ink mt-4 mb-2 flex items-center gap-3 text-[11.5px] leading-none font-medium select-none"
						>
							<div class="bg-duvet-line h-px flex-1"></div>
							<span class="shrink-0 whitespace-nowrap">
								{unreadCount === 1 ? "1 new message" : `${unreadCount} new messages`}
							</span>
							<div class="bg-duvet-line h-px flex-1"></div>
						</div>
					{/if}
				{/each}

				{#if hasMoreMessages}
					<div data-sentinel-top use:topObserverAction class="flex w-full justify-center py-4">
						{#if isLoadingMore}
							<SpinnerIcon class="text-duvet-ink2 size-5 animate-spin" />
						{/if}
					</div>
				{:else if intro}
					{@render intro()}
				{/if}
			{/if}
		</div>
	{/snippet}
	{#if menuTarget?.kind === "author"}
		{@render authorItems(menuTarget.userId)}
	{:else if menuMessage}
		{@render messageItems(menuMessage)}
	{/if}
</ContextMenu>

<!-- Down to the newest message, once the list is well above its bottom or on a jump's pages, with how many are new -->
{#if (farFromBottom || hasMoreMessagesBelow) && messages.length > 0 && !isInitialLoading}
	<button
		type="button"
		class="{GLASS} animate-pop text-duvet-ink absolute right-[calc(var(--duvet-pad-x)+2px)] bottom-[calc(var(--composer-h,64px)+12px)] z-5 grid size-10 place-items-center rounded-full"
		title="Jump to the newest"
		aria-label={unreadCount > 0 ? `Jump to the newest, ${unreadCount} new` : "Jump to the newest"}
		onclick={jumpToNewest}
	>
		<ArrowDownIcon size={16} />
		{#if unreadCount > 0}
			<span
				class="bg-duvet-accent text-duvet-on-accent absolute -top-1 -right-1 h-[18px] min-w-[18px] rounded-full px-[5px] text-center text-[10.5px] leading-[18px] font-bold tabular-nums"
				aria-hidden="true">{unreadCount}</span
			>
		{/if}
	</button>
{/if}

<!-- An author's picture: a click opens their profile beside it (a second one closes it), a right-click their menu.
     A webhook has neither. -->
{#snippet avatar(message: Message, size: number)}
	{@const member = members.find((m) => m.id === message.author_id)}
	{#key message.author_avatar_url}
		<button
			type="button"
			class="block rounded-full {member ? 'cursor-pointer' : 'cursor-default'}"
			data-author-menu={message.webhook_id ? "" : message.author_id}
			aria-label={message.author_name}
			onclick={(e) => openProfile(member, e.currentTarget)}
		>
			<UserAvatar src={message.author_avatar_url} name={message.author_name} {size} />
		</button>
	{/key}
{/snippet}

<!-- An author's name, in their role's colour (or its gradient), or else in ink: a click opens their profile -->
{#snippet authorName(message: Message, ink: string)}
	{@const member = members.find((m) => m.id === message.author_id)}
	{@const style = authorColors[message.author_id] || `color: ${ink}`}
	{#if member}
		<button
			type="button"
			class="min-w-0 cursor-pointer truncate font-semibold hover:underline"
			{style}
			onclick={(e) => openProfile(member, e.currentTarget)}>{message.author_name}</button
		>
	{:else}
		<span class="min-w-0 cursor-default truncate font-semibold" {style}>{message.author_name}</span>
	{/if}
{/snippet}

<!-- What a message holds: its text (a bubble, unless the rows are flat or it's only emoji), its cards, its files and
     its components, each a piece of its own in the column -->
{#snippet content(message: Message, mine: boolean, isFailed: boolean, isMention: boolean, isHighlighted: boolean)}
	{@const own = mine && !flat}
	{#if message.type === MessageType.Voice || message.sticker_attachment_id}
		<MessageAttachments {message} {channelName} onPreview={openPreview} />
	{:else if isLoading(message)}
		<!-- A bot's deferred response: it has 15 minutes to complete it -->
		<div class={flat ? "" : "bg-duvet-card shadow-duvet-raised rounded-2xl px-3 py-2"}>
			<DeferredResponse {message} />
		</div>
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
		{#if bubbled(message) || largeEmojis(message.content ?? "")}
			{@const emojiOnly = largeEmojis(message.content ?? "")}
			{@const lit = isMention && !flat && !emojiOnly}
			<div
				role="textbox"
				aria-readonly="true"
				tabindex="-1"
				use:prism={lit ? ($currentUser?.id ?? null) : null}
				class="font-content relative max-w-full cursor-text text-left text-[15px] wrap-anywhere select-text {emojiOnly
					? 'px-0.5 leading-[1.15]'
					: flat
						? `max-w-[760px] leading-[1.45] ${isFailed ? 'text-duvet-danger' : 'text-duvet-ink'}`
						: `rounded-2xl px-3 py-2 leading-[1.4] transition-shadow duration-200 motion-reduce:transition-none ${
								isFailed
									? 'bg-duvet-danger/15 text-duvet-danger'
									: lit
										? PRISM_BUBBLE
										: own
											? 'msg-own bg-duvet-azure text-fixed-white'
											: 'bg-duvet-card text-duvet-ink'
							} ${
								editingMessageId === message.id
									? 'shadow-[0_0_0_2px_var(--duvet-accent)]'
									: isHighlighted
										? 'shadow-[0_0_0_3px_var(--duvet-accent),var(--duvet-shadow-raised)]'
										: lit
											? ''
											: 'shadow-duvet-raised'
							}`}"
				onclick={(e) => {
					if (e.detail === 3 && mine) startEdit(message);
				}}
				onkeydown={(e) => {
					if (e.key === "Enter" && mine) startEdit(message);
				}}
			>
				{#if lit}
					<span class={PRISM_LIGHT} aria-hidden="true"></span>
					<span class={PRISM_RIM} aria-hidden="true"></span>
				{/if}
				<MessageText
					content={message.content ?? ""}
					large={emojiOnly}
					{mentionMap}
					mentionStyles={own ? undefined : mentionStyles}
					{customEmojiMap}
					{own}
					edited={message.updated_at !== message.created_at
						? `edited ${formatTimestamp(message.updated_at, now)}`
						: null}
				/>
			</div>
		{/if}
		<MessageCards content={message.content ?? ""} embeds={message.embeds} onPreview={(src) => openPreview(src)} />
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
{/snippet}

<!-- A bot's to this user alone, and not the room's: it lasts until dismissed or the app reloads. Nothing of the room's
     (reactions, replies, pins, links) applies to it, so it has no hover bar and no menu. -->
{#snippet ephemeralNote(message: Message)}
	<p class="text-duvet-ink2 flex items-center gap-1 px-1 text-xs">
		<EyeIcon class="size-3.5 shrink-0" />
		<span>Only you can see this</span>
		<span aria-hidden="true">·</span>
		<button
			type="button"
			class="text-duvet-ink cursor-pointer hover:underline"
			onclick={() => dropEphemeral(channelId, message.id)}>Dismiss message</button
		>
	</p>
{/snippet}

<!-- What the keys do here, while keyboard navigation's cursor is on this message. -->
{#snippet cursorHint(message: Message, mine: boolean, bare: boolean)}
	{#if keyboard.cursor === message.id && !bare}
		<span
			class="{GLASS} text-duvet-ink2 pointer-events-none absolute right-3 -bottom-3 z-10 flex items-center gap-2 rounded-lg px-2 py-0.5 text-[11px] font-medium"
			aria-hidden="true"
		>
			<span><kbd class="text-duvet-ink font-bold">r</kbd> reply</span>
			{#if mine}
				<span><kbd class="text-duvet-ink font-bold">e</kbd> edit</span>
			{/if}
		</span>
	{/if}
{/snippet}

<!-- A message that didn't send: its bar stays, with Retry and Dismiss -->
{#snippet failedBar(message: Message, mine: boolean)}
	<div
		use:fitBar
		class="{GLASS} pointer-events-auto absolute z-10 flex items-center gap-px rounded-xl p-[3px] whitespace-nowrap {flat
			? '-top-4 right-3.5'
			: mine
				? 'top-1/2 right-full mr-2 -translate-y-1/2 data-above:top-auto data-above:right-0 data-above:bottom-full data-above:mr-0 data-above:-mb-1 data-above:translate-y-0'
				: 'top-1/2 left-full ml-2 -translate-y-1/2 data-above:top-auto data-above:bottom-full data-above:left-0 data-above:-mb-1 data-above:ml-0 data-above:translate-y-0'}"
	>
		<button type="button" class={buttonClass("quiet", "sm")} onclick={() => onRetry(message)}>Retry</button>
		<button type="button" class={buttonClass("quiet", "sm")} onclick={() => onDismiss(message.nonce!)}>Dismiss</button>
	</div>
{/snippet}

<!-- The hover bar: the time of a bubble that isn't its group's last (that one has it under it), three reactions at
     one click, the emoji picker, Reply, Edit on one's own, and More, which opens the message's menu. Mounted for the
     row under the pointer only, and while its picker or its menu is open (#326). -->
{#snippet hoverBar(message: Message, mine: boolean, time: string | null)}
	<div
		use:fitBar
		class="{GLASS} animate-tip-in absolute z-10 flex items-center gap-px rounded-xl p-[3px] whitespace-nowrap {flat
			? '-top-4 right-3.5'
			: mine
				? 'top-1/2 right-full mr-2 -translate-y-1/2 flex-row-reverse data-above:top-auto data-above:right-0 data-above:bottom-full data-above:mr-0 data-above:-mb-1 data-above:translate-y-0'
				: 'top-1/2 left-full ml-2 -translate-y-1/2 data-above:top-auto data-above:bottom-full data-above:left-0 data-above:-mb-1 data-above:ml-0 data-above:translate-y-0'}"
	>
		{#if time}
			<span class="text-duvet-ink2 px-1.5 text-[11px] leading-none font-medium tabular-nums select-none">{time}</span>
			<span class="bg-duvet-line mx-[3px] h-[18px] w-px" aria-hidden="true"></span>
		{/if}
		{#each QUICK_REACTIONS as emoji (emoji)}
			<button
				type="button"
				class="hover:bg-duvet-hover grid size-7 place-items-center rounded-lg text-[13px] transition-transform duration-[120ms] hover:scale-[1.12] motion-reduce:transition-none"
				title="React {emoji}"
				aria-label="React {emoji}"
				onclick={() => handleReactionToggle(message, emoji)}
			>
				{@html renderEmoji(emoji)}
			</button>
		{/each}
		<span class="bg-duvet-line mx-[3px] h-[18px] w-px" aria-hidden="true"></span>
		<Popover.Root
			bind:open={() => reactingMessageId === message.id, (v) => (reactingMessageId = v ? message.id : null)}
		>
			<Popover.Trigger>
				{#snippet child({ props })}
					<IconButton {...props} label="Add reaction" title="Add reaction" size="sm">
						<SmilePlusIcon size={15} />
					</IconButton>
				{/snippet}
			</Popover.Trigger>
			<!-- Mounted only while open: bits-ui's Portal mounts what it holds as it's created, open or not (#319). -->
			{#if reactingMessageId === message.id}
				<Popover.Portal>
					<Popover.Content
						side="top"
						align={mine ? "start" : "end"}
						sideOffset={8}
						collisionPadding={10}
						class="z-100"
						role="dialog"
						aria-label="Add reaction"
					>
						<EmojiPicker onSelect={(emoji) => handleReactionPick(message.id, emoji)} {customEmojis} />
					</Popover.Content>
				</Popover.Portal>
			{/if}
		</Popover.Root>
		<IconButton label="Reply" title="Reply" size="sm" onclick={() => onReply?.(message)}>
			<ReplyIcon size={15} />
		</IconButton>
		{#if mine}
			<IconButton label="Edit message" title="Edit message" size="sm" onclick={() => startEdit(message)}>
				<PencilIcon size={15} />
			</IconButton>
		{/if}
		<!-- The menu's own root and portal, as Menu.svelte draws them, but mounted only while open: a portal mounts what
		     it holds as it's created, and every row the pointer passes would leave its menu's behind (#319). -->
		<DropdownMenu.Root bind:open={() => moreMenuFor === message.id, (v) => (moreMenuFor = v ? message.id : null)}>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<IconButton {...props} label="More" title="More" size="sm" active={moreMenuFor === message.id}>
						<EllipsisIcon size={15} />
					</IconButton>
				{/snippet}
			</DropdownMenu.Trigger>
			{#if moreMenuFor === message.id}
				<DropdownMenu.Portal>
					<!-- The panel's positioner takes no layer of its own: this holds it, at the menu's. -->
					<div class="fixed top-0 left-0" style={layerStyle(moreMenuLayer)}>
						<DropdownMenu.Content
							side="bottom"
							align={mine ? "start" : "end"}
							sideOffset={6}
							collisionPadding={10}
							aria-label="Message"
							class="{MENU_PANEL} origin-(--bits-floating-transform-origin)"
						>
							{@render messageItems(message)}
						</DropdownMenu.Content>
					</div>
				</DropdownMenu.Portal>
			{/if}
		</DropdownMenu.Root>
	</div>
{/snippet}

<!-- A message's menu, from its More button and from a right-click: a row of reactions, then what the hover bar has and
     the rest: its thread, its link, who reacted, its pin, its author's menu, and Delete for those who may. A notice
     has Delete alone. -->
{#snippet messageItems(message: Message)}
	{@const mine = !!$currentUser && message.author_id === $currentUser.id}
	{#if isNotice(message)}
		<MenuItem icon={TrashIcon} danger onSelect={() => void handleDelete(message.id)}>Delete message</MenuItem>
	{:else}
		<div class="border-duvet-line mb-1.5 flex items-center gap-0.5 border-b px-0.5 pt-0.5 pb-1.5">
			{#each MENU_REACTIONS as emoji (emoji)}
				<DropdownMenu.Item
					class="data-highlighted:bg-duvet-hover grid size-9 cursor-pointer place-items-center rounded-[10px] text-base transition-transform duration-[120ms] outline-none hover:scale-[1.15] motion-reduce:transition-none"
					aria-label="React {emoji}"
					onSelect={() => handleReactionToggle(message, emoji)}
				>
					{@html renderEmoji(emoji)}
				</DropdownMenu.Item>
			{/each}
			<DropdownMenu.Item
				class="text-duvet-ink2 data-highlighted:bg-duvet-hover data-highlighted:text-duvet-ink ml-auto grid size-9 cursor-pointer place-items-center rounded-[10px] outline-none"
				aria-label="More reactions"
				title="More reactions"
				onSelect={() => (reactingMessageId = message.id)}
			>
				<SmilePlusIcon size={18} />
			</DropdownMenu.Item>
		</div>
		<MenuItem icon={ReplyIcon} onSelect={() => onReply?.(message)}>Reply</MenuItem>
		<MenuItem icon={ThreadIcon} onSelect={() => void openThreadModal(message)}>View thread</MenuItem>
		<MenuItem icon={LinkIcon} onSelect={() => copyLink(message)}>Copy message link</MenuItem>
		{@render reactionsItem(message)}
		{#if mine}
			<MenuItem icon={PencilIcon} onSelect={() => startEdit(message)}>Edit message</MenuItem>
		{/if}
		{#if canPin}
			<MenuItem
				icon={message.pinned_at ? PinOffIcon : PinIcon}
				disabled={pinningMessageId === message.id}
				onSelect={() => void togglePin(message)}
			>
				{message.pinned_at ? "Unpin message" : "Pin message"}
			</MenuItem>
		{/if}
		{#if !message.webhook_id}
			<MenuSub label={message.author_name} icon={UserIcon}>
				{@render authorItems(message.author_id)}
			</MenuSub>
		{/if}
		{#if mine || currentUserCan(Permission.ManageMessages)}
			<MenuSeparator />
			<MenuItem icon={TrashIcon} danger onSelect={() => void handleDelete(message.id)}>Delete message</MenuItem>
		{/if}
	{/if}
{/snippet}

<!-- Who reacted, in the menu of a message that has reactions -->
{#snippet reactionsItem(message: Message)}
	{#if message.reactions?.length}
		<MenuItem icon={UsersIcon} onSelect={() => showReactors(message)}>Reactions</MenuItem>
	{/if}
{/snippet}

<!-- A member's menu: from a right-click on their avatar, and under their name in their message's menu (in a direct
     conversation's bubbles there's no avatar to click). Kick and Ban are for a member of the room's Space whom the API
     would let the user act on; the last one is Duvet staff's. -->
{#snippet authorItems(userId: string)}
	{@const isSelf = userId === $currentUser?.id}
	{@const alreadyFriend = !isSelf && isFriend(userId)}
	{@const pending = !isSelf && !alreadyFriend && hasPendingRequest(userId)}
	{@const moderation = moderationOf(
		space,
		members.find((m) => m.id === userId),
	)}
	{#if !isSelf}
		<MenuItem
			icon={UserPlusIcon}
			disabled={alreadyFriend || pending}
			onSelect={() => void handleSendFriendRequest(userId)}
		>
			{alreadyFriend ? "Already friends" : pending ? "Request pending" : "Send friend request"}
		</MenuItem>
	{/if}
	<MenuItem icon={CopyIcon} onSelect={() => void navigator.clipboard.writeText(userId)}>Copy user ID</MenuItem>
	{#if moderation}
		<MenuSeparator />
		{#if moderation.kick}
			<MenuItem icon={KickIcon} danger onSelect={() => void kickFromSpace(moderation.target)}>
				Kick {moderation.target.name}
			</MenuItem>
		{/if}
		{#if moderation.ban}
			<MenuItem icon={BanIcon} danger onSelect={() => banRequest.set(moderation.target)}>
				Ban {moderation.target.name}
			</MenuItem>
		{/if}
	{/if}
	{#if isStaff}
		<MenuSeparator />
		<MenuItem icon={BadgeCheckIcon} onSelect={() => openFlagsBadgesEditor(userId)}>Edit flags and badges</MenuItem>
	{/if}
{/snippet}

{#snippet deleteButton(message: Message)}
	<IconButton
		label="Delete message"
		title="Delete message"
		size="sm"
		class="hover:text-duvet-danger"
		disabled={deletingMessageId === message.id}
		onclick={() => handleDelete(message.id)}
	>
		{#if deletingMessageId === message.id}
			<SpinnerIcon size={15} class="animate-spin" />
		{:else}
			<TrashIcon size={15} />
		{/if}
	</IconButton>
{/snippet}

<!-- A message's thread: its messages, each replied to from here, over the thread's own message box. -->
<Sheet
	bind:open={threadModalOpen}
	title="Message thread"
	description={threadRootMessage ? `From ${threadRootMessage.author_name}` : undefined}
	class="min-w-[min(672px,calc(100%-48px))]"
>
	<div bind:this={threadScrollEl} class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">
		{#if threadLoading}
			<div class="flex items-center justify-center py-8">
				<SpinnerIcon class="text-duvet-ink2 size-6 animate-spin" />
			</div>
		{:else if threadError}
			<p class="text-duvet-danger text-sm">{threadError}</p>
		{:else if threadShown.length === 0}
			<p class="text-duvet-ink2 text-sm">No thread messages found.</p>
		{:else}
			{@const threadMsgMap = new Map(threadShown.map((m) => [m.id, m]))}
			<div class="flex flex-col gap-2" onclickcapture={openMention}>
				{#each threadShown as threadMsg (threadMsg.id)}
					{@const parentMsg = threadMsg.ref_message_id ? threadMsgMap.get(threadMsg.ref_message_id) : null}
					{@const parentCall = parentMsg ? callNoticeLine(parentMsg, $currentUser?.id, joined) : null}
					{@const root = threadRootMessage}
					<div class="group bg-duvet-card shadow-duvet-raised relative rounded-2xl px-3 py-2.5">
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
							<IconButton
								label="Reply to {threadMsg.author_name}"
								title="Reply"
								size="sm"
								class="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
								onclick={() => onThreadReply(threadMsg, root)}
							>
								<ReplyIcon size={14} />
							</IconButton>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
	<!-- The thread's own message box, which replies in it -->
	{#if threadComposer && threadRootMessage && !threadLoading && !threadError}
		<div class="-mx-4 -mb-4">
			{@render threadComposer(threadRootMessage)}
		</div>
	{/if}
</Sheet>

<ImagePreview src={previewSrc} alt={previewAlt} bind:open={previewOpen} />

<MentionProfile bind:this={mentionProfile} {members} {space} />

<!-- The profile a click on an author's name or avatar opens, beside it: one for the list, not one for each row -->
{#if profileFor}
	<MemberProfilePopover
		member={profileFor.member}
		{spaceId}
		{space}
		side="right"
		open
		anchor={profileFor.anchor}
		onOpenChange={(isOpen) => {
			if (!isOpen) closeProfile();
		}}
	/>
{/if}

<!-- Staff: Flags & Badges Editor -->
{#if flagsBadgesTarget}
	<Sheet
		bind:open={flagsBadgesOpen}
		title="Edit flags and badges"
		description="User: {flagsBadgesTarget.id}"
		class="max-w-[384px]"
	>
		<fieldset class="flex flex-col gap-2">
			<legend class="text-duvet-ink2 mb-2 text-[13px] font-semibold">Flags</legend>
			{#each FLAGS as f}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={!!(editFlags & f.flag)}
						onchange={() => toggleFlag(f.flag)}
						class="accent-duvet-accent"
					/>
					{f.name}
				</label>
			{/each}
		</fieldset>

		<fieldset class="flex flex-col gap-2">
			<legend class="text-duvet-ink2 mb-2 text-[13px] font-semibold">Badges</legend>
			{#each BADGES as b}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={!!(editBadges & b.flag)}
						onchange={() => toggleBadge(b.flag)}
						class="accent-duvet-accent"
					/>
					{b.name}
				</label>
			{/each}
		</fieldset>

		{#snippet foot()}
			<span></span>
			<button type="button" class={buttonClass("quiet")} onclick={() => (flagsBadgesOpen = false)}>Cancel</button>
			<button type="button" class={buttonClass("primary")} disabled={flagsBadgesSaving} onclick={saveFlagsBadges}>
				{flagsBadgesSaving ? "Saving…" : "Save"}
			</button>
		{/snippet}
	</Sheet>
{/if}
