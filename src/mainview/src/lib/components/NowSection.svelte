<script lang="ts">
	import {
		ArrowRightLeft as TransferIcon,
		Check as CheckIcon,
		ChevronDown as ChevronDownIcon,
		ChevronUp as ChevronUpIcon,
		Gamepad2 as GameIcon,
		MonitorUp as ScreenIcon,
		Music as MusicIcon,
		Phone as PhoneIcon,
		Users as TeamIcon,
		Video as CameraIcon,
		X as XIcon,
	} from "@lucide/svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { getApiError } from "$lib/api/api";
	import type { FriendRequest } from "$lib/api/friends";
	import { getUserMobileOnly, getUserOnlineStatus } from "$lib/api/ws/connection";
	import { activityLine, shownActivities } from "$lib/activity";
	import { callingFromAnotherDevice } from "$lib/calls";
	import { getAvatarURL } from "$lib/common/common";
	import { acceptRequest, declineRequest } from "$lib/friend-requests";
	import { friendUser } from "$lib/friends";
	import { t } from "$lib/i18n";
	import { formatNumber } from "$lib/i18n/format";
	import { liveLabel } from "$lib/media-state";
	import {
		capFaces,
		callName,
		fitFaces,
		friendsNow,
		joinableCalls,
		liveIn,
		NOW_FRIENDS,
		NOW_ROOMS,
		NOW_ROOM_FACES,
		busiestRooms,
		voiceRoomLabel,
		type Face,
	} from "$lib/now";
	import { navPrefs, toggleNow } from "$lib/nav-prefs.svelte";
	import { hasPermission, Permission } from "$lib/permissions";
	import { isTransferActive, storageCase, transferProgress } from "$lib/storage-transfers";
	import {
		activeCall,
		activeVoiceRoomId,
		callVoiceStates,
		conversations,
		conversationsWithCalls,
		currentUser,
		friends,
		gatewaySpaces,
		ownCallsRinging,
		pendingFriendRequests,
		pendingTeamInvites,
		userActivities,
	} from "$lib/stores.svelte";
	import { storageTransfers } from "$lib/stores/storage-transfers.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { answerTeamInvite } from "$lib/team-invites";
	import { userStatusToString, type Guild } from "$lib/types";
	import { joinConversationCall } from "$lib/voice";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Avatar from "$lib/components/ui/Avatar.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";

	// What's going on now, in the sidebar between its rows and its bottom block (#357): what asks the user something
	// (a call they can join, a friend request, a team invite), the files they're moving, the voice rooms with people in
	// them, and their online friends with what they're doing. Nothing when there's none of those. It is drawn with the
	// sidebar's own rows, headings and cards, on its tokens, so it reads as part of the column.
	// Nothing here repeats a control in sight: the voice the user is in is the call panel's (MediaControls, which took
	// the place of this section's voice dock: DECISIONS.md, "The prototype's unanswered questions", 3), a call the pane
	// shows has its banner's Join, and the friends view has its own requests.
	let {
		guilds,
		isFriendsActive = false,
		activeConversationId = null,
		onRoomSelect,
		onConversationSelect,
		onFriend,
		onFriendsSelect,
	}: {
		guilds: Guild[];
		/** The friends view is in the focused pane, with the friend requests. */
		isFriendsActive?: boolean;
		/** The conversation the focused pane shows, whose call has a banner there. */
		activeConversationId?: string | null;
		onRoomSelect: (spaceId: string, roomId: string) => void;
		onConversationSelect: (conversationId: string) => void;
		/** Opens the direct message with a friend, starting it when there's none yet. */
		onFriend: (userId: string) => void;
		onFriendsSelect: () => void;
	} = $props();

	const me = $derived($currentUser);

	// ── The calls going on in the user's conversations that they can join from here ──
	const calls = $derived(
		joinableCalls($conversationsWithCalls, $activeCall, activeConversationId).flatMap((id) => {
			const conv = $conversations.find((c) => c.id === id);
			if (!conv) return [];
			const faces = $callVoiceStates
				.filter((vs) => vs.room_id === id)
				.map((vs): Face => {
					const member = conv.members.find((m) => m.user_id === vs.user_id);
					return {
						id: vs.user_id,
						src: getAvatarURL(vs.user_id, member?.user?.avatar),
						name: member?.user?.alias ?? member?.user?.username ?? vs.user_id.slice(0, 8),
					};
				});
			// The user's own call, placed on another device, waits there for someone to answer it.
			const waits = callingFromAnotherDevice(id, $ownCallsRinging, $activeCall);
			return [{ conv, name: callName(conv, me?.id), faces: capFaces(faces, NOW_ROOM_FACES), waits }];
		}),
	);

	// ── Friend requests, which the friends view lists itself while it's open ──
	const requests = $derived(isFriendsActive ? [] : $pendingFriendRequests);

	// What's being answered, so a second click doesn't send it again.
	const answering = new SvelteSet<string>();

	async function answerRequest(request: FriendRequest, accept: boolean) {
		if (answering.has(request.id)) return;
		answering.add(request.id);
		try {
			await (accept ? acceptRequest(request) : declineRequest(request));
		} catch (err) {
			toast(
				getApiError(err, accept ? t("shell_now_accept_request_failed") : t("shell_now_decline_request_failed")),
				"error",
			);
		} finally {
			answering.delete(request.id);
		}
	}

	async function answerInvite(inviteId: string, accept: boolean) {
		if (answering.has(inviteId)) return;
		answering.add(inviteId);
		try {
			await answerTeamInvite(inviteId, accept);
			if (accept) toast(t("shell_now_invite_accepted"), "success");
		} catch (err) {
			toast(
				getApiError(err, accept ? t("shell_now_accept_invite_failed") : t("shell_now_decline_invite_failed")),
				"error",
			);
		} finally {
			answering.delete(inviteId);
		}
	}

	// ── The files being moved between storages, the user's own or a space's they started ──
	// Whose they are, as the heading's message tells them apart: the user's own, a Space's by its name, or a Space whose
	// name isn't known here.
	const transfers = $derived(
		Object.values(storageTransfers.byId)
			.filter(isTransferActive)
			.map((transfer) => {
				const space =
					transfer.owner_id === transfer.started_by ? null : $gatewaySpaces.find((s) => s.id === transfer.owner_id);
				const whose = transfer.owner_id === transfer.started_by ? "own" : space ? "space" : "unknown";
				const target = storageTransfers.storageName(transfer.target_bucket_id);
				return {
					t: transfer,
					// Where to: the default storage in the sentence's own words, a bucket by its name.
					to: storageCase(transfer.target_bucket_id, target),
					target,
					moving: t("shell_now_moving", { whose, owner: space?.name ?? "" }),
					progress: transferProgress(transfer),
				};
			}),
	);

	// ── The voice rooms of the user's spaces with people in them, those they can join, besides the one they're in ──
	const liveRooms = $derived.by(() => {
		const spaceById = new Map($gatewaySpaces.map((s) => [s.id, s]));
		const rooms = guilds.flatMap((guild) => {
			const space = spaceById.get(guild.id);
			if (!space) return [];
			return guild.channels.flatMap((channel) => {
				if (channel.type !== "voice" || !channel.voiceUsers?.length || channel.id === $activeVoiceRoomId) return [];
				const room = space.rooms.find((r) => r.id === channel.id);
				if (!room || !hasPermission(space, room, Permission.JoinVoice)) return [];
				return [{ guild, channel, people: channel.voiceUsers, live: liveIn(channel.voiceUsers) }];
			});
		});
		return busiestRooms(rooms, (r) => r.people.length, Infinity);
	});
	// The busiest few, or all of them when the user opened the rest.
	const shownRooms = $derived(navPrefs.now.allRooms ? liveRooms : liveRooms.slice(0, NOW_ROOMS));
	const moreRooms = $derived(liveRooms.length - NOW_ROOMS);

	// ── The user's friends who are online (idle and do not disturb are there too), with what they're doing ──
	const onlineFriends = $derived(
		$friends.flatMap((f) => {
			const other = friendUser(f, me?.id);
			const status = userStatusToString(getUserOnlineStatus(other.id));
			if (status === "offline") return [];
			return [
				{
					id: other.id,
					src: getAvatarURL(other.id, other.avatar),
					name: other.alias ?? other.username,
					status,
					mobileOnly: getUserMobileOnly(other.id),
				},
			];
		}),
	);
	const friendsSplit = $derived(
		friendsNow(onlineFriends, (f) => {
			const activity = shownActivities($userActivities[f.id])[0];
			return activity ? activityLine(activity) : null;
		}),
	);
	const friendFaces = $derived(fitFaces(friendsSplit.rest, NOW_FRIENDS));

	const asks = $derived(calls.length + requests.length + $pendingTeamInvites.length + transfers.length);
	const anything = $derived(asks > 0 || liveRooms.length > 0 || onlineFriends.length > 0);

	const rowFocus = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-duvet-accent";
	const roundFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-duvet-accent";
	// The sidebar's recipes (SpaceNav.svelte, DMSidebar.svelte; DESIGN-MAP.md S-05 to S-07): a row lights on hover, a
	// card is the call panel's, and an icon that isn't a person sits on a rounded square.
	const row = `hover:bg-duvet-sb-hover flex w-full items-center rounded-[10px] text-left transition-colors duration-[120ms] motion-reduce:transition-none ${rowFocus}`;
	const card = "bg-duvet-sb-card shadow-duvet-raised flex items-center gap-1 rounded-[14px] p-1.5";
	const tile = "bg-duvet-secondary-fill text-duvet-accent-text grid size-8 shrink-0 place-items-center rounded-[10px]";
	const cardName = "text-duvet-ink truncate text-[13.5px] leading-tight font-semibold";
	const cardNote = "text-duvet-ink2 truncate text-[12.5px] leading-[1.3]";
