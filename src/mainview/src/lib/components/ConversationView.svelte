<script lang="ts" module>
	import { dmMessages } from "$lib/stores.svelte";
	import { forgetUnlisted } from "$lib/uploads";
	import type { AllowedMentions, MessageReference } from "$lib/types";

	// Which sends failed, and what each message being sent was sent with besides its text (its files, reply, sticker,
	// and the reply's mention, or a voice note's audio), so that a retry sends it whole, as Chat's retryData does for a
	// room's. By nonce, and apart from the view, which goes with its tab: a failure can come after it's gone, and its
	// message stays in the conversation's list, for its Retry when the conversation shows again.
	let failedNonces = $state(new Set<string>());
	const dmRetryData = new Map<
		string,
		{
			ref?: MessageReference;
			files?: File[];
			stickerAttachmentId?: string;
			allowedMentions?: AllowedMentions;
			voiceNote?: Blob;
			/** The draft it came from: the conversation's, or one of its threads'. */
			draft?: string;
		}
	>();
	// A send's retry data goes once its message is in no list any more: nothing could retry or dismiss it (#323).
	dmMessages.subscribe((all) => forgetUnlisted(dmRetryData, all));
</script>

<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from "svelte";
	import { get } from "svelte/store";
	import { showChat } from "$lib/on-screen";
	import { DropdownMenu } from "bits-ui";
	import {
		conversations,
		currentUser,
		friends,
		unreadConversations,
		lastReadConvs,
		activeDMConvId,
		pageVisible,
		mentionCounts,
		activeCall,
		activeVoiceRoomId,
		callVoiceStates,
		conversationsWithCalls,
		ownCallsRinging,
		dropVoiceRequests,
		jumpToMessageRequest,
		gatewaySpaces,
		userActivities,
		friendsReady,
		LIST_ON_SCREEN_MAX,
		MESSAGE_PAGE,
	} from "$lib/stores.svelte";
	import { conversationLeft, sendEventMessage, getUserMobileOnly, getUserOnlineStatus } from "$lib/api/ws/connection";
	import { joinConversationCall, startConversationCall } from "$lib/voice";
	import { callingFromAnotherDevice, offersJoin, withoutCallVoiceOf } from "$lib/calls";
	import { friendUser } from "$lib/friends";
	import {
		getDirectMessages,
		getDirectMessageById,
		getDirectMessagesAfter,
		sendDirectMessage,
		sendDMVoiceNote,
		sendConversationTyping,
		sendConversationRecording,
		updateDirectMessage,
		deleteDirectMessage,
		addConversationMember,
		removeConversationMember,
		updateConversation,
		leaveConversation,
		ackConversation,
		type Conversation,
		type ConversationMember,
		type DirectMessage,
	} from "$lib/api/conversations";
	import type { Friend } from "$lib/api/friends";
	import { directMessageToMessage, MessageType, userStatusToString, type Message } from "$lib/types";
	import { toast } from "$lib/stores/toast.svelte";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { promptDialog } from "$lib/stores/prompt.svelte";
	import { getApiError } from "$lib/api/api";
	import { groupActions } from "$lib/groups";
	import { withSentMessage } from "$lib/arrivals";
	import { putBack, withoutDeletedReply, type SentDraft } from "$lib/drafts";
	import { CANCELLED, sendFollowed, withoutSending } from "$lib/uploads";
	import {
		dividerPastWindow,
		inWindow,
		keepJump,
		keepList,
		knowMessage,
		leaving,
		listSession,
		loadedTo,
		newestKnownIn,
		takeJump,
		takeList,
		withPresent,
	} from "$lib/jumps";
	import { Ellipsis, LogOut, MessageSquare, Pencil, Phone, UserPlus, Users } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Chat from "$lib/components/Chat.svelte";
	import MessageSearch from "$lib/components/MessageSearch.svelte";
	import PinnedMessages from "$lib/components/PinnedMessages.svelte";
	import GuildMemberSidebar from "$lib/components/GuildMemberSidebar.svelte";
	import VoiceChannelView from "$lib/components/VoiceChannelView.svelte";
	import type { MemberOnSidebar } from "$lib/types";
	import { getAvatarURL } from "$lib/common/common";
	import { activityLine, shownActivities } from "$lib/activity";
	import ChatIntro from "$lib/components/ChatIntro.svelte";
	import { buttonClass, pillClass } from "$lib/components/ui/recipes";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";

	let {
		conversation,
		onMemberAdded = undefined,
		onBarActions = undefined,
		paneFocused = true,
	}: {
		conversation: Conversation;
		onMemberAdded?: (member: ConversationMember) => void;
		/** A pane's bar, which names the conversation in its tab, shows its actions while it shows (null once it's
		 * gone). Without one, the view has its own header with them. */
		onBarActions?: (conversationId: string, actions: Snippet | null) => void;
		/** Whether its pane is the focused one, as its Chat takes it; true outside the panes (the friends view's). */
		paneFocused?: boolean;
	} = $props();

	let isLoading = $state(true);
	// Whether the first page failed, with nothing of the conversation loaded since: the list says so, with Try again,
	// rather than showing the conversation's start.
	let loadFailed = $state(false);
	let isLoadingMore = $state(false);
	let hasMore = $state(true);
	let isAtBottom = $state(false);
	let convUnreadAfter = $state<string | null>(null);
	const ackedConvMsgId = new Map<string, string>();
	let showMemberList = $state(true);
	let showAddMemberModal = $state(false);
	let addMemberLoading = $state(false);
	let addMemberError = $state("");
	let eligibleFriends = $state<Friend[]>([]);

	const me = $derived(get(currentUser));
	const isOwner = $derived(me?.id === conversation.owner_id);
	const actionsOnGroup = $derived(groupActions(conversation, me?.id));
	const isInCall = $derived($activeCall?.state === "connected" && $activeCall?.conversationId === conversation.id);
	const hasOngoingCall = $derived($conversationsWithCalls.has(conversation.id));
	// Not for the call this client shows, in it or on the call card (offersJoin).
	const canJoinCall = $derived(offersJoin(conversation.id, hasOngoingCall, $activeCall));
	// The user's own call, placed on another device, still rings the others: it shows as calling from there, and Join
	// and the call button wait for someone to answer it.
	const joinWaits = $derived(callingFromAnotherDevice(conversation.id, $ownCallsRinging, $activeCall));

	const callVoiceMembers = $derived(
		conversation.members.map((m) => ({
			id: m.user_id,
			username: m.user?.alias ?? m.user?.username ?? m.user_id.slice(0, 8),
			avatar_url: getAvatarURL(m.user_id, m.user?.avatar),
		})),
	);
	// Who is in the call's voice, shown on the banner of a call this client isn't in.
	const inCallNow = $derived(
		$callVoiceStates
			.filter((vs) => vs.room_id === conversation.id)
			.map(
				(vs) =>
					callVoiceMembers.find((m) => m.id === vs.user_id) ?? {
						id: vs.user_id,
						username: vs.user_id.slice(0, 8),
						avatar_url: null,
					},
			),
	);

	function joinCall() {
		joinConversationCall(conversation);
	}

	function hangUpCall() {
		const call = get(activeCall);
		if (!call) return;
		sendEventMessage("CALL_LEAVE", { conversation_id: call.conversationId });
		activeVoiceRoomId.set(null);
		activeCall.set(null);
		// The others stay in it, as its banner shows.
		callVoiceStates.update((states) => withoutCallVoiceOf(states, call.conversationId, get(currentUser)?.id));
		// The call's VoiceChat may already be gone (its connection failed): a camera or screen request it didn't
		// take goes with the call.
		dropVoiceRequests();
	}

	const convMembers = $derived<MemberOnSidebar[]>(
		conversation.members.map((m) => ({
			id: m.user_id,
			member_id: m.id,
			username: m.user?.alias ?? m.user?.username ?? m.user_id.slice(0, 8),
			raw_username: m.user?.username ?? m.user_id.slice(0, 8),
			avatar_url: getAvatarURL(m.user_id, m.user?.avatar),
			banner_url: getAvatarURL(m.user_id, m.user?.banner),
			status: userStatusToString(getUserOnlineStatus(m.user_id)),
			mobile_only: getUserMobileOnly(m.user_id),
			badges: m.user?.badges ?? 0,
			is_bot: m.user?.is_bot ?? false,
			// A DM's owner_id is just whoever opened it: only a group has an owner.
			is_owner: conversation.type === 2 && m.user_id === conversation.owner_id,
			roles: [],
			bio: m.user?.custom ?? "",
		})),
	);

	function getFriendOtherId(friend: Friend): string {
		const user = get(currentUser);
		return friend.sender_id === user?.id ? friend.recipient_id : friend.sender_id;
	}

	function openAddMemberModal() {
		const memberIds = new Set(conversation.members.map((m) => m.user_id));
		eligibleFriends = get(friends).filter((f) => !memberIds.has(getFriendOtherId(f)));
		showAddMemberModal = true;
		addMemberError = "";
	}

	async function handleAddMember(userId: string) {
		addMemberLoading = true;
		addMemberError = "";
		try {
			const newMember = await addConversationMember(conversation.id, userId);
			onMemberAdded?.(newMember);
			showAddMemberModal = false;
		} catch (err) {
			addMemberError = getApiError(err, "Failed to add member");
		} finally {
			addMemberLoading = false;
		}
	}

	async function renameGroup() {
		const convId = conversation.id;
		const current = conversation.name ?? "";
		const name = await promptDialog("Rename group", "Group name", current);
		if (!name || name === current) return;
		try {
			const updated = await updateConversation(convId, name);
			// CONVERSATION_UPDATE says so too, which can be missed.
			conversations.update((list) =>
				list.map((c) => (c.id === convId ? { ...c, name: updated.name, owner_id: updated.owner_id } : c)),
			);
		} catch (err) {
			toast(getApiError(err, "Couldn't rename the group"), "error");
		}
	}

	// A failure shows in the dialog, which stays. Done, the group goes here, its call too, whatever the gateway has said.
	function leaveGroup() {
		const convId = conversation.id;
		void confirmAction("Leave the group?", "Leave group", async () => {
			await leaveConversation(convId);
			conversationLeft(convId);
		});
	}

	// Map DirectMessage → Message for MessageList
	function toMessage(msg: DirectMessage): Message {
		return directMessageToMessage(msg, conversation.members);
	}

	// Cache mapped messages to avoid re-creating objects on every store update
	const messageCache = new Map<string, Message>();
	const messages = $derived.by(() => {
		const all = $dmMessages[conversation.id] ?? [];
		// While newer messages are still to load below a jump's pages, what came live past them waits for the pages.
		const raw = hasMoreBelow ? inWindow(all, loadedBelowTo) : all;
		const seen = new Set<string>();
		const result: Message[] = [];
		for (const msg of raw) {
			seen.add(msg.id);
			const cached = messageCache.get(msg.id);
			if (
				cached &&
				cached.content === msg.content &&
				cached.updated_at === msg.updated_at &&
				cached.attachments === msg.attachments &&
				cached.reactions === msg.reactions &&
				cached.embeds === msg.embeds &&
				cached.pinned_at === (msg.pinned_at ?? null) &&
				cached.referenced_message === (msg.referenced_message ?? null)
			) {
				result.push(cached);
			} else {
				const mapped = toMessage(msg);
				messageCache.set(msg.id, mapped);
				result.push(mapped);
			}
		}
		// Clean stale entries
		for (const key of messageCache.keys()) {
			if (!seen.has(key)) messageCache.delete(key);
		}
		return result;
	});

	function conversationTitle(): string {
		if (conversation.type === 2) return conversation.name ?? "Group";
		const other = conversation.members.find((m) => m.user_id !== me?.id);
		return other?.user?.alias ?? other?.user?.username ?? "DM";
	}

	// What comes after an await is read with the conversation's ID taken before it: once the view is gone (another tab
	// shows), its conversation prop is null. False when the page failed.
	async function loadMessages(before?: string): Promise<boolean> {
		const convId = conversation.id;
		const jump = jumps;
		try {
			const fetched = await getDirectMessages(convId, before);
			// A page that comes once the view is gone, or a jump has started (its pages are what the list shows), is dropped.
			if (jump !== jumps) return true;
			// And so is an older page once its cursor was cut away (#326): the next scroll up asks from the list's oldest.
			if (before && !get(dmMessages)[convId]?.some((m) => m.id === before)) return true;
			hasMore = fetched.length === 100;
			dmMessages.update((all) => {
				const existing = all[convId] ?? [];
				const existingIds = new Set(existing.map((m) => m.id));
				const newMsgs = fetched.filter((m) => !existingIds.has(m.id));
				return { ...all, [convId]: [...newMsgs, ...existing] };
			});
			// The newest page: the list reaches the present.
			if (!before) listFetched = true;
			return true;
		} catch (err) {
			console.error("[DM] Failed to load messages:", err);
			return false;
		}
	}

	// Whether the conversation was unread as the view opened: its first page opens at the divider.
	let hadUnread = false;
	// Whether the view has gone (another tab shows).
	let gone = false;
	// Whether the list holds pages a view of this gateway session fetched (this one's, or those of the view that left it
	// its list or its jump), rather than only what the store had: only such a list is kept for the next view (keepList).
	let listFetched = false;

	// The newest page, which the conversation opens on. One that fails leaves nothing of it loaded, which the list says
	// (loadFailed): Try again calls this again.
	function loadFirstPage() {
		const convId = conversation.id;
		isLoading = true;
		loadFailed = false;
		loadMessages().then((loaded) => {
			if (gone) return;
			loadFailed = !loaded;
			// An unread conversation opens at its divider (MessageList places the visit there).
			if (hadUnread) convUnreadAfter = unreadAfterOf(convId);
			isLoading = false;
		});
	}

	async function handleLoadMore() {
		if (isLoadingMore || !hasMore) return;
		isLoadingMore = true;
		const all = get(dmMessages)[conversation.id] ?? [];
		let oldest: string | undefined = undefined;
		if (all.length > 0) {
			oldest = all[0]!.id;
			for (const m of all) {
				if (m.id < oldest) oldest = m.id;
			}
		}
		await loadMessages(oldest);
		isLoadingMore = false;
	}

	// ── Jump to message ──────────────────────────────────────────────────────
	let lastHandledJumpId = "";
	let highlightedMessageId = $state<string | null>(null);
	// Whether newer messages are still to load below: a jump loads the messages around one, not up to the newest.
	let hasMoreBelow = $state(false);
	let isLoadingMoreBelow = $state(false);
	// The newest message of the pages a jump loaded, after which the next page below starts. Not the list's newest: a
	// message that came meanwhile (another member's, or one this user sent) would leave those before it out.
	let loadedBelowTo = $state("");
	// When the last page below failed: the next one waits a while (belowRetryWait) before it's asked for again.
	let belowFailedAt = 0;
	// The page below while it's asked for: a jump, or a trip to the present, calls it off, so that the new pages' next
	// one can be asked for at once rather than after it gives up.
	let belowRequest: AbortController | null = null;
	function callOffBelow() {
		belowRequest?.abort();
		belowRequest = null;
		isLoadingMoreBelow = false;
	}
	const belowRetryWait = 2_000;
	// The jumps so far: what a jump or a page below fetched is dropped when a newer jump has started since.
	let jumps = 0;

	$effect(() => {
		const req = $jumpToMessageRequest;
		if (!req || req.id === lastHandledJumpId) return;
		if (req.conversationId !== conversation.id) return;
		lastHandledJumpId = req.id;
		jumpToMessageRequest.set(null);
		if (req.messageId) void jumpToMessage(req.messageId);
	});

	async function jumpToMessage(messageId: string) {
		const convId = conversation.id;
		const jump = ++jumps;
		callOffBelow();
		try {
			const anchor = await getDirectMessageById(convId, messageId);
			const [rawAbove, rawBelow] = await Promise.all([
				getDirectMessages(convId, anchor.id),
				getDirectMessagesAfter(convId, anchor.id),
			]);
			if (jump !== jumps) return;

			const allIds = new Set<string>();
			const combined: DirectMessage[] = [];
			for (const m of [...rawAbove, anchor, ...rawBelow]) {
				if (!allIds.has(m.id)) {
					allIds.add(m.id);
					combined.push(m);
				}
			}

			hasMore = rawAbove.length >= 100;
			hasMoreBelow = rawBelow.length >= 100;
			loadedBelowTo = loadedTo(anchor.id, rawBelow);
			belowFailedAt = 0;
			loadFailed = false;
			dmMessages.update((all) => ({ ...all, [convId]: combined }));
			listFetched = true;
			highlightedMessageId = messageId;
			setTimeout(() => {
				highlightedMessageId = null;
			}, 3000);
		} catch (err) {
			console.error("[DM] Failed to jump to message:", err);
		}
	}

	// After a jump, the newer messages load below as the reader scrolls down to them, a page at a time, as a room's do. A
	// page that fails, or hasn't come in 10 s (a room's waits as long), is asked for again on a scroll there once
	// belowRetryWait has passed: the list also scrolls by itself (scroll anchoring), which must not ask again at once.
	async function handleLoadMoreBelow() {
		const after = loadedBelowTo;
		if (isLoadingMoreBelow || !hasMoreBelow || !after || Date.now() - belowFailedAt < belowRetryWait) return;
		const convId = conversation.id;
		const jump = jumps;
		isLoadingMoreBelow = true;
		const controller = new AbortController();
		belowRequest = controller;
		const timeoutId = setTimeout(() => controller.abort(), 10_000);
		try {
			const fetched = await getDirectMessagesAfter(convId, after, controller.signal);
			if (jump !== jumps) return;
			loadedBelowTo = loadedTo(after, fetched);
			dmMessages.update((all) => {
				const existing = all[convId] ?? [];
				const existingIds = new Set(existing.map((m) => m.id));
				return { ...all, [convId]: [...existing, ...fetched.filter((m) => !existingIds.has(m.id))] };
			});
			hasMoreBelow = fetched.length >= 100;
		} catch (err) {
			// A page a jump called off isn't a failure of the new pages'.
			if (jump === jumps) belowFailedAt = Date.now();
			console.error("[DM] Failed to load newer messages:", err);
		} finally {
			clearTimeout(timeoutId);
			if (belowRequest === controller) {
				belowRequest = null;
				isLoadingMoreBelow = false;
			}
		}
	}

	// A message sent from a jump's pages takes the reader to the present: the conversation's newest page takes the place
	// of the jump's pages, with the messages still being sent and what came after that page. True once it's there. One at
	// a time: a second message sent meanwhile waits for the same trip.
	let presentLoad: Promise<boolean> | null = null;
	function jumpToPresent(): Promise<boolean> {
		presentLoad ??= loadPresent().finally(() => (presentLoad = null));
		return presentLoad;
	}

	async function loadPresent(): Promise<boolean> {
		const convId = conversation.id;
		const jump = ++jumps;
		callOffBelow();
		try {
			const fetched = await getDirectMessages(convId);
			if (jump !== jumps) return false;
			hasMore = fetched.length === 100;
			hasMoreBelow = false;
			loadedBelowTo = "";
			belowFailedAt = 0;
			dmMessages.update((all) => ({ ...all, [convId]: withPresent(all[convId] ?? [], fetched) }));
			listFetched = true;
			return true;
		} catch (err) {
			console.error("[DM] Failed to load the newest messages:", err);
			return false;
		}
	}

	async function dmHandleSend(
		content: string,
		nonce: string,
		ref: MessageReference | undefined,
		files?: File[],
		stickerAttachmentId?: string,
		allowedMentions?: AllowedMentions,
		draft = conversation.id,
	) {
		const user = get(currentUser);
		if (!user) return;
		const convId = conversation.id;
		const isoNow = new Date().toISOString();
		const allMsgs = get(dmMessages)[convId] ?? [];
		const refMsg = ref?.message_id ? allMsgs.find((m) => m.id === ref.message_id) : null;
		const pending: DirectMessage = {
			id: nonce,
			conversation_id: convId,
			author_id: user.id,
			content,
			type: 0,
			created_at: isoNow,
			updated_at: isoNow,
			nonce,
			known_newest: newestKnownIn(convId),
			referenced_message: refMsg
				? {
						type: 0,
						message_id: refMsg.id,
						room_id: null,
						space_id: null,
						content: refMsg.content,
						author_id: refMsg.author_id,
						author_name: refMsg.user?.alias ?? refMsg.user?.username ?? refMsg.author_id.slice(0, 8),
						author_avatar: refMsg.user?.avatar ?? null,
						created_at: refMsg.created_at,
					}
				: null,
			attachments:
				files?.map((f) => ({
					id: "",
					message_id: "",
					filename: f.name,
					content_type: f.type || "application/octet-stream",
					size_bytes: f.size,
					created_at: isoNow,
					pending: true,
				})) ?? null,
			sticker_attachment_id: stickerAttachmentId ?? null,
		};
		dmMessages.update((all) => ({ ...all, [convId]: [...(all[convId] ?? []), pending] }));
		dmRetryData.set(nonce, { ref, files, stickerAttachmentId, allowedMentions, draft });
		// What a Cancel of its upload gives back to the draft, its reply as the list shows it: read now, as the view can be
		// gone by then.
		const fromDraft = sentDraft(content, files, ref, allowedMentions);
		const real = await sendFollowed(nonce, files, (upload) =>
			sendDirectMessage(convId, content, nonce, ref, files, undefined, stickerAttachmentId, allowedMentions, upload),
		);
		if (real === CANCELLED) dmCancelled(convId, nonce, fromDraft, draft);
		else showSent(convId, nonce, real);
	}

	// What a send took from the conversation's draft, for its Cancel: the reply's message is found in the list by its
	// reference, as a Retry's saved data has nothing else.
	function sentDraft(
		text: string,
		files: File[] | undefined,
		ref: MessageReference | undefined,
		allowedMentions: AllowedMentions | undefined,
	): SentDraft {
		return {
			text,
			files: files ?? [],
			replyTo: messages.find((m) => m.id === ref?.message_id) ?? null,
			replyMention: allowedMentions?.replied_user ?? true,
		};
	}

	// What follows a send of this window's that the API took: its retry data goes, and the API's copy takes the place of
	// its pending one, by its nonce, as DM_MESSAGE_CREATE's does. That event can be missed, and the message would stay
	// pending.
	function showSent(convId: string, nonce: string, real: DirectMessage) {
		dmRetryData.delete(nonce);
		knowMessage(convId, real.id);
		dmMessages.update((all) => {
			const existing = all[convId] ?? [];
			const shown = withSentMessage(existing, nonce, real);
			return shown === existing ? all : { ...all, [convId]: shown };
		});
	}

	// As a room's (Chat's cancelled): a send whose upload was cancelled leaves the conversation's list, and what it took
	// from its draft (into: the conversation's, or one of its threads') goes back, unless DM_MESSAGE_CREATE has replaced
	// it, the message posted after all.
	function dmCancelled(convId: string, nonce: string, fromDraft: SentDraft, into = convId) {
		dmRetryData.delete(nonce);
		let sending: DirectMessage | undefined;
		dmMessages.update((all) => {
			const list = all[convId] ?? [];
			const kept = withoutSending(list, nonce);
			if (!kept) return all;
			sending = list.find((m) => m.id === nonce);
			return { ...all, [convId]: kept };
		});
		if (sending) putBack(convId, nonce, withoutDeletedReply(fromDraft, sending), into);
	}

	async function dmSaveEdit(messageId: string, content: string) {
		const convId = conversation.id;
		const updated = await updateDirectMessage(convId, messageId, content);
		dmMessages.update((all) => {
			const existing = all[convId] ?? [];
			return { ...all, [convId]: existing.map((m) => (m.id === messageId ? { ...m, ...updated } : m)) };
		});
	}

	async function dmDelete(messageId: string) {
		const convId = conversation.id;
		await deleteDirectMessage(convId, messageId);
		dmMessages.update((all) => ({
			...all,
			[convId]: (all[convId] ?? []).filter((m) => m.id !== messageId),
		}));
	}

	function dmRetry(message: Message) {
		const convId = conversation.id;
		const nonce = message.nonce!;
		const saved = dmRetryData.get(nonce);
		failedNonces = new Set([...failedNonces].filter((n) => n !== nonce));
		// A voice note goes again as one: its audio, not its empty text.
		if (saved?.voiceNote) {
			sendDMVoiceNote(convId, saved.voiceNote, nonce)
				.then((real) => showSent(convId, nonce, real))
				.catch((err) => {
					failedNonces = new Set(failedNonces).add(nonce);
					toast(getApiError(err, "Failed to send voice note"), "error");
				});
			return;
		}
		const fromDraft = sentDraft(message.content ?? "", saved?.files, saved?.ref, saved?.allowedMentions);
		sendFollowed(nonce, saved?.files, (upload) =>
			sendDirectMessage(
				convId,
				message.content ?? "",
				nonce,
				saved?.ref,
				saved?.files,
				undefined,
				saved?.stickerAttachmentId,
				saved?.allowedMentions,
				upload,
			),
		)
			.then((real) =>
				real === CANCELLED ? dmCancelled(convId, nonce, fromDraft, saved?.draft) : showSent(convId, nonce, real),
			)
			.catch((err) => {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send message"), "error");
			});
	}

	function dmDismiss(nonce: string) {
		dmRetryData.delete(nonce);
		failedNonces = new Set([...failedNonces].filter((n) => n !== nonce));
		dmMessages.update((all) => ({
			...all,
			[conversation.id]: (all[conversation.id] ?? []).filter((m) => m.nonce !== nonce),
		}));
	}

	async function dmVoiceNote(blob: Blob) {
		const nonce = crypto.randomUUID();
		const user = get(currentUser);
		if (!user) return;
		const convId = conversation.id;

		const isoNow = new Date().toISOString();
		const pending: DirectMessage = {
			id: nonce,
			conversation_id: convId,
			author_id: user.id,
			content: "",
			type: MessageType.Voice,
			created_at: isoNow,
			updated_at: isoNow,
			nonce,
			known_newest: newestKnownIn(convId),
			attachments: [
				{
					id: "",
					message_id: "",
					filename: "voice-note.webm",
					content_type: "audio/webm;codecs=opus",
					size_bytes: blob.size,
					created_at: isoNow,
					pending: true,
				},
			],
		};
		dmMessages.update((all) => ({ ...all, [convId]: [...(all[convId] ?? []), pending] }));

		dmRetryData.set(nonce, { voiceNote: blob });
		sendDMVoiceNote(convId, blob, nonce)
			.then((real) => showSent(convId, nonce, real))
			.catch((err) => {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send voice note"), "error");
			});
	}

	async function handleRemoveMember(userId: string) {
		await removeConversationMember(conversation.id, userId);
	}

	function startCall() {
		startConversationCall(conversation);
	}

	// The newest message the server has: not one still being sent.
	function newestConfirmedId(msgs: { id: string; nonce?: string }[]): string {
		let newestId = "";
		for (const m of msgs) {
			if (m.id === m.nonce) continue;
			if (m.id > newestId) newestId = m.id;
		}
		return newestId;
	}

	// Acks the conversation's newest confirmed message, unless that one already was, and clears its unread dot and
	// mention count.
	function ackNewest(convId: string, msgs: { id: string; nonce?: string }[]) {
		const newestId = newestConfirmedId(msgs);
		if (!newestId || newestId === ackedConvMsgId.get(convId)) return;
		ackedConvMsgId.set(convId, newestId);
		lastReadConvs.update((all) => (all ? { ...all, [convId]: newestId } : all));
		unreadConversations.update((s) => {
			s.delete(convId);
			return s;
		});
		mentionCounts.update((all) => {
			const copy = { ...all };
			delete copy[convId];
			return copy;
		});
		ackConversation(convId, newestId).catch(() => {});
	}

	// Where an unread conversation's divider goes: after its read position, or above all of it when it was never read
	// ("0": every message is newer). Without READY's read positions (an older gateway), nowhere.
	function unreadAfterOf(convId: string): string | null {
		const positions = get(lastReadConvs);
		if (!positions) return null;
		const lastRead = positions[convId];
		if (!lastRead) return "0";
		return newestConfirmedId(get(dmMessages)[convId] ?? []) > lastRead ? lastRead : null;
	}

	// ACK helper — sends an ack for the newest confirmed DM if at bottom. Not while newer messages are still to load
	// below, as after a jump: the bottom of the list isn't the conversation's newest message then.
	function tryAckConversation() {
		const msgs = get(dmMessages)[conversation.id] ?? [];
		if (!isAtBottom || isLoading || hasMoreBelow || !get(pageVisible) || msgs.length === 0) return;
		// Clear the unread divider
		if (convUnreadAfter != null) convUnreadAfter = null;
		ackNewest(conversation.id, msgs);
	}

	// A message that came past a jump's pages shows only when the pages below reach it, yet the conversation is unread:
	// its divider goes after the read position, so leaving keeps the dot, and the pages below show it in its place. Not
	// without READY's read positions (an older gateway), as unreadAfterOf.
	$effect(() => {
		const all = $dmMessages[conversation.id] ?? [];
		const positions = $lastReadConvs;
		if (!hasMoreBelow || convUnreadAfter != null || !positions) return;
		const at = dividerPastWindow(all, loadedBelowTo, me?.id, positions[conversation.id]);
		if (at !== null) convUnreadAfter = at;
	});

	// ACK reactively when at bottom, page visible, and messages change, once nothing newer is left to load below.
	$effect(() => {
		const msgs = $dmMessages[conversation.id] ?? [];
		const atBottom = isAtBottom;
		const visible = $pageVisible;
		const moreBelow = hasMoreBelow;
		if (!atBottom || !visible || isLoading || moreBelow || msgs.length === 0) return;
		if (convUnreadAfter != null) convUnreadAfter = null;
		ackNewest(conversation.id, msgs);
	});

	// ACK on a 5-second interval as a safety net.
	let ackInterval: ReturnType<typeof setInterval> | null = null;
	$effect(() => {
		const _convId = conversation.id;
		if (ackInterval) {
			clearInterval(ackInterval);
			ackInterval = null;
		}
		ackInterval = setInterval(tryAckConversation, 1e3);
		return () => {
			if (ackInterval) {
				clearInterval(ackInterval);
				ackInterval = null;
			}
		};
	});

	// ACK when leaving the conversation — only if at bottom. Only the bottom reads it, not opening it: one left above
	// its newest messages is unread again, as the server still has it, and opens at its divider the next time.
	$effect(() => {
		// Untracked: the conversation's object changes with each of its messages, while the view stays (each conversation
		// has a view of its own), and this effect's cleanup is leaving it.
		const convId = untrack(() => conversation.id);
		return () => {
			// Left, or removed from it: nothing to ack there any more, and an unread dot nothing could clear.
			if (!get(conversations).some((c) => c.id === convId)) return;
			const msgs = get(dmMessages)[convId] ?? [];
			// A list that stops short of the newest messages (a jump's, with newer ones still to load below) is no sign of
			// having read them: it doesn't ack the conversation (leaving).
			const left = leaving(
				{ atBottom: isAtBottom, newest: newestConfirmedId(msgs), moreBelow: hasMoreBelow, loadedBelowTo },
				convUnreadAfter,
				ackedConvMsgId.get(convId),
				get(lastReadConvs)?.[convId],
			);
			if (left.ack) ackNewest(convId, msgs);
			if (!left.unread) convUnreadAfter = null;
			else {
				unreadConversations.update((s) => {
					s.add(convId);
					return s;
				});
			}
		};
	});

	$effect(() => {
		if (!onBarActions) return;
		const show = onBarActions;
		const convId = conversation.id;
		show(convId, actions);
		return () => show(convId, null);
	});

	onMount(() => {
		const convId = conversation.id;
		// The gateway session this view comes in, which the list it leaves is of.
		const session = listSession();
		activeDMConvId.set(convId);
		// On screen while this view is (lib/on-screen.ts), as a pane's room is.
		const hide = showChat(convId);
		// Its list stays in the store while this view shows it (#320).
		const release = dmMessages.keep(convId);
		// A list cut back has older messages to load again (#326).
		const unhear = dmMessages.onTrim((chat) => {
			if (chat === convId) hasMore = true;
		});
		hadUnread = get(unreadConversations).has(convId);
		unreadConversations.update((s) => {
			s.delete(convId);
			return s;
		});
		// Back from another tab in the middle of a jump's pages: the list goes on from them, as a room's does, rather than
		// putting the newest page beside them with the messages between left out. Or back to the list a view of this
		// gateway session left at the present, which the gateway's events kept current: it shows as it is, as a room's
		// does in its pane, with no page asked for.
		const list = get(dmMessages)[convId];
		const kept = takeJump(convId, list);
		const keptList = takeList(convId, list);
		if (kept) {
			hasMore = kept.hasMore;
			hasMoreBelow = true;
			loadedBelowTo = kept.loadedBelowTo;
		} else if (keptList) {
			hasMore = keptList.hasMore;
		}
		if (kept || keptList) {
			listFetched = true;
			if (hadUnread) convUnreadAfter = unreadAfterOf(convId);
			isLoading = false;
		} else {
			loadFirstPage();
		}
		return () => {
			// What the view still waits for (its first page, a jump's pages, a page below) is dropped as it comes.
			gone = true;
			jumps++;
			callOffBelow();
			keepJump(convId, hasMoreBelow ? { hasMore, loadedBelowTo } : null);
			// Not for a conversation the user left (or was removed from), whose messages stop reaching them: its view goes
			// after conversationLeft forgot its list.
			const stillIn = get(conversations).some((c) => c.id === convId);
			// Left at the present, the list goes back to its newest page, which is all the next view opens on, as a room's
			// does (#326). Not as a READY takes the views down, as the reader's place is kept for the next ones.
			if (!hasMoreBelow && get(friendsReady)) dmMessages.trim(convId, MESSAGE_PAGE);
			keepList(
				convId,
				listFetched && !hasMoreBelow && stillIn ? (get(dmMessages)[convId] ?? null) : null,
				hasMore,
				session,
			);
			activeDMConvId.update((cur) => (cur === convId ? null : cur));
			hide();
			release();
			unhear();
		};
	});

	// On screen, the list is cut back to its newest page once its reader is at its bottom with more than
	// LIST_ON_SCREEN_MAX messages in it, as a room's is (#326), after the update that brought the message.
	$effect(() => {
		const convId = conversation?.id;
		if (!convId || !isAtBottom || hasMoreBelow) return;
		if (($dmMessages[convId]?.length ?? 0) > LIST_ON_SCREEN_MAX) {
			void tick().then(() => dmMessages.trim(convId, LIST_ON_SCREEN_MAX));
		}
	});
