<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import {
		currentUser,
		dmMessages,
		friends,
		unreadConversations,
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
	} from "$lib/stores.svelte";
	import { acceptCall, placeCall, sendEventMessage, getUserOnlineStatus } from "$lib/api/ws/connection";
	import { withoutCallVoiceOf } from "$lib/calls";
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
		ackConversation,
		type Conversation,
		type ConversationMember,
		type DirectMessage,
	} from "$lib/api/conversations";
	import type { Friend } from "$lib/api/friends";
	import {
		MessageType,
		userStatusToString,
		type AllowedMentions,
		type Message,
		type MessageReference,
	} from "$lib/types";
	import { toast } from "$lib/stores/toast.svelte";
	import { getApiError } from "$lib/api/api";
	import { withSentMessage } from "$lib/arrivals";
	import { MessageSquare, Phone, UserPlus, Users } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Chat from "$lib/components/Chat.svelte";
	import MessageSearch from "$lib/components/MessageSearch.svelte";
	import PinnedMessages from "$lib/components/PinnedMessages.svelte";
	import GuildMemberSidebar from "$lib/components/GuildMemberSidebar.svelte";
	import VoiceChannelView from "$lib/components/VoiceChannelView.svelte";
	import type { MemberOnSidebar } from "$lib/types";
	import { getAvatarURL } from "$lib/common/common";

	let {
		conversation,
		onMemberAdded = undefined,
	}: {
		conversation: Conversation;
		onMemberAdded?: (member: ConversationMember) => void;
	} = $props();

	let isLoading = $state(true);
	let isLoadingMore = $state(false);
	let hasMore = $state(true);
	let failedNonces = $state(new Set<string>());
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
	const isInCall = $derived($activeCall?.state === "connected" && $activeCall?.conversationId === conversation.id);
	const hasOngoingCall = $derived($conversationsWithCalls.has(conversation.id));
	const canJoinCall = $derived(hasOngoingCall && !isInCall);
	// The user's own call, placed on another device, still rings the others: it shows as calling from there, and Join
	// and the call button wait for someone to answer it.
	const joinWaits = $derived($ownCallsRinging.has(conversation.id));

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
		const user = get(currentUser);
		if (!user) return;
		const memberIds = conversation.members.map((m) => m.user_id);
		// Ensure call exists on gateway (idempotent if already exists)
		sendEventMessage("CALL_INITIATE", {
			conversation_id: conversation.id,
			member_ids: memberIds,
		});
		acceptCall(conversation.id);
		activeCall.set({
			conversationId: conversation.id,
			initiatorId: user.id,
			initiatorName: user.alias ?? user.username ?? "You",
			initiatorAvatar: user.avatar ?? null,
			state: "connected",
			memberIds,
		});
		// Delay slightly so gateway processes CALL_INITIATE before VoiceChat sends VOICE_JOIN
		setTimeout(() => activeVoiceRoomId.set(conversation.id), 50);
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

	// Map DirectMessage → Message for MessageList
	function toMessage(msg: DirectMessage): Message {
		const member = conversation.members.find((m) => m.user_id === msg.author_id);
		return {
			id: msg.id,
			content: msg.content,
			type: msg.type ?? 0,
			author_id: msg.author_id,
			author_name:
				msg.user?.alias ??
				msg.user?.username ??
				member?.user?.alias ??
				member?.user?.username ??
				msg.author_id.slice(0, 8),
			author_avatar_url: getAvatarURL(msg.author_id, msg.user?.avatar ?? member?.user?.avatar),
			author_is_bot: msg.user?.is_bot ?? false,
			created_at: msg.created_at,
			updated_at: msg.updated_at,
			nonce: msg.nonce,
			ref_message_id: msg.referenced_message?.message_id ?? null,
			referenced_message: msg.referenced_message ?? null,
			attachments: msg.attachments ?? null,
			reactions: msg.reactions ?? null,
			embeds: msg.embeds ?? null,
			sticker_attachment_id: msg.sticker_attachment_id ?? null,
			pinned_at: msg.pinned_at ?? null,
		};
	}

	// Cache mapped messages to avoid re-creating objects on every store update
	const messageCache = new Map<string, Message>();
	const messages = $derived.by(() => {
		const raw = $dmMessages[conversation.id] ?? [];
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

	async function loadMessages(before?: string) {
		try {
			const fetched = await getDirectMessages(conversation.id, before);
			hasMore = fetched.length === 100;
			dmMessages.update((all) => {
				const existing = all[conversation.id] ?? [];
				const existingIds = new Set(existing.map((m) => m.id));
				const newMsgs = fetched.filter((m) => !existingIds.has(m.id));
				return { ...all, [conversation.id]: [...newMsgs, ...existing] };
			});
		} catch (err) {
			console.error("[DM] Failed to load messages:", err);
		}
	}

	async function handleLoadMore() {
		if (isLoadingMore || !hasMore) return;
		isLoadingMore = true;
		const all = get(dmMessages)[conversation.id] ?? [];
		let oldest: string | undefined = undefined;
		if (all.length > 0) {
			oldest = all[0].id;
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
	let hasMoreBelow = $state(false);

	$effect(() => {
		const req = $jumpToMessageRequest;
		if (!req || req.id === lastHandledJumpId) return;
		if (req.conversationId !== conversation.id) return;
		lastHandledJumpId = req.id;
		jumpToMessageRequest.set(null);
		void jumpToMessage(req.messageId);
	});

	async function jumpToMessage(messageId: string) {
		try {
			const anchor = await getDirectMessageById(conversation.id, messageId);
			const [rawAbove, rawBelow] = await Promise.all([
				getDirectMessages(conversation.id, anchor.id),
				getDirectMessagesAfter(conversation.id, anchor.id),
			]);

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
			dmMessages.update((all) => ({ ...all, [conversation.id]: combined }));
			highlightedMessageId = messageId;
			setTimeout(() => {
				highlightedMessageId = null;
			}, 3000);
		} catch (err) {
			console.error("[DM] Failed to jump to message:", err);
		}
	}

	// What each message being sent was sent with besides its text (its files, reply, sticker, and the reply's mention,
	// or a voice note's audio), so that a retry sends it whole, as Chat's retryData does for a room's.
	const dmRetryData = new Map<
		string,
		{
			ref?: MessageReference;
			files?: File[];
			stickerAttachmentId?: string;
			allowedMentions?: AllowedMentions;
			voiceNote?: Blob;
		}
	>();

	async function dmHandleSend(
		content: string,
		nonce: string,
		ref: MessageReference | undefined,
		files?: File[],
		stickerAttachmentId?: string,
		allowedMentions?: AllowedMentions,
	) {
		const user = get(currentUser);
		if (!user) return;
		const isoNow = new Date().toISOString();
		const allMsgs = get(dmMessages)[conversation.id] ?? [];
		const refMsg = ref?.message_id ? allMsgs.find((m) => m.id === ref.message_id) : null;
		const pending: DirectMessage = {
			id: nonce,
			conversation_id: conversation.id,
			author_id: user.id,
			content,
			type: 0,
			created_at: isoNow,
			updated_at: isoNow,
			nonce,
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
		dmMessages.update((all) => ({ ...all, [conversation.id]: [...(all[conversation.id] ?? []), pending] }));
		dmRetryData.set(nonce, { ref, files, stickerAttachmentId, allowedMentions });
		const real = await sendDirectMessage(
			conversation.id,
			content,
			nonce,
			ref,
			files,
			undefined,
			stickerAttachmentId,
			allowedMentions,
		);
		showSent(nonce, real);
	}

	// What follows a send of this window's that the API took: its retry data goes, and the API's copy takes the place of
	// its pending one, by its nonce, as DM_MESSAGE_CREATE's does. That event can be missed, and the message would stay
	// pending.
	function showSent(nonce: string, real: DirectMessage) {
		dmRetryData.delete(nonce);
		dmMessages.update((all) => {
			const existing = all[conversation.id] ?? [];
			const shown = withSentMessage(existing, nonce, real);
			return shown === existing ? all : { ...all, [conversation.id]: shown };
		});
	}

	async function dmSaveEdit(messageId: string, content: string) {
		const updated = await updateDirectMessage(conversation.id, messageId, content);
		dmMessages.update((all) => {
			const existing = all[conversation.id] ?? [];
			return { ...all, [conversation.id]: existing.map((m) => (m.id === messageId ? { ...m, ...updated } : m)) };
		});
	}

	async function dmDelete(messageId: string) {
		await deleteDirectMessage(conversation.id, messageId);
		dmMessages.update((all) => ({
			...all,
			[conversation.id]: (all[conversation.id] ?? []).filter((m) => m.id !== messageId),
		}));
	}

	function dmRetry(message: Message) {
		const nonce = message.nonce!;
		const saved = dmRetryData.get(nonce);
		failedNonces = new Set([...failedNonces].filter((n) => n !== nonce));
		// A voice note goes again as one: its audio, not its empty text.
		if (saved?.voiceNote) {
			sendDMVoiceNote(conversation.id, saved.voiceNote, nonce)
				.then((real) => showSent(nonce, real))
				.catch((err) => {
					failedNonces = new Set(failedNonces).add(nonce);
					toast(getApiError(err, "Failed to send voice note"), "error");
				});
			return;
		}
		sendDirectMessage(
			conversation.id,
			message.content ?? "",
			nonce,
			saved?.ref,
			saved?.files,
			undefined,
			saved?.stickerAttachmentId,
			saved?.allowedMentions,
		)
			.then((real) => showSent(nonce, real))
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

		const isoNow = new Date().toISOString();
		const pending: DirectMessage = {
			id: nonce,
			conversation_id: conversation.id,
			author_id: user.id,
			content: "",
			type: MessageType.Voice,
			created_at: isoNow,
			updated_at: isoNow,
			nonce,
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
		dmMessages.update((all) => ({ ...all, [conversation.id]: [...(all[conversation.id] ?? []), pending] }));

		dmRetryData.set(nonce, { voiceNote: blob });
		sendDMVoiceNote(conversation.id, blob, nonce)
			.then((real) => showSent(nonce, real))
			.catch((err) => {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send voice note"), "error");
			});
	}

	async function handleRemoveMember(userId: string) {
		await removeConversationMember(conversation.id, userId);
	}

	function startCall() {
		const user = get(currentUser);
		if (!user || get(activeCall) || joinWaits) return;
		const memberIds = conversation.members.map((m) => m.user_id);
		placeCall(conversation.id, memberIds);
		activeCall.set({
			conversationId: conversation.id,
			initiatorId: user.id,
			initiatorName: user.alias ?? user.username ?? "You",
			initiatorAvatar: user.avatar ?? null,
			state: "calling",
			memberIds,
		});
		conversationsWithCalls.update((s) => {
			s.add(conversation.id);
			return new Set(s);
		});
	}

	// ACK helper — sends an ack for the newest confirmed DM if at bottom.
	function tryAckConversation() {
		const msgs = get(dmMessages)[conversation.id] ?? [];
		if (!isAtBottom || isLoading || !get(pageVisible) || msgs.length === 0) return;
		// Clear the unread divider
		if (convUnreadAfter != null) convUnreadAfter = null;
		let newestId = "";
		for (const m of msgs) {
			if (m.id === m.nonce) continue;
			if (m.id > newestId) newestId = m.id;
		}
		if (newestId && newestId !== ackedConvMsgId.get(conversation.id)) {
			ackedConvMsgId.set(conversation.id, newestId);
			unreadConversations.update((s) => {
				s.delete(conversation.id);
				return s;
			});
			mentionCounts.update((all) => {
				const copy = { ...all };
				delete copy[conversation.id];
				return copy;
			});
			ackConversation(conversation.id, newestId).catch(() => {});
		}
	}

	// ACK reactively when at bottom, page visible, and messages change.
	$effect(() => {
		const msgs = $dmMessages[conversation.id] ?? [];
		const atBottom = isAtBottom;
		const visible = $pageVisible;
		if (!atBottom || !visible || isLoading || msgs.length === 0) return;
		if (convUnreadAfter != null) convUnreadAfter = null;
		let newestId = "";
		for (const m of msgs) {
			if (m.id === m.nonce) continue;
			if (m.id > newestId) newestId = m.id;
		}
		if (newestId && newestId !== ackedConvMsgId.get(conversation.id)) {
			ackedConvMsgId.set(conversation.id, newestId);
			unreadConversations.update((s) => {
				s.delete(conversation.id);
				return s;
			});
			mentionCounts.update((all) => {
				const copy = { ...all };
				delete copy[conversation.id];
				return copy;
			});
			ackConversation(conversation.id, newestId).catch(() => {});
		}
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

	// ACK when leaving the conversation — only if at bottom.
	$effect(() => {
		const convId = conversation.id;
		return () => {
			if (!isAtBottom) return;
			const msgs = get(dmMessages)[convId] ?? [];
			if (msgs.length === 0) return;
			let newestId = "";
			for (const m of msgs) {
				if (m.id === m.nonce) continue;
				if (m.id > newestId) newestId = m.id;
			}
			if (newestId && newestId !== ackedConvMsgId.get(convId)) {
				ackedConvMsgId.set(convId, newestId);
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
		};
	});

	onMount(() => {
		activeDMConvId.set(conversation.id);
		unreadConversations.update((s) => {
			s.delete(conversation.id);
			return s;
		});
		loadMessages().then(() => {
			isLoading = false;
		});
		return () => {
			activeDMConvId.update((cur) => (cur === conversation.id ? null : cur));
		};
	});
</script>

<div
	class="relative flex flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,oklch(0.22_0.01_80),oklch(0.19_0.008_80))]"
>
	<!-- Header -->
	<div
		class="flex h-10 shrink-0 items-center gap-2 border-b border-stone-800 bg-stone-950/45 px-3 font-semibold text-stone-100"
	>
		<MessageSquare class="size-4 text-zinc-400" />
		<span>{conversationTitle()}</span>
		{#if conversation.type === 2}
			<span class="ml-1 text-xs text-zinc-500">{conversation.members.length} members</span>
		{/if}
		<div class="ml-auto flex items-center gap-1">
			<button
				class="flex items-center gap-1 rounded px-2 py-1 text-xs font-normal text-zinc-400 hover:bg-stone-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
				onclick={startCall}
				disabled={!!$activeCall || joinWaits}
				title="Start call"
			>
				<Phone class="size-3.5" />
			</button>
			{#if conversation.type === 2 && isOwner}
				<button
					class="flex items-center gap-1 rounded px-2 py-1 text-xs font-normal text-zinc-400 hover:bg-stone-800 hover:text-zinc-200"
					onclick={openAddMemberModal}
					title="Add member"
				>
					<UserPlus class="size-3.5" />
					Add
				</button>
			{/if}
			<button
				class="flex items-center gap-1 rounded px-2 py-1 text-xs font-normal {showMemberList
					? 'bg-stone-800 text-zinc-200'
					: 'text-zinc-400 hover:bg-stone-800 hover:text-zinc-200'}"
				onclick={() => {
					showMemberList = !showMemberList;
				}}
				title="Members"
			>
				<Users class="size-3.5" />
			</button>
			{#key conversation.id}
				<PinnedMessages channelId={conversation.id} conversation members={convMembers} toDirectMessage={toMessage} />
				<div class="ml-2">
					<MessageSearch conversationId={conversation.id} members={convMembers} toDirectMessage={toMessage} />
				</div>
			{/key}
		</div>
	</div>

	<!-- Call in progress banner (visible when not in the call), with who is in it -->
	{#snippet inCallAvatars()}
		{#if inCallNow.length > 0}
			<span class="flex items-center -space-x-1.5" title={inCallNow.map((m) => m.username).join(", ")}>
				{#each inCallNow.slice(0, 4) as member (member.id)}
					<UserAvatar src={member.avatar_url} name={member.username} size={20} class="ring-2 ring-stone-900" />
				{/each}
			</span>
			{#if inCallNow.length > 4}
				<span class="text-xs text-emerald-400">+{inCallNow.length - 4}</span>
			{/if}
		{/if}
	{/snippet}
	{#if canJoinCall && joinWaits}
		<div
			class="flex shrink-0 items-center justify-center gap-2 border-b border-emerald-800/50 bg-emerald-900/30 px-4 py-2 text-sm text-emerald-300"
		>
			<Phone class="size-4" />
			<span class="font-medium">Calling from another device</span>
			{@render inCallAvatars()}
		</div>
	{:else if canJoinCall}
		<button
			class="flex shrink-0 items-center justify-center gap-2 border-b border-emerald-800/50 bg-emerald-900/30 px-4 py-2 text-sm text-emerald-300 transition-colors hover:bg-emerald-900/50"
			onclick={joinCall}
		>
			<Phone class="size-4" />
			<span class="font-medium">Call in progress — Join</span>
			{@render inCallAvatars()}
		</button>
	{/if}

	<!-- Active call view: a flex column, so the tiles scroll within its half and the controls stay in sight -->
	{#if isInCall}
		<div class="flex max-h-[50%] shrink-0 flex-col overflow-hidden border-b border-zinc-800">
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
			showHeader={false}
			{messages}
			channelId={conversation.id}
			channelName={conversationTitle()}
			placeholder={`Message ${conversationTitle()}`}
			isInitialLoading={isLoading}
			{isLoadingMore}
			hasMoreMessages={hasMore}
			hasMoreMessagesBelow={hasMoreBelow}
			{highlightedMessageId}
			onLoadMore={handleLoadMore}
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
			class="flex w-80 flex-col gap-3 rounded-lg border border-stone-700 bg-stone-900 p-6"
			role="dialog"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
		>
			<h3 class="text-sm font-semibold text-stone-100">Add member</h3>
			{#if eligibleFriends.length === 0}
				<p class="py-4 text-center text-xs text-zinc-500">No friends available to add</p>
			{:else}
				<div class="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
					{#each eligibleFriends as friend (friend.id)}
						{@const uid = getFriendOtherId(friend)}
						<button
							class="flex items-center gap-2 rounded px-3 py-2 text-left hover:bg-stone-800 disabled:opacity-50"
							onclick={() => handleAddMember(uid)}
							disabled={addMemberLoading}
						>
							<UserAvatar
								src={getAvatarURL(getFriendOtherId(friend), friend.user_avatar)}
								name={friend.user_alias ?? friend.user_username}
								size={32}
							/>
							<div class="flex min-w-0 flex-col">
								<span class="text-sm text-stone-200">{friend.user_alias ?? friend.user_username}</span>
								<span class="text-xs text-zinc-500">@{friend.user_username}</span>
							</div>
						</button>
					{/each}
				</div>
			{/if}
			{#if addMemberError}
				<p class="rounded bg-red-900/20 px-3 py-2 text-xs text-red-400">{addMemberError}</p>
			{/if}
			<button
				class="self-end text-xs text-zinc-500 hover:text-zinc-300"
				onclick={() => {
					showAddMemberModal = false;
				}}
			>
				Cancel
			</button>
		</div>
	</div>
{/if}
