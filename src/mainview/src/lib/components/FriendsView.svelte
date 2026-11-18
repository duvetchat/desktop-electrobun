<script lang="ts">
	import { onMount } from "svelte";
	import { getApiError } from "$lib/api/api";
	import { get } from "svelte/store";
	import {
		currentUser,
		pendingFriendRequests,
		sentFriendRequests,
		friends,
		conversations,
		userActivities,
	} from "$lib/stores.svelte";
	import {
		sendFriendRequest,
		getPendingRequests,
		getSentRequests,
		rejectFriendRequest,
		getFriends,
		unfriend,
		type FriendRequest,
		type Friend,
	} from "$lib/api/friends";
	import { getConversations, createDM, createGroup } from "$lib/api/conversations";
	import {
		UserPlus,
		UserCheck,
		UserX,
		Users,
		Clock,
		Send,
		MessageSquare,
		Check,
		ChevronLeft,
		Gamepad2 as GameIcon,
		Music as MusicIcon,
		Search,
		X as XIcon,
	} from "@lucide/svelte";
	import MascotPeek from "$lib/components/MascotPeek.svelte";
	import { activityLine, shownActivities } from "$lib/activity";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import ConversationView from "$lib/components/ConversationView.svelte";
	import { buttonClass } from "$lib/components/ui/recipes";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import { ERROR_NOTE, FIELD_LABEL, fieldClass } from "$lib/overlay-forms";
	import MessageSearch from "$lib/components/MessageSearch.svelte";
	import type { MessageLink } from "$lib/urls";
	import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { acceptRequest, declineRequest } from "$lib/friend-requests";
	import {
		getUserMobileOnly,
		getUserOnlineStatus,
		rememberConversationStatuses,
		rememberFriendStatuses,
	} from "$lib/api/ws/connection";
	import { friendMember, friendUser } from "$lib/friends";
	import { newConversation } from "$lib/groups";
	import { userStatusToString, type MemberOnSidebar } from "$lib/types";

	let {
		activeConversationId = $bindable<string | null>(null),
		showGroupModal = $bindable(false),
		onOpenConversation,
		onOpenMessage,
	}: {
		activeConversationId?: string | null;
		showGroupModal?: boolean;
		/** Opens a conversation somewhere else (a tab in a pane); without it, it opens here. */
		onOpenConversation?: (conversationId: string) => void;
		/** Opens a message the bar's search found, a room's in a pane, which this view would hide. */
		onOpenMessage?: (link: MessageLink) => void;
	} = $props();

	function openConversation(id: string) {
		if (onOpenConversation) onOpenConversation(id);
		else activeConversationId = id;
	}

	type Tab = "friends" | "pending" | "sent" | "add";
	let activeTab = $state<Tab>("friends");
	// The lists in the bar's segmented control; adding a friend is the bar's own button. Requests waiting on the user
	// are counted in the accent. The call history, a list here until the redesign (#357), opens from the sidebar's
	// header.
	const tabs = $derived<{ id: Tab; label: string; count: number; alert?: boolean }[]>([
		{ id: "friends", label: "All", count: $friends.length },
		{ id: "pending", label: "Pending", count: $pendingFriendRequests.length, alert: true },
		{ id: "sent", label: "Sent", count: $sentFriendRequests.length },
	]);
	const focusRing =
		"focus-override focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-duvet-accent";

	// The friends, those matching the search, online first (idle and do not disturb are there too), with what each is
	// playing or listening to.
	let query = $state("");
	const friendGroups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const rows = $friends
			.map((friend) => ({
				friend,
				member: friendMember(
					friend,
					$currentUser?.id,
					friendStatus(friend),
					getUserMobileOnly(getFriendUserId(friend)),
				),
			}))
			.filter(
				({ member }) =>
					!q || member.username.toLowerCase().includes(q) || member.raw_username.toLowerCase().includes(q),
			)
			.map(({ friend, member }) => {
				const activity = shownActivities($userActivities[member.id])[0];
				return { friend, member, activity: activity ? activityLine(activity) : null };
			});
		const groups = [
			{ title: "Online", friends: rows.filter((r) => r.member.status !== "offline") },
			{ title: "Offline", friends: rows.filter((r) => r.member.status === "offline") },
		];
		return groups.some((g) => g.friends.length > 0) ? groups : [];
	});
	// The friends online now (idle and do not disturb are there too), for the line under the page's title.
	const onlineFriends = $derived($friends.filter((friend) => friendStatus(friend) !== "offline").length);
	const activeConversation = $derived($conversations.find((c) => c.id === activeConversationId) ?? null);
	// An open conversation that leaves the list (the user left its group, or was removed from it) closes, and stays
	// closed should it come back.
	$effect(() => {
		if (activeConversationId && !activeConversation) activeConversationId = null;
	});

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
		groupError = "";
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
				rememberConversationStatuses(convList);
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
			addSuccess = "Friend request sent";
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
			await acceptRequest(request);
		} catch (err) {
			console.error("[Friends] Accept failed:", err);
		}
	}

	async function handleReject(request: FriendRequest) {
		try {
			await declineRequest(request);
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

	// Removing a friend can't be undone from here: it asks first.
	function confirmUnfriend(friend: Friend) {
		const other = friendUser(friend, get(currentUser)?.id);
		void confirmAction(`Remove ${other.alias ?? other.username} from your friends?`, "Remove", () =>
			handleUnfriend(friend),
		);
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

	// The row whose profile card is open: a friend's, or a request's in Pending. Not in Sent, where the card would offer
	// to send the request again, which the API refuses while it waits.
	let profileOpenFor = $state<string | null>(null);

	// A friend's banner shows faintly behind their row, and one that fails to load is tried again, as in the member list.
	const MAX_BANNER_RETRIES = 3;
	const BANNER_RETRY_DELAY = 2000;
	let bannerErrors = $state(new Set<string>());
	let bannerRetryCounts = $state(new Map<string, number>());

	function handleBannerError(userId: string) {
		const count = (bannerRetryCounts.get(userId) ?? 0) + 1;
		bannerRetryCounts.set(userId, count);
		if (count < MAX_BANNER_RETRIES) {
			bannerErrors.add(userId);
			bannerErrors = new Set(bannerErrors);
			setTimeout(() => {
				bannerErrors.delete(userId);
				bannerErrors = new Set(bannerErrors);
			}, BANNER_RETRY_DELAY * count);
		} else {
			bannerErrors.add(userId);
			bannerErrors = new Set(bannerErrors);
		}
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
			openConversation(conv.id);
		} catch (err) {
			console.error("[DM] Failed to open DM:", err);
		}
	}

	async function handleCreateGroup() {
		groupError = "";
		const plan = newConversation(selectedFriendIds, groupName);
		if (plan.kind === "refused") {
			groupError = plan.why;
			return;
		}
		try {
			const conv = plan.kind === "dm" ? await createDM(plan.userId) : await createGroup(plan.name, plan.userIds);
			conversations.update((list) => {
				if (list.some((c) => c.id === conv.id)) return list;
				return [conv, ...list];
			});
			closeGroupModal();
			openConversation(conv.id);
		} catch (err) {
			groupError = getApiError(err, plan.kind === "dm" ? "Couldn't open the chat" : "Failed to create group");
		}
	}
</script>

{#snippet empty(
	mood: "awake" | "shy" | "peek",
	title: string,
	line: string,
	action?: { label: string; run: () => void },
)}
	<div class="flex flex-col items-center px-6 py-16 text-center">
		<MascotPeek class="w-24" {mood} />
		<p class="text-duvet-ink mt-4 text-base font-bold">{title}</p>
		<p class="text-duvet-ink2 mt-1 max-w-80 text-sm">{line}</p>
		{#if action}
			<button
				type="button"
				class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised mt-5 flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-bold transition hover:brightness-110 motion-reduce:transition-none {focusRing}"
				onclick={action.run}
			>
				<UserPlus class="size-4" />
				{action.label}
			</button>
		{/if}
	</div>
{/snippet}

{#snippet person(id: string, avatar: string | null, name: string, username: string, status?: MemberOnSidebar["status"])}
	<div class="relative shrink-0">
		<UserAvatar src={getAvatarURL(id, avatar)} {name} size={40} />
		{#if status}
			<StatusDot {status} class="text-duvet-bg absolute -right-0.5 -bottom-0.5 w-3.5 border-[3px]" />
		{/if}
	</div>
	<div class="flex min-w-0 flex-1 flex-col leading-tight">
		<span class="text-duvet-ink truncate text-sm font-bold">{name}</span>
		<span class="text-duvet-ink2 truncate text-xs">@{username}</span>
	</div>
{/snippet}

<div class="bg-duvet-bg text-duvet-ink flex h-full flex-col">
	{#if activeConversation}
		<div class="flex h-full flex-col overflow-hidden">
			<div class="border-duvet-line flex h-9 shrink-0 items-center border-b px-2">
				<button
					class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors motion-reduce:transition-none {focusRing}"
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
		<!-- The bar, as a pane's header (S-11, S-34): the title with how many friends are online, the lists as a segmented
		     control, the search everywhere, as the mobile app has on its home, and adding a friend. -->
		<div class="border-duvet-line flex h-[52px] shrink-0 items-center gap-3 border-b pr-2.5 pl-3">
			<div class="flex shrink-0 items-center gap-2.5">
				<span
					class="bg-duvet-secondary-fill text-duvet-accent-text grid size-7 shrink-0 place-items-center rounded-full"
				>
					<Users class="size-4" />
				</span>
				<div class="flex flex-col">
					<h2 class="text-duvet-ink font-serif text-[16.5px] leading-[1.15] font-medium tracking-[-0.012em]">
						Friends
					</h2>
					<span class="text-duvet-ink2 text-[11.5px] leading-[1.3]">{onlineFriends} online</span>
				</div>
			</div>
			<div
				class="bg-duvet-seg-track flex shrink-0 items-center rounded-[11px] p-[3px]"
				role="tablist"
				aria-label="Friends"
			>
				{#each tabs as tab (tab.id)}
					{@const chosen = activeTab === tab.id}
					<button
						type="button"
						role="tab"
						aria-selected={chosen}
						class="flex h-7 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors duration-[120ms] motion-reduce:transition-none {focusRing} {chosen
							? 'bg-duvet-seg-thumb text-duvet-ink shadow-duvet-control'
							: 'text-duvet-ink2 hover:text-duvet-ink'}"
						onclick={() => (activeTab = tab.id)}
					>
						{tab.label}
						{#if tab.count}
							<span
								class="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10.5px] font-bold tabular-nums {tab.alert
									? 'bg-duvet-accent text-duvet-on-accent'
									: 'bg-duvet-secondary-fill text-duvet-ink2'}">{tab.count}</span
							>
						{/if}
					</button>
				{/each}
			</div>
			<span class="flex-1"></span>
			<MessageSearch everywhere onJump={onOpenMessage} />
			<button
				type="button"
				class="{buttonClass(activeTab === 'add' ? 'secondary' : 'primary')} {focusRing}"
				aria-pressed={activeTab === "add"}
				onclick={() => (activeTab = "add")}
			>
				<UserPlus class="size-4" />
				Add friend
			</button>
		</div>

		<div class="flex-1 overflow-y-auto">
			<div class="mx-auto w-full max-w-3xl px-4 py-4">
				{#if activeTab === "friends"}
					{#if $friends.length === 0}
						{@render empty(
							"awake",
							"No friends yet",
							"Add someone with their user ID, and they'll show here once they accept.",
							{
								label: "Add a friend",
								run: () => (activeTab = "add"),
							},
						)}
					{:else}
						<label
							class="bg-duvet-sunk shadow-duvet-press text-duvet-ink2 focus-within:outline-duvet-accent mb-4 flex h-10 items-center gap-2.5 rounded-xl px-3 focus-within:outline-2"
						>
							<Search class="size-4 shrink-0" />
							<input
								type="text"
								class="focus-override text-duvet-ink placeholder:text-duvet-ink2 min-w-0 flex-1 bg-transparent text-sm outline-none"
								placeholder="Search your friends"
								aria-label="Search your friends"
								bind:value={query}
							/>
						</label>
						{#each friendGroups as group (group.title)}
							{#if group.friends.length > 0}
								<h3 class="text-duvet-ink2 mx-2 mt-2 mb-1 text-[13px] font-bold">
									{group.title} <span class="tabular-nums">{group.friends.length}</span>
								</h3>
								<ul class="mb-3 flex flex-col gap-px">
									{#each group.friends as { friend, member, activity } (friend.id)}
										<li
											class="group rounded-row hover:bg-duvet-card/70 relative flex items-center gap-3 overflow-hidden px-2 py-2 transition-colors motion-reduce:transition-none"
										>
											{#if member.banner_url && !bannerErrors.has(member.id)}
												<img
													src="{member.banner_url}{bannerRetryCounts.get(member.id)
														? `?r=${bannerRetryCounts.get(member.id)}`
														: ''}"
													alt=""
													class="pointer-events-none absolute inset-0 h-full w-full [mask-image:linear-gradient(to_right,transparent_40%,black_90%)] object-cover object-right {member.status ===
													'offline'
														? 'opacity-15'
														: 'opacity-25'}"
													onerror={() => handleBannerError(member.id)}
													draggable="false"
												/>
											{/if}
											<MemberProfilePopover
												{member}
												side="bottom"
												open={profileOpenFor === friend.id}
												onOpenChange={(o) => (profileOpenFor = o ? friend.id : null)}
												triggerClass="rounded-row relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left {focusRing}"
											>
												{#snippet children()}
													<div class="relative shrink-0">
														<UserAvatar src={member.avatar_url} name={member.username} size={40} />
														<StatusDot
															status={member.status}
															mobileOnly={member.mobile_only}
															class="text-duvet-bg absolute -right-0.5 -bottom-0.5 w-3.5 border-[3px]"
														/>
													</div>
													<div class="flex min-w-0 flex-1 flex-col leading-tight">
														<span class="text-duvet-ink truncate text-sm font-bold">{member.username}</span>
														<span class="text-duvet-ink2 flex min-w-0 items-center gap-1 text-xs">
															{#if activity}
																{#if activity.kind === "playing"}<GameIcon
																		class="size-3 shrink-0"
																		aria-hidden="true"
																	/>{:else}<MusicIcon class="size-3 shrink-0" aria-hidden="true" />{/if}
																<span class="truncate">{activity.text}</span>
															{:else}
																<span class="truncate">@{member.raw_username}</span>
															{/if}
														</span>
													</div>
												{/snippet}
											</MemberProfilePopover>
											<button
												type="button"
												class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised hover:text-duvet-ink relative flex size-9 items-center justify-center rounded-xl transition-colors motion-reduce:transition-none {focusRing}"
												aria-label="Message {member.username}"
												title="Message"
												onclick={() => handleOpenDM(friend)}
											>
												<MessageSquare class="size-4" />
											</button>
											<button
												type="button"
												class="text-duvet-ink2 hover:text-duvet-danger hover:bg-duvet-card relative flex size-9 items-center justify-center rounded-xl opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none {focusRing}"
												aria-label="Remove {member.username} from your friends"
												title="Remove friend"
												onclick={() => confirmUnfriend(friend)}
											>
												<UserX class="size-4" />
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						{:else}
							<p class="text-duvet-ink2 px-2 py-8 text-center text-sm">No friend matches “{query}”.</p>
						{/each}
					{/if}
				{:else if activeTab === "pending"}
					{#if $pendingFriendRequests.length === 0}
						{@render empty("shy", "No requests waiting", "When someone asks to be your friend, it shows here.")}
					{:else}
						<ul class="flex flex-col gap-2">
							{#each $pendingFriendRequests as req (req.id)}
								{@const other = friendUser(req, $currentUser?.id)}
								<li class="rounded-card bg-duvet-card shadow-duvet-raised flex items-center gap-3 p-3">
									<!-- Its card offers to accept the request, as the row's button does. -->
									<MemberProfilePopover
										member={friendMember(
											req,
											$currentUser?.id,
											userStatusToString(getUserOnlineStatus(other.id)),
											getUserMobileOnly(other.id),
										)}
										side="bottom"
										open={profileOpenFor === req.id}
										onOpenChange={(o) => (profileOpenFor = o ? req.id : null)}
										triggerClass="rounded-row flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left {focusRing}"
									>
										{#snippet children()}
											{@render person(other.id, other.avatar, other.alias ?? other.username, other.username)}
										{/snippet}
									</MemberProfilePopover>
									{#if !Number.isNaN(Date.parse(req.created_at))}
										<span class="text-duvet-ink2 hidden text-xs sm:block"
											>{new Date(req.created_at).toLocaleDateString()}</span
										>
									{/if}
									<button
										type="button"
										class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-bold transition hover:brightness-110 motion-reduce:transition-none {focusRing}"
										onclick={() => handleAccept(req)}
									>
										<UserCheck class="size-4" />
										Accept
									</button>
									<button
										type="button"
										class="text-duvet-ink2 hover:bg-duvet-bg hover:text-duvet-danger flex size-9 items-center justify-center rounded-xl transition-colors motion-reduce:transition-none {focusRing}"
										aria-label="Decline {other.alias ?? other.username}'s request"
										title="Decline"
										onclick={() => handleReject(req)}
									>
										<XIcon class="size-4" />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{:else if activeTab === "sent"}
					{#if $sentFriendRequests.length === 0}
						{@render empty("peek", "Nothing sent", "The requests you send wait here until they're answered.", {
							label: "Add a friend",
							run: () => (activeTab = "add"),
						})}
					{:else}
						<ul class="flex flex-col gap-2">
							{#each $sentFriendRequests as req (req.id)}
								{@const other = friendUser(req, $currentUser?.id)}
								<li class="rounded-card bg-duvet-card shadow-duvet-raised flex items-center gap-3 p-3">
									{@render person(other.id, other.avatar, other.alias ?? other.username, other.username)}
									<span class="text-duvet-ink2 flex items-center gap-1.5 text-xs"
										><Clock class="size-3.5" />Waiting</span
									>
									<button
										type="button"
										class="text-duvet-ink2 hover:bg-duvet-bg hover:text-duvet-danger flex h-9 items-center rounded-xl px-3 text-[13px] font-semibold transition-colors motion-reduce:transition-none {focusRing}"
										onclick={() => handleCancelSent(req)}
									>
										Cancel
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{:else if activeTab === "add"}
					<div class="rounded-card bg-duvet-card shadow-duvet-raised relative mx-auto mt-10 max-w-lg px-6 pt-14 pb-6">
						<MascotPeek
							class="absolute -top-12 left-1/2 w-24 -translate-x-1/2"
							mood={addUserId ? "awake" : "peek"}
							look={0}
						/>
						<h3 class="text-center text-lg font-bold">Add a friend</h3>
						<p class="text-duvet-ink2 mt-1 text-center text-sm">Send a request with their user ID.</p>
						<form
							class="mt-5 flex gap-2"
							onsubmit={(e) => {
								e.preventDefault();
								void handleSendRequest();
							}}
						>
							<input
								class="bg-duvet-sunk shadow-duvet-press text-duvet-ink placeholder:text-duvet-ink2 focus-override focus-visible:outline-duvet-accent h-10 min-w-0 flex-1 rounded-xl px-3 text-sm focus-visible:outline-2"
								type="text"
								placeholder="User ID"
								aria-label="User ID"
								bind:value={addUserId}
							/>
							<button
								type="submit"
								class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-bold whitespace-nowrap transition hover:brightness-110 disabled:opacity-60 motion-reduce:transition-none {focusRing}"
								disabled={loading}
							>
								{#if loading}
									Sending…
								{:else}
									<Send class="size-4" />
									Send request
								{/if}
							</button>
						</form>
						{#if addError}
							<p class="text-duvet-danger mt-3 text-sm" role="alert">{addError}</p>
						{/if}
						{#if addSuccess}
							<p class="text-duvet-alive-text mt-3 text-sm font-semibold" role="status">{addSuccess}</p>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- New chat opens over whatever is on screen: a sheet, in the page's body, as the friends list that holds it is
     hidden while a chat shows (#206). -->
<Sheet
	bind:open={
		() => showGroupModal,
		(v) => {
			if (!v) closeGroupModal();
		}
	}
	title={selectedFriendIds.size === 1 ? "New chat" : "Create a group"}
	class="max-w-[420px]"
>
	<div class="flex min-h-0 flex-col gap-1.5">
		<p class={FIELD_LABEL}>
			Friends
			{#if selectedFriendIds.size > 0}
				<span class="text-duvet-accent-text ml-1">{selectedFriendIds.size} chosen</span>
			{/if}
		</p>
		<div class="bg-duvet-card shadow-duvet-well max-h-60 overflow-y-auto rounded-[11px] p-1">
			{#if $friends.length === 0}
				<p class="text-duvet-ink2 p-4 text-center text-[13px]">No friends to add yet</p>
			{:else}
				{#each $friends as f (f.id)}
					{@const uid = getFriendUserId(f)}
					{@const selected = selectedFriendIds.has(uid)}
					{@const other = friendUser(f, $currentUser?.id)}
					<button
						type="button"
						aria-pressed={selected}
						class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors motion-reduce:transition-none {focusRing} {selected
							? 'bg-duvet-accent-tint'
							: 'hover:bg-duvet-hover'}"
						onclick={() => toggleFriend(uid)}
					>
						<UserAvatar src={getAvatarURL(other.id, other.avatar)} name={other.alias ?? other.username} size={32} />
						<span class="min-w-0 flex-1 truncate text-[13.5px] font-medium">{other.alias ?? other.username}</span>
						{#if selected}
							<Check class="text-duvet-accent-text size-4 shrink-0" />
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</div>
	<!-- A name only for a group: one friend picked opens the DM with them. Its place is kept while it's hidden, so that
	     it showing doesn't move the row the pointer is about to click. -->
	<div class="flex flex-col gap-1.5 {selectedFriendIds.size > 1 ? '' : 'invisible'}">
		<label for="group-name" class={FIELD_LABEL}>Name</label>
		<input
			id="group-name"
			class={fieldClass()}
			type="text"
			placeholder="Best friends"
			disabled={selectedFriendIds.size <= 1}
			bind:value={groupName}
		/>
	</div>
	{#if groupError}
		<p class={ERROR_NOTE} role="alert">{groupError}</p>
	{/if}
	{#snippet foot()}
		<span></span>
		<button type="button" class={buttonClass("quiet")} onclick={closeGroupModal}>Cancel</button>
		<button type="button" class={buttonClass("primary")} onclick={handleCreateGroup}>
			{selectedFriendIds.size === 1 ? "Start chat" : "Create group"}
		</button>
	{/snippet}
</Sheet>
