<script lang="ts">
	import { onMount } from "svelte";
	import { getApiError } from "$lib/api/api";
	import { get } from "svelte/store";
	import { currentUser, pendingFriendRequests, sentFriendRequests, friends, conversations } from "$lib/stores.svelte";
	import {
		sendFriendRequest,
		getPendingRequests,
		getSentRequests,
		acceptFriendRequest,
		rejectFriendRequest,
		getFriends,
		unfriend,
		type FriendRequest,
		type Friend,
	} from "$lib/api/friends";
	import { getConversations, createDM, createGroup, type Conversation } from "$lib/api/conversations";
	import { UserPlus, UserCheck, UserX, Users, Clock, Send, MessageSquare, Check, ChevronLeft } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import ConversationView from "$lib/components/ConversationView.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { getUserOnlineStatus, rememberFriendStatuses } from "$lib/api/ws/connection";
	import { userStatusToString, type MemberOnSidebar } from "$lib/types";

	let {
		activeConversationId = $bindable<string | null>(null),
		showGroupModal = $bindable(false),
	}: {
		activeConversationId?: string | null;
		showGroupModal?: boolean;
	} = $props();

	type Tab = "friends" | "pending" | "sent" | "add";
	let activeTab = $state<Tab>("friends");
	const activeConversation = $derived($conversations.find((c) => c.id === activeConversationId) ?? null);

	let addUserId = $state("");
	let addError = $state("");
	let addSuccess = $state("");
	let loading = $state(false);

	// Group creation state
	let groupName = $state("");
	let selectedFriendIds = $state(new Set<string>());
	let groupError = $state("");

	function toggleFriend(uid: string) {
		const next = new Set(selectedFriendIds);
		if (next.has(uid)) next.delete(uid);
		else next.add(uid);
		selectedFriendIds = next;
	}

	function closeGroupModal() {
		showGroupModal = false;
		groupName = "";
		selectedFriendIds = new Set();
		groupError = "";
	}

	onMount(async () => {
		try {
			let pending = get(pendingFriendRequests);
			let sent = get(sentFriendRequests);
			let friendList = get(friends);
			let convList = get(conversations);

			// Only fetch if the WS READY handler hasn't populated the stores yet
			const needsFetch = pending.length === 0 && sent.length === 0 && friendList.length === 0 && convList.length === 0;
			if (needsFetch) {
				[pending, sent, friendList, convList] = await Promise.all([
					getPendingRequests(),
					getSentRequests(),
					getFriends(),
					getConversations(),
				]);
				pendingFriendRequests.set(pending);
				sentFriendRequests.set(sent);
				rememberFriendStatuses(friendList);
				friends.set(friendList);
				conversations.set(convList);
			}
		} catch (err) {
			console.error("[Friends] Failed to load:", err);
		}
	});

	async function handleSendRequest() {
		addError = "";
		addSuccess = "";
		if (!addUserId.trim()) {
			addError = "Enter a user ID";
			return;
		}
		loading = true;
		try {
			await sendFriendRequest(addUserId.trim());
			addSuccess = "Friend request sent!";
			addUserId = "";
			const sent = await getSentRequests();
			sentFriendRequests.set(sent);
		} catch (err) {
			addError = getApiError(err, "Failed to send request");
		} finally {
			loading = false;
		}
	}

	async function handleAccept(request: FriendRequest) {
		try {
			const friend = await acceptFriendRequest(request.id);
			pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
			rememberFriendStatuses([friend]);
			friends.update((list) => {
				if (list.some((f) => f.id === friend.id)) return list;
				return [...list, friend];
			});
		} catch (err) {
			console.error("[Friends] Accept failed:", err);
		}
	}

	async function handleReject(request: FriendRequest) {
		try {
			await rejectFriendRequest(request.id);
			pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
		} catch (err) {
			console.error("[Friends] Reject failed:", err);
		}
	}

	async function handleCancelSent(request: FriendRequest) {
		try {
			await rejectFriendRequest(request.id);
			sentFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
		} catch (err) {
			console.error("[Friends] Cancel failed:", err);
		}
	}

	async function handleUnfriend(friend: Friend) {
		const me = get(currentUser);
		if (!me) return;
		const otherUserId = friend.sender_id === me.id ? friend.recipient_id : friend.sender_id;
		try {
			await unfriend(otherUserId);
			friends.update((list) => list.filter((f) => f.id !== friend.id));
		} catch (err) {
			console.error("[Friends] Unfriend failed:", err);
		}
	}

	function getFriendUserId(friend: Friend): string {
		const me = get(currentUser);
		if (!me) return "";
		return friend.sender_id === me.id ? friend.recipient_id : friend.sender_id;
	}

	// A friend's status, offline included, as the DM list shows it: friends hear each other's, with or without a space
	// in common.
	function friendStatus(friend: Friend): MemberOnSidebar["status"] {
		return userStatusToString(getUserOnlineStatus(getFriendUserId(friend)));
	}

	async function handleOpenDM(friend: Friend) {
		const me = get(currentUser);
		if (!me) return;
		const otherUserId = getFriendUserId(friend);
		try {
			const conv = await createDM(otherUserId);
			conversations.update((list) => {
				if (list.some((c) => c.id === conv.id)) return list;
				return [conv, ...list];
			});
			activeConversationId = conv.id;
		} catch (err) {
			console.error("[DM] Failed to open DM:", err);
		}
	}

	async function handleCreateGroup() {
		groupError = "";
		if (!groupName.trim()) {
			groupError = "Enter a group name";
			return;
		}
		if (selectedFriendIds.size === 0) {
			groupError = "Add at least one friend to the group";
			return;
		}
		try {
			const conv = await createGroup(groupName.trim(), [...selectedFriendIds]);
			conversations.update((list) => {
				if (list.some((c) => c.id === conv.id)) return list;
				return [conv, ...list];
			});
			closeGroupModal();
			activeConversationId = conv.id;
		} catch (err) {
			groupError = getApiError(err, "Failed to create group");
		}
	}

	function convTitle(conv: Conversation): string {
		const me = get(currentUser);
		if (conv.type === 2) return conv.name ?? "Group";
		const other = conv.members.find((m) => m.user_id !== me?.id);
		return other?.user?.alias ?? other?.user?.username ?? "DM";
	}

	function convSubtitle(conv: Conversation): string {
		if (conv.type === 2) return `${conv.members.length} members`;
		return "Direct message";
	}