</script>

{#snippet liveMark(live: "screen" | "camera" | null)}
	{#if live}
		<span class="text-duvet-alive-text shrink-0" title={liveLabel(live)}>
			{#if live === "screen"}<ScreenIcon class="size-3.5" aria-hidden="true" />{:else}<CameraIcon
					class="size-3.5"
					aria-hidden="true"
				/>{/if}
			<span class="sr-only">{liveLabel(live)}</span>
		</span>
	{/if}
{/snippet}

<!-- A group's heading, the sidebar's section head as a button: it folds the group to its heading and a count. -->
{#snippet groupHeading(title: string, count: number, folded: boolean, onToggle: () => void)}
	<h3>
		<button
			type="button"
			class="text-duvet-ink2 hover:text-duvet-ink flex h-[30px] w-full items-end gap-1.5 rounded-lg px-2.5 pb-0.5 text-left text-[11.5px] font-semibold transition-colors duration-[120ms] select-none motion-reduce:transition-none {rowFocus}"
			aria-expanded={!folded}
			onclick={onToggle}
		>
			<span class="min-w-0 truncate">{title}</span>
			{#if folded}<span class="tabular-nums">{formatNumber(count)}</span>{/if}
			<span class="flex-1"></span>
			<ChevronDownIcon
				class="mb-px size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none {folded
					? '-rotate-90'
					: ''}"
				aria-hidden="true"
			/>
		</button>
	</h3>
{/snippet}

<!-- Accept and decline, each named in full for a screen reader (`accept`, `decline`). -->
{#snippet answer(id: string, accept: string, decline: string, onAnswer: (accept: boolean) => void)}
	<IconButton label={accept} title={t("shell_now_accept")} disabled={answering.has(id)} onclick={() => onAnswer(true)}>
		<CheckIcon size={16} />
	</IconButton>
	<IconButton
		label={decline}
		title={t("shell_now_decline")}
		disabled={answering.has(id)}
		onclick={() => onAnswer(false)}
	>
		<XIcon size={16} />
	</IconButton>
{/snippet}

{#if anything}
	<!-- Between the sidebar's rows and its bottom block, under a hairline. What doesn't fit scrolls in it. -->
	<section class="flex min-h-0 flex-col shadow-[0_-1px_0_var(--duvet-sb-edge)]" aria-label={t("shell_now")}>
		<div class="flex min-h-0 flex-col overflow-y-auto px-2 pb-2">
			{#if asks > 0}
				<ul class="flex flex-col gap-1.5 px-0.5 pt-2" aria-label={t("shell_now_asking")}>
					{#each calls as call (call.conv.id)}
						<li class="{card} animate-fade-in motion-reduce:animate-none">
							<button
								type="button"
								class="{row} min-w-0 flex-1 gap-2.5 p-0.5"
								aria-label={t("shell_now_open_call", { name: call.name })}
								data-jump
								onclick={() => onConversationSelect(call.conv.id)}
							>
								<span
									class="bg-duvet-alive/14 text-duvet-alive-text grid size-8 shrink-0 place-items-center rounded-[10px]"
								>
									<PhoneIcon class="size-4" />
								</span>
								<span class="flex min-w-0 flex-1 flex-col">
									<span class={cardName}>{call.name}</span>
									<span class={cardNote}
										>{call.waits ? t("shell_now_call_elsewhere") : t("shell_now_call_going_on")}</span
									>
								</span>
								<FaceStack
									faces={call.faces.faces}
									more={call.faces.more}
									size={18}
									ring="ring-duvet-sb-ring"
									label={t("shell_now_call_people", { count: call.faces.faces.length + call.faces.more })}
								/>
							</button>
							{#if !call.waits}
								<Button
									size="sm"
									aria-label={t("shell_now_join_call", { name: call.name })}
									onclick={() => joinConversationCall(call.conv)}
								>
									{t("shell_now_join")}
								</Button>
							{/if}
						</li>
					{/each}

					{#each requests as request (request.id)}
						{@const other = friendUser(request, me?.id)}
						{@const name = other.alias ?? other.username}
						<li class={card}>
							<div class="flex min-w-0 flex-1 items-center gap-2.5 p-0.5">
								<UserAvatar src={getAvatarURL(other.id, other.avatar)} {name} size={32} />
								<span class="flex min-w-0 flex-1 flex-col">
									<span class={cardName}>{name}</span>
									<span class={cardNote}>{t("shell_now_wants_friends")}</span>
								</span>
							</div>
							{@render answer(
								request.id,
								t("shell_now_accept_request", { name }),
								t("shell_now_decline_request", { name }),
								(accept) => answerRequest(request, accept),
							)}
						</li>
					{/each}

					{#each $pendingTeamInvites as invite (invite.id)}
						<li class={card}>
							<div class="flex min-w-0 flex-1 items-center gap-2.5 p-0.5">
								<span class={tile}>
									<TeamIcon class="size-4" />
								</span>
								<span class="flex min-w-0 flex-1 flex-col">
									<span class={cardName}>{invite.team_name}</span>
									<span class={cardNote}>{t("shell_now_team_invite", { name: invite.invited_by_username })}</span>
								</span>
							</div>
							{@render answer(
								invite.id,
								t("shell_now_accept_invite", { team: invite.team_name }),
								t("shell_now_decline_invite", { team: invite.team_name }),
								(accept) => answerInvite(invite.id, accept),
							)}
						</li>
					{/each}

					{#each transfers as { t: transfer, to, target, moving, progress } (transfer.id)}
						<li class="bg-duvet-sb-card shadow-duvet-raised flex flex-col gap-2 rounded-[14px] p-2">
							<div class="flex min-w-0 items-center gap-2.5">
								<span class={tile}>
									<TransferIcon class="size-4" />
								</span>
								<span class="flex min-w-0 flex-1 flex-col">
									<span class={cardName}>{moving}</span>
									<span class={cardNote}
										>{to !== "unknown"
											? t("shell_now_moving_to", {
													to,
													target: target ?? "",
													done: progress.done,
													total: progress.total,
												})
											: t("shell_now_moving_count", { done: progress.done, total: progress.total })}</span
									>
								</span>
								<span class="text-duvet-ink2 shrink-0 text-[11.5px] font-semibold tabular-nums"
									>{t("shell_now_moving_percent", { percent: progress.percent })}</span
								>
							</div>
							<div
								class="bg-duvet-secondary-fill h-1.5 overflow-hidden rounded-full"
								role="progressbar"
								aria-label={moving}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={progress.percent}
							>
								<div
									class="bg-duvet-accent h-full origin-left rounded-full transition-transform motion-reduce:transition-none"
									style="transform: scaleX({progress.percent / 100})"
								></div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if liveRooms.length > 0}
				{@render groupHeading(t("shell_now_in_voice"), liveRooms.length, navPrefs.now.roomsFolded, () =>
					toggleNow("roomsFolded"),
				)}
			{/if}
			{#if liveRooms.length > 0 && !navPrefs.now.roomsFolded}
				<ul class="flex flex-col">
					{#each shownRooms as { guild, channel, people, live } (channel.id)}
						{@const stack = capFaces(people, NOW_ROOM_FACES)}
						<li>
							<button
								type="button"
								class="{row} h-[34px] gap-[7px] pr-2 pl-1.5"
								aria-label={voiceRoomLabel(channel.name, guild.name, people.length, live)}
								title={t("shell_now_room_in_space", { room: channel.name, space: guild.name })}
								data-jump
								onclick={() => onRoomSelect(guild.id, channel.id)}
							>
								<span class="contents" aria-hidden="true"
									><SpaceIcon src={guild.icon_url || null} name={guild.name} size={22} /></span
								>
								<span class="bg-duvet-alive size-[7px] shrink-0 rounded-full"></span>
								<span class="text-duvet-ink min-w-0 flex-1 truncate text-[13.5px] font-medium">{channel.name}</span>
								{@render liveMark(live)}
								<FaceStack
									faces={stack.faces.map((u) => ({ id: u.id, src: u.avatar_url, name: u.username }))}
									more={stack.more}
									size={18}
									ring="ring-duvet-sb-ring"
								/>
							</button>
						</li>
					{/each}
				</ul>
				{#if moreRooms > 0}
					<button
						type="button"
						class="text-duvet-ink2 hover:text-duvet-ink flex h-7 w-full shrink-0 items-center gap-2 rounded-lg pr-2.5 pl-[11px] text-left text-xs font-medium transition-colors duration-[120ms] motion-reduce:transition-none {rowFocus}"
						aria-expanded={navPrefs.now.allRooms}
						onclick={() => toggleNow("allRooms")}
					>
						{#if navPrefs.now.allRooms}<ChevronUpIcon
								class="size-[13px] shrink-0"
								aria-hidden="true"
							/>{:else}<ChevronDownIcon class="size-[13px] shrink-0" aria-hidden="true" />{/if}
						{navPrefs.now.allRooms ? t("shell_now_busiest_only") : t("shell_now_more_rooms", { count: moreRooms })}
					</button>
				{/if}
			{/if}

			{#if onlineFriends.length > 0}
				{@render groupHeading(t("shell_now_online_friends"), onlineFriends.length, navPrefs.now.friendsFolded, () =>
					toggleNow("friendsFolded"),
				)}
			{/if}
			{#if onlineFriends.length > 0 && !navPrefs.now.friendsFolded}
				{#if friendsSplit.busy.length > 0}
					<ul class="flex flex-col">
						{#each friendsSplit.busy as { friend, activity } (friend.id)}
							<li>
								<button
									type="button"
									class="{row} h-11 gap-2.5 pr-2.5 pl-2"
									aria-label={t("shell_now_message_friend_doing", {
										name: friend.name,
										kind: activity.kind === "playing" ? "playing" : "listening",
										activity: activity.text,
									})}
									data-jump
									onclick={() => onFriend(friend.id)}
								>
									<Avatar size={32} status={friend.status} mobileOnly={friend.mobileOnly} ring="var(--duvet-sb-ring)">
										<UserAvatar src={friend.src} name={friend.name} size={32} />
									</Avatar>
									<span class="flex min-w-0 flex-1 flex-col gap-px">
										<span class="text-duvet-ink truncate text-[13.5px] leading-tight font-medium">{friend.name}</span>
										<span class="text-duvet-ink2 flex min-w-0 items-center gap-1 text-[12.5px] leading-[1.3]">
											{#if activity.kind === "playing"}<GameIcon
													class="size-3 shrink-0"
													aria-hidden="true"
												/>{:else}<MusicIcon class="size-3 shrink-0" aria-hidden="true" />{/if}
											<span class="truncate" title={activity.text}>{activity.text}</span>
										</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				{#if friendFaces.faces.length > 0 || friendFaces.more > 0}
					<ul class="flex shrink-0 items-center gap-1.5 px-2 pt-1 pb-0.5">
						{#each friendFaces.faces as friend (friend.id)}
							<li class="flex shrink-0">
								<button
									type="button"
									class="flex rounded-full {roundFocus}"
									aria-label={t("shell_now_message_friend", { name: friend.name })}
									title={friend.name}
									data-jump
									onclick={() => onFriend(friend.id)}
								>
									<Avatar size={26} status={friend.status} mobileOnly={friend.mobileOnly} ring="var(--duvet-sb-ring)">
										<UserAvatar src={friend.src} name={friend.name} size={26} />
									</Avatar>
								</button>
							</li>
						{/each}
						{#if friendFaces.more > 0}
							<li class="flex shrink-0">
								<button
									type="button"
									class="bg-duvet-secondary-fill text-duvet-ink2 hover:text-duvet-ink flex size-[26px] items-center justify-center rounded-full text-[10.5px] font-bold tabular-nums transition-colors duration-[120ms] motion-reduce:transition-none {roundFocus}"
									aria-label={t("shell_now_more_friends", { count: friendFaces.more })}
									title={t("shell_now_more_online", { count: friendFaces.more })}
									onclick={onFriendsSelect}
								>
									+{formatNumber(friendFaces.more)}
								</button>
							</li>
						{/if}
					</ul>
				{/if}
			{/if}
		</div>
	</section>
{/if}