</script>

<!-- The start of the conversation: who it's with and the Spaces shared with them, or the group's people -->
{#snippet intro()}
	{@const other = conversation.type === 2 ? null : conversation.members.find((m) => m.user_id !== me?.id)}
	{@const status = other ? convMembers.find((m) => m.id === other.user_id)?.status : undefined}
	{@const mobileOnly = other ? (convMembers.find((m) => m.id === other.user_id)?.mobile_only ?? false) : false}
	{@const activity = other ? shownActivities($userActivities[other.user_id])[0] : undefined}
	{@const shared = other ? $gatewaySpaces.filter((sp) => sp.members.some((m) => m.user_id === other.user_id)) : []}
	<ChatIntro title={conversationTitle()}>
		{#snippet icon()}
			{#if other}
				<UserAvatar src={getAvatarURL(other.user_id, other.user?.avatar)} name={conversationTitle()} size={64} />
			{:else}
				<div class="flex justify-center -space-x-3">
					{#each convMembers.filter((m) => m.id !== me?.id).slice(0, 4) as member (member.id)}
						<UserAvatar
							src={member.avatar_url}
							name={member.username}
							size={48}
							class="ring-duvet-bg rounded-full ring-4"
						/>
					{/each}
				</div>
			{/if}
		{/snippet}
		{#if other}
			<p class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
				{#if other.user?.username}<span>@{other.user.username}</span>{/if}
				{#if status}
					<span class="flex items-center gap-1.5">
						<!-- Online's dot, or the phone for someone only on mobile: no ring, its screen the pane's colour -->
						{#if status === "online"}<StatusDot {status} {mobileOnly} class="text-duvet-bg w-2" />{/if}
						{status === "online"
							? "Online"
							: status === "dnd"
								? "Do Not Disturb"
								: status === "idle"
									? "Away"
									: "Offline"}
					</span>
				{/if}
				{#if activity}
					{@const line = activityLine(activity)}
					<span>{line.kind === "listening" ? "Listening to" : "Playing"} {line.text}</span>
				{/if}
			</p>
			<p>This is the start of your conversation with {conversationTitle()}.</p>
		{:else}
			<p>
				{new Intl.ListFormat("en", { type: "conjunction" }).format(
					convMembers.filter((m) => m.id !== me?.id).map((m) => m.username),
				)}
			</p>
			<p>This is the start of the group.</p>
		{/if}
		<div class="mt-2 flex flex-wrap items-center justify-center gap-2">
			{#each shared as space (space.id)}
				<span class="{pillClass()} pl-1">
					<SpaceIcon
						src={space.icon ? getAvatarURL(space.id, space.icon) : null}
						name={space.name}
						size={20}
						class="rounded-md"
					/>
					{space.name}
				</span>
			{/each}
			{#if conversation.type === 2 && isOwner}
				<button type="button" class={buttonClass("secondary")} onclick={openAddMemberModal}>
					<UserPlus class="size-4" />
					Add people
				</button>
			{/if}
			<!-- A call going on has Join in its banner -->
			{#if !hasOngoingCall}
				<button type="button" class={buttonClass("primary")} onclick={startCall} disabled={!!$activeCall || joinWaits}>
					<Phone class="size-4" />
					Call
				</button>
			{/if}
		</div>
	</ChatIntro>
{/snippet}

<!-- The call, the group's members and its pins and search: in the pane's bar, or else in a header of its own -->
{#snippet actions()}
	{@const buttonClass =
		"text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink focus-visible:outline-duvet-accent flex items-center gap-1 rounded-lg p-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"}
	{@const groupMenuItem =
		"rounded-row flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-left text-sm font-medium transition-colors data-highlighted:bg-duvet-bg/60 motion-reduce:transition-none"}
	<button
		type="button"
		class={buttonClass}
		onclick={startCall}
		disabled={!!$activeCall || joinWaits}
		title="Start call"
		aria-label="Start call"
	>
		<Phone class="size-4" />
	</button>
	{#if conversation.type === 2 && isOwner}
		<button type="button" class={buttonClass} onclick={openAddMemberModal} title="Add member">
			<UserPlus class="size-4" />
			Add
		</button>
	{/if}
	<!-- A group says how many it has here, where its members open. -->
	<button
		type="button"
		class="{buttonClass} {showMemberList ? 'bg-duvet-card text-duvet-ink' : ''}"
		onclick={() => {
			showMemberList = !showMemberList;
		}}
		title="Members"
		aria-label={conversation.type === 2 ? `Members, ${conversation.members.length}` : "Members"}
		aria-pressed={showMemberList}
	>
		<Users class="size-4" />
		{#if conversation.type === 2}
			<span class="tabular-nums">{conversation.members.length}</span>
		{/if}
	</button>
	{#key conversation.id}
		<PinnedMessages channelId={conversation.id} conversation members={convMembers} toDirectMessage={toMessage} />
		<MessageSearch conversationId={conversation.id} members={convMembers} toDirectMessage={toMessage} />
	{/key}
	{#if actionsOnGroup.leave}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class={buttonClass} title="Group options" aria-label="Group options">
				<Ellipsis class="size-4" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					class="rounded-card border-duvet-line bg-duvet-card text-duvet-ink shadow-duvet-float focus-override z-200 min-w-44 border p-1.5 outline-none"
					sideOffset={4}
					align="end"
				>
					{#if actionsOnGroup.rename}
						<DropdownMenu.Item class={groupMenuItem} onSelect={renameGroup}>
							<Pencil class="text-duvet-ink2 size-4" />
							Rename group
						</DropdownMenu.Item>
					{/if}
					<DropdownMenu.Item class="{groupMenuItem} text-duvet-danger" onSelect={leaveGroup}>
						<LogOut class="size-4" />
						Leave group
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	{/if}
{/snippet}

<div class="bg-duvet-bg relative flex flex-1 flex-col overflow-hidden">
	{#if !onBarActions}
		<div class="border-duvet-line flex h-12 shrink-0 items-center gap-2 border-b px-3 font-semibold">
			<MessageSquare class="text-duvet-ink2 size-4" />
			<span class="truncate">{conversationTitle()}</span>
			<div class="ml-auto flex items-center gap-1">
				{@render actions()}
			</div>
		</div>
	{/if}

	<!-- Call in progress banner (visible when not in the call), with who is in it -->
	{#snippet inCallAvatars()}
		{#if inCallNow.length > 0}
			<span class="flex items-center -space-x-1.5" title={inCallNow.map((m) => m.username).join(", ")}>
				{#each inCallNow.slice(0, 4) as member (member.id)}
					<UserAvatar src={member.avatar_url} name={member.username} size={20} class="ring-duvet-line ring-2" />
				{/each}
			</span>
			{#if inCallNow.length > 4}
				<span class="text-duvet-alive text-xs">+{inCallNow.length - 4}</span>
			{/if}
		{/if}
	{/snippet}
	{#if canJoinCall && joinWaits}
		<div
			class="bg-duvet-sunk text-duvet-alive mx-(--duvet-pad-x) mt-2 flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[13px]"
		>
			<Phone class="size-4" />
			<span class="font-medium">Calling from another device</span>
			{@render inCallAvatars()}
		</div>
	{:else if canJoinCall}
		<button
			class="bg-duvet-sunk text-duvet-alive hover:bg-duvet-hover mx-(--duvet-pad-x) mt-2 flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[13px] transition-colors motion-reduce:transition-none"
			onclick={joinCall}
		>
			<Phone class="size-4" />
			<span class="font-medium">Call in progress — Join</span>
			{@render inCallAvatars()}
		</button>
	{/if}

	<!-- Active call view: a flex column, so the tiles scroll within its half and the controls stay in sight -->
	{#if isInCall}
		<div class="border-duvet-line flex max-h-[50%] shrink-0 flex-col overflow-hidden border-b">
			<VoiceChannelView
				channelId={conversation.id}
				channelName={conversationTitle()}
				callMode
				callMembers={callVoiceMembers}
				onHangUp={hangUpCall}
			/>
		</div>
	{/if}

	<!-- Body: messages + optional member sidebar -->
	<div class="flex flex-1 overflow-hidden">
		<Chat
			{intro}
			{messages}
			channelId={conversation.id}
			channelName={conversationTitle()}
			placeholder={`Message ${conversationTitle()}`}
			isInitialLoading={isLoading}
			retryFirstPage={loadFailed ? loadFirstPage : null}
			{isLoadingMore}
			hasMoreMessages={hasMore}
			hasMoreMessagesBelow={hasMoreBelow}
			{isLoadingMoreBelow}
			{highlightedMessageId}
			onLoadMore={handleLoadMore}
			onLoadMoreBelow={handleLoadMoreBelow}
			onJumpToPresent={jumpToPresent}
			bind:failedNonces
			bind:isAtBottom
			onSend={dmHandleSend}
			onSaveEdit={dmSaveEdit}
			onDeleteMsg={dmDelete}
			onRetry={dmRetry}
			onDismiss={dmDismiss}
			sendTyping={() => sendConversationTyping(conversation.id).catch(() => {})}
			sendRecording={() => sendConversationRecording(conversation.id).catch(() => {})}
			onVoiceNoteOverride={dmVoiceNote}
			members={convMembers}
			unreadAfterMessageId={convUnreadAfter}
			onUnreadMark={(msgId) => {
				if (convUnreadAfter == null) convUnreadAfter = msgId;
			}}
			{paneFocused}
		/>

		<!-- Member list sidebar -->
		{#if showMemberList}
			<GuildMemberSidebar
				overrideMembers={convMembers}
				channelId={conversation.id}
				onRemoveMember={conversation.type === 2 && isOwner ? handleRemoveMember : undefined}
			/>
		{/if}
	</div>
</div>

{#if showAddMemberModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
		role="button"
		tabindex="-1"
		onclick={() => {
			showAddMemberModal = false;
		}}
		onkeydown={() => {}}
	>
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="border-duvet-line bg-duvet-bg flex w-80 flex-col gap-3 rounded-lg border p-6"
			role="dialog"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
		>
			<h3 class="text-duvet-ink text-sm font-semibold">Add member</h3>
			{#if eligibleFriends.length === 0}
				<p class="text-duvet-ink2 py-4 text-center text-xs">No friends available to add</p>
			{:else}
				<div class="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
					{#each eligibleFriends as friend (friend.id)}
						{@const uid = getFriendOtherId(friend)}
						{@const other = friendUser(friend, $currentUser?.id)}
						<button
							class="hover:bg-duvet-card flex items-center gap-2 rounded px-3 py-2 text-left disabled:opacity-50"
							onclick={() => handleAddMember(uid)}
							disabled={addMemberLoading}
						>
							<UserAvatar src={getAvatarURL(other.id, other.avatar)} name={other.alias ?? other.username} size={32} />
							<div class="flex min-w-0 flex-col">
								<span class="text-duvet-ink text-sm">{other.alias ?? other.username}</span>
								<span class="text-duvet-ink2 text-xs">@{other.username}</span>
							</div>
						</button>
					{/each}
				</div>
			{/if}
			{#if addMemberError}
				<p class="bg-duvet-danger/10 text-duvet-danger rounded px-3 py-2 text-xs">{addMemberError}</p>
			{/if}
			<button
				class="text-duvet-ink2 hover:text-duvet-ink self-end text-xs"
				onclick={() => {
					showAddMemberModal = false;
				}}
			>
				Cancel
			</button>
		</div>
	</div>
{/if}