</script>

<div class="flex h-full flex-col bg-(--bg-primary,#1e1f22) text-(--text-primary,#dbdee1)">
	{#if activeConversation}
		<div class="flex h-full flex-col overflow-hidden">
			<div class="flex h-8 shrink-0 items-center border-b border-stone-800 bg-stone-950/45 px-2">
				<button
					class="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-stone-800 hover:text-zinc-200"
					onclick={() => {
						activeConversationId = null;
					}}
				>
					<ChevronLeft class="size-3.5" />
					Friends
				</button>
			</div>
			{#key activeConversationId}
				<ConversationView
					conversation={activeConversation}
					onMemberAdded={(m) => {
						if (!activeConversationId) return;
						conversations.update((list) =>
							list.map((c) => {
								if (c.id !== activeConversationId) return c;
								if (c.members.some((x) => x.id === m.id || x.user_id === m.user_id)) return c;
								return { ...c, members: [...c.members, m] };
							}),
						);
					}}
				/>
			{/key}
		</div>
	{:else}
		<div class="border-b border-[#3f4147] px-5 pt-4">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="m-0 mb-3 text-base font-semibold">Friends</h2>
			</div>
			<div class="flex gap-1">
				<button
					class="flex cursor-pointer items-center gap-1.5 rounded-t border-b-2 border-transparent bg-none px-3 py-1.5 text-[13px] transition-colors duration-150 {activeTab ===
					'friends'
						? 'border-b-[#5865f2] bg-(--bg-secondary,#2b2d31) text-(--text-primary,#dbdee1)'
						: 'text-(--text-secondary,#949ba4) hover:bg-(--bg-hover,#35373c) hover:text-(--text-primary,#dbdee1)'}"
					onclick={() => (activeTab = "friends")}
				>
					<Users size={14} />
					Friends
					{#if $friends.length > 0}
						<span class="rounded-10px bg-(--bg-tertiary,#35373c) px-1.5 py-px text-[11px] font-semibold"
							>{$friends.length}</span
						>
					{/if}
				</button>
				<button
					class="flex cursor-pointer items-center gap-1.5 rounded-t border-b-2 border-transparent bg-none px-3 py-1.5 text-[13px] transition-colors duration-150 {activeTab ===
					'pending'
						? 'border-b-[#5865f2] bg-(--bg-secondary,#2b2d31) text-(--text-primary,#dbdee1)'
						: 'text-(--text-secondary,#949ba4) hover:bg-(--bg-hover,#35373c) hover:text-(--text-primary,#dbdee1)'}"
					onclick={() => (activeTab = "pending")}
				>
					<Clock size={14} />
					Pending
					{#if $pendingFriendRequests.length > 0}
						<span class="rounded-10px bg-[#da3633] px-1.5 py-px text-[11px] font-semibold text-white"
							>{$pendingFriendRequests.length}</span
						>
					{/if}
				</button>
				<button
					class="flex cursor-pointer items-center gap-1.5 rounded-t border-b-2 border-transparent bg-none px-3 py-1.5 text-[13px] transition-colors duration-150 {activeTab ===
					'sent'
						? 'border-b-[#5865f2] bg-(--bg-secondary,#2b2d31) text-(--text-primary,#dbdee1)'
						: 'text-(--text-secondary,#949ba4) hover:bg-(--bg-hover,#35373c) hover:text-(--text-primary,#dbdee1)'}"
					onclick={() => (activeTab = "sent")}
				>
					<Send size={14} />
					Sent
				</button>
				<button
					class="flex cursor-pointer items-center gap-1.5 rounded-t border-b-2 border-transparent bg-none px-3 py-1.5 text-[13px] transition-colors duration-150 {activeTab ===
					'add'
						? 'border-b-[#23a55a] bg-(--bg-secondary,#2b2d31) text-[#23a55a]'
						: 'text-(--text-secondary,#949ba4) hover:bg-(--bg-hover,#35373c) hover:text-(--text-primary,#dbdee1)'}"
					onclick={() => (activeTab = "add")}
				>
					<UserPlus size={14} />
					Add
				</button>
			</div>
		</div>

		<div class="flex-1 overflow-y-auto py-3">
			{#if activeTab === "friends"}
				{#if $friends.length === 0}
					<div class="flex flex-col items-center justify-center gap-3 px-5 py-15 text-(--text-secondary,#949ba4)">
						<Users size={40} />
						<p>No friends yet</p>
					</div>
				{:else}
					<ul class="m-0 list-none px-2">
						{#each $friends as friend (friend.id)}
							{@const friendId = getFriendUserId(friend)}
							{@const status = friendStatus(friend)}
							<li
								class="flex items-center gap-3 rounded-md px-3 py-2 transition-[background] duration-100 hover:bg-(--bg-hover,#35373c)"
							>
								<div class="relative shrink-0">
									<UserAvatar
										src={getAvatarURL(getFriendUserId(friend), friend.user_avatar)}
										name={friend.user_alias ?? friend.user_username}
										size={36}
									/>
									<StatusDot
										{status}
										class="absolute -right-0.5 -bottom-0.5 size-3 border-2 border-(--bg-primary,#1e1f22)"
									/>
								</div>
								<div class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap"
										>{friend.user_alias ?? friend.user_username}</span
									>
									<span class="text-[11px] text-(--text-secondary,#949ba4)">@{friend.user_username}</span>
								</div>
								<div class="flex gap-1.5">
									<button
										class="flex size-7 cursor-pointer items-center justify-center rounded-full border-none bg-(--bg-tertiary,#35373c) text-(--text-secondary,#949ba4) transition-colors duration-100 hover:bg-(--bg-tertiary,#35373c) hover:text-(--text-primary,#dbdee1)"
										title="Direct message"
										onclick={() => handleOpenDM(friend)}
									>
										<MessageSquare size={14} />
									</button>
									<button
										class="flex size-7 cursor-pointer items-center justify-center rounded-full border-none bg-(--bg-tertiary,#35373c) text-[#da3633] transition-colors duration-100 hover:bg-[#da3633] hover:text-white"
										title="Remove friend"
										onclick={() => handleUnfriend(friend)}
									>
										<UserX size={14} />
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if activeTab === "pending"}
				{#if $pendingFriendRequests.length === 0}
					<div class="flex flex-col items-center justify-center gap-3 px-5 py-15 text-(--text-secondary,#949ba4)">
						<Clock size={40} />
						<p>No pending requests</p>
					</div>
				{:else}
					<ul class="m-0 list-none px-2">
						{#each $pendingFriendRequests as req (req.id)}
							<li
								class="flex items-center gap-3 rounded-md px-3 py-2 transition-[background] duration-100 hover:bg-(--bg-hover,#35373c)"
							>
								<UserAvatar
									src={getAvatarURL(req.sender_id, req.user_avatar)}
									name={req.user_alias ?? req.user_username}
									size={36}
								/>
								<div class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap"
										>{req.user_alias ?? req.user_username}</span
									>
									<span class="text-[11px] text-(--text-secondary,#949ba4)"
										>@{req.user_username} · {new Date(req.created_at).toLocaleDateString()}</span
									>
								</div>
								<div class="flex gap-1.5">
									<button
										class="flex size-7 cursor-pointer items-center justify-center rounded-full border-none bg-(--bg-tertiary,#35373c) text-[#23a55a] transition-colors duration-100 hover:bg-[#23a55a] hover:text-white"
										title="Accept"
										onclick={() => handleAccept(req)}
									>
										<UserCheck size={14} />
									</button>
									<button
										class="flex size-7 cursor-pointer items-center justify-center rounded-full border-none bg-(--bg-tertiary,#35373c) text-[#da3633] transition-colors duration-100 hover:bg-[#da3633] hover:text-white"
										title="Decline"
										onclick={() => handleReject(req)}
									>
										<UserX size={14} />
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if activeTab === "sent"}
				{#if $sentFriendRequests.length === 0}
					<div class="flex flex-col items-center justify-center gap-3 px-5 py-15 text-(--text-secondary,#949ba4)">
						<Send size={40} />
						<p>No sent requests</p>
					</div>
				{:else}
					<ul class="m-0 list-none px-2">
						{#each $sentFriendRequests as req (req.id)}
							<li
								class="flex items-center gap-3 rounded-md px-3 py-2 transition-[background] duration-100 hover:bg-(--bg-hover,#35373c)"
							>
								<UserAvatar
									src={getAvatarURL(req.recipient_id, req.user_avatar)}
									name={req.user_alias ?? req.user_username}
									size={36}
								/>
								<div class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap"
										>{req.user_alias ?? req.user_username}</span
									>
									<span class="text-[11px] text-(--text-secondary,#949ba4)"
										>@{req.user_username} · {new Date(req.created_at).toLocaleDateString()}</span
									>
								</div>
								<div class="flex gap-1.5">
									<button
										class="flex size-7 cursor-pointer items-center justify-center rounded-full border-none bg-(--bg-tertiary,#35373c) text-[#da3633] transition-colors duration-100 hover:bg-[#da3633] hover:text-white"
										title="Cancel request"
										onclick={() => handleCancelSent(req)}
									>
										<UserX size={14} />
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if activeTab === "add"}
				<div class="p-5">
					<p class="m-0 mb-4 text-[13px] text-(--text-secondary,#949ba4)">Send a friend request using a user ID.</p>
					<div class="flex gap-2">
						<input
							class="flex-1 rounded border border-[#3f4147] bg-(--bg-tertiary,#1e1f22) px-3 py-2 text-sm text-(--text-primary,#dbdee1) outline-none focus:border-[#5865f2]"
							type="text"
							placeholder="User ID"
							bind:value={addUserId}
							onkeydown={(e) => e.key === "Enter" && handleSendRequest()}
						/>
						<button
							class="flex cursor-pointer items-center gap-1.5 rounded border-none bg-[#5865f2] px-4 py-2 text-[13px] font-medium whitespace-nowrap text-white hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-60"
							onclick={handleSendRequest}
							disabled={loading}
						>
							{#if loading}
								Sending…
							{:else}
								<UserPlus size={14} />
								Send request
							{/if}
						</button>
					</div>
					{#if addError}
						<p class="mt-2.5 rounded bg-[rgba(218,54,51,0.15)] px-3 py-2 text-[13px] text-[#da3633]">{addError}</p>
					{/if}
					{#if addSuccess}
						<p class="mt-2.5 rounded bg-[rgba(35,165,90,0.15)] px-3 py-2 text-[13px] text-[#23a55a]">{addSuccess}</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if showGroupModal}
	<div
		class="fixed inset-0 z-100 flex items-center justify-center bg-black/60"
		onclick={closeGroupModal}
		role="button"
		tabindex="-1"
		onkeydown={() => {}}
	>
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="flex w-100 max-w-[90vw] flex-col gap-3 rounded-lg border border-[#3f4147] bg-(--bg-primary,#1e1f22) p-6"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			onkeydown={() => {}}
		>
			<h3 class="m-0 text-base font-semibold">Create private group</h3>
			<div class="flex flex-col gap-1.5">
				<label for="group-name" class="text-xs font-medium tracking-wider text-(--text-secondary,#949ba4) uppercase"
					>Group name</label
				>
				<input
					id="group-name"
					class="flex-1 rounded border border-[#3f4147] bg-(--bg-tertiary,#1e1f22) px-3 py-2 text-sm text-(--text-primary,#dbdee1) outline-none focus:border-[#5865f2]"
					type="text"
					placeholder="e.g. Best friends"
					bind:value={groupName}
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="text-xs font-medium tracking-wider text-(--text-secondary,#949ba4) uppercase">
					Add friends
					{#if selectedFriendIds.size > 0}
						<span class="ml-1.5 font-semibold tracking-normal text-[#5865f2] normal-case"
							>{selectedFriendIds.size} selected</span
						>
					{/if}
				</label>
				<div class="max-h-50 overflow-y-auto rounded border border-[#3f4147] bg-(--bg-tertiary,#1e1f22)">
					{#if $friends.length === 0}
						<p class="m-0 p-4 text-center text-[13px] text-(--text-secondary,#949ba4)">No friends added yet</p>
					{:else}
						{#each $friends as f}
							{@const uid = getFriendUserId(f)}
							{@const selected = selectedFriendIds.has(uid)}
							<button
								type="button"
								class="flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent px-3 py-2 text-left text-(--text-primary,#dbdee1) transition-[background] duration-100 hover:bg-(--bg-hover,#35373c) {selected
									? 'bg-[rgba(88,101,242,0.12)]'
									: ''}"
								onclick={() => toggleFriend(uid)}
							>
								<UserAvatar
									src={getAvatarURL(getFriendUserId(f), f.user_avatar)}
									name={f.user_alias ?? f.user_username}
									size={32}
								/>
								<span class="flex-1 overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap"
									>{f.user_alias ?? f.user_username}</span
								>
								{#if selected}
									<Check size={16} class="shrink-0 text-[#5865f2]" />
								{/if}
							</button>
						{/each}
					{/if}
				</div>
			</div>
			{#if groupError}
				<p class="mt-2.5 rounded bg-[rgba(218,54,51,0.15)] px-3 py-2 text-[13px] text-[#da3633]">{groupError}</p>
			{/if}
			<div class="flex justify-end gap-2">
				<button
					class="flex cursor-pointer items-center gap-1.5 rounded border-none bg-[#5865f2] px-4 py-2 text-[13px] font-medium whitespace-nowrap text-white hover:bg-[#4752c4]"
					onclick={handleCreateGroup}>Create group</button
				>
				<button
					class="cursor-pointer rounded border-none bg-(--bg-tertiary,#35373c) px-4 py-2 text-[13px] text-(--text-primary,#dbdee1) hover:bg-[#454850]"
					onclick={closeGroupModal}>Cancel</button
				>
			</div>
		</div>
	</div>
{/if}
