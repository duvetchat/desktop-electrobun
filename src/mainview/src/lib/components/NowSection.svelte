<script lang="ts">
	import {
		ArrowRightLeft as TransferIcon,
		Check as CheckIcon,
		ChevronDown as ChevronDownIcon,
		ChevronRight as ChevronRightIcon,
		ChevronUp as ChevronUpIcon,
		Gamepad2 as GameIcon,
		MonitorUp as ScreenIcon,
		Music as MusicIcon,
		Phone as PhoneIcon,
		PhoneOff as PhoneDisconnectIcon,
		Users as TeamIcon,
		Video as CameraIcon,
		X as XIcon,
	} from "@lucide/svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { getApiError } from "$lib/api/api";
	import type { FriendRequest } from "$lib/api/friends";
	import { getUserOnlineStatus } from "$lib/api/ws/connection";
	import { activityLine, shownActivities } from "$lib/activity";
	import { callingFromAnotherDevice } from "$lib/calls";
	import { getAvatarURL } from "$lib/common/common";
	import { acceptRequest, declineRequest } from "$lib/friend-requests";
	import {
		capFaces,
		callName,
		connectionNote,
		fitFaces,
		friendsNow,
		joinableCalls,
		liveIn,
		NOW_DOCK_FACES,
		NOW_FRIENDS,
		NOW_ROOMS,
		NOW_ROOM_FACES,
		busiestRooms,
		peopleCount,
		voiceRoomLabel,
		withSelf,
		type Face,
	} from "$lib/now";
	import { navPrefs, toggleNow } from "$lib/nav-prefs.svelte";
	import { hasPermission, Permission } from "$lib/permissions";
	import { isTransferActive, transferProgress } from "$lib/storage-transfers";
	import {
		activeCall,
		activeVoiceRoomId,
		callVoiceStates,
		conversations,
		conversationsWithCalls,
		currentUser,
		friends,
		gatewaySpaces,
		isMuted,
		ownCallsRinging,
		pendingFriendRequests,
		pendingTeamInvites,
		speakingUsers,
		userActivities,
		voiceConnectionState,
	} from "$lib/stores.svelte";
	import { storageTransfers } from "$lib/stores/storage-transfers.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { answerTeamInvite } from "$lib/team-invites";
	import { userStatusToString, type Guild } from "$lib/types";
	import { disconnectVoice, joinConversationCall } from "$lib/voice";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";

	// The foot of the spaces column: what's going on now, stacked. What asks the user something (a call they can join,
	// a friend request, a team invite), the files they're moving, the voice rooms with people in them, and their
	// online friends with what they're doing; under it all, the voice they're in. Nothing when there's none of those.
	// Nothing here repeats a control in sight: mute and deafen are the user bar's, a call the pane shows has its
	// banner's Join, and the friends view has its own requests.
	let {
		guilds,
		controls = true,
		isFriendsActive = false,
		activeConversationId = null,
		onRoomSelect,
		onConversationSelect,
		onFriend,
		onFriendsSelect,
	}: {
		guilds: Guild[];
		/** Off beside the folded edge, which has its own Leave: the dock then only says where the user is. Mute and
		 * deafen are always the user bar's. */
		controls?: boolean;
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
	const myFace = $derived<Face | null>(
		me ? { id: me.id, src: getAvatarURL(me.id, me.avatar), name: me.alias || me.username } : null,
	);

	// ── The voice the user is in: a space's voice room, or a call, as the user bar's voice pill has it ──
	type Person = Face & { muted: boolean };

	const dock = $derived.by(() => {
		const id = $activeVoiceRoomId;
		if (!id) return null;
		const self: Person | null = myFace ? { ...myFace, muted: $isMuted } : null;
		const space = $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === id));
		const room = space?.rooms.find((r) => r.id === id);
		if (space && room) {
			const states = (space.voice_states ?? []).filter((vs) => vs.room_id === id);
			const people = states.map((vs): Person => {
				const user = space.users.find((u) => u.id === vs.user_id);
				return {
					id: vs.user_id,
					src: user ? getAvatarURL(user.id, user.avatar) : null,
					name: user?.alias ?? user?.username ?? "Unknown",
					muted: vs.user_id === me?.id ? $isMuted : vs.muted,
				};
			});
			return {
				kind: "room" as const,
				name: room.name,
				place: space.name,
				live: liveIn(states),
				open: () => onRoomSelect(space.id, room.id),
				people: withSelf(people, self),
			};
		}
		const call = $activeCall;
		if (call?.state !== "connected" || call.conversationId !== id) return null;
		const conv = $conversations.find((c) => c.id === id);
		const states = $callVoiceStates.filter((vs) => vs.room_id === id);
		const people = states.map((vs): Person => {
			const member = conv?.members.find((m) => m.user_id === vs.user_id);
			return {
				id: vs.user_id,
				src: getAvatarURL(vs.user_id, member?.user?.avatar),
				name: member?.user?.alias ?? member?.user?.username ?? vs.user_id.slice(0, 8),
				muted: vs.user_id === me?.id ? $isMuted : (vs.muted ?? false),
			};
		});
		return {
			kind: "call" as const,
			name: callName(conv, me?.id),
			place: conv?.type === 2 ? "Group call" : "Call",
			live: liveIn(states),
			open: () => onConversationSelect(id),
			people: withSelf(people, self),
		};
	});

	const dockFaces = $derived.by(() => {
		const people = (dock?.people ?? []).map((p) => ({ ...p, speaking: $speakingUsers.has(p.id) && !p.muted }));
		return capFaces(people, NOW_DOCK_FACES);
	});
	const dockFacesLabel = $derived.by(() => {
		const speaking = (dock?.people ?? []).filter((p) => $speakingUsers.has(p.id) && !p.muted).map((p) => p.name);
		const count = `${peopleCount(dock?.people.length ?? 0)} in voice`;
		return speaking.length ? `${count}, ${speaking.join(", ")} speaking` : count;
	});
	const dockNote = $derived(connectionNote($voiceConnectionState));

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
			toast(getApiError(err, accept ? "Couldn't accept the request" : "Couldn't decline the request"), "error");
		} finally {
			answering.delete(request.id);
		}
	}

	async function answerInvite(inviteId: string, accept: boolean) {
		if (answering.has(inviteId)) return;
		answering.add(inviteId);
		try {
			await answerTeamInvite(inviteId, accept);
			if (accept) toast("Invite accepted!", "success");
		} catch (err) {
			toast(getApiError(err, accept ? "Failed to accept invite" : "Failed to decline invite"), "error");
		} finally {
			answering.delete(inviteId);
		}
	}

	// ── The files being moved between storages, the user's own or a space's they started ──
	const transfers = $derived(
		Object.values(storageTransfers.byId)
			.filter(isTransferActive)
			.map((t) => ({
				t,
				target: storageTransfers.storageName(t.target_bucket_id),
				owner:
					t.owner_id === t.started_by ? null : ($gatewaySpaces.find((s) => s.id === t.owner_id)?.name ?? "A space"),
				progress: transferProgress(t),
			})),
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
			const id = f.sender_id === me?.id ? f.recipient_id : f.sender_id;
			const status = userStatusToString(getUserOnlineStatus(id));
			if (status === "offline") return [];
			return [{ id, src: getAvatarURL(id, f.user_avatar), name: f.user_alias ?? f.user_username, status }];
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
	const anything = $derived(!!dock || asks > 0 || liveRooms.length > 0 || onlineFriends.length > 0);

	const liveLabel = { screen: "Sharing their screen", camera: "Camera on" } as const;

	const rowFocus = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-duvet-accent";
	const roundFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-duvet-accent";
	const control = `hover:bg-duvet-bg flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors motion-reduce:transition-none disabled:opacity-50 ${rowFocus}`;
</script>

{#snippet liveMark(live: "screen" | "camera" | null)}
	{#if live}
		<span class="text-duvet-alive shrink-0" title={liveLabel[live]}>
			{#if live === "screen"}<ScreenIcon class="size-3.5" aria-hidden="true" />{:else}<CameraIcon
					class="size-3.5"
					aria-hidden="true"
				/>{/if}
			<span class="sr-only">{liveLabel[live]}</span>
		</span>
	{/if}
{/snippet}

{#snippet groupHeading(title: string, count: number, folded: boolean, onToggle: () => void)}
	<h3 class="mt-2 mb-1">
		<button
			type="button"
			class="rounded-row text-duvet-ink2 hover:text-duvet-ink flex w-full items-center gap-1.5 px-1.5 text-left text-[13px] font-bold transition-colors select-none motion-reduce:transition-none {rowFocus}"
			aria-expanded={!folded}
			onclick={onToggle}
		>
			<span class="min-w-0 truncate">{title}</span>
			{#if folded}<span class="tabular-nums">{count}</span>{/if}
			<span class="flex-1"></span>
			{#if folded}<ChevronRightIcon class="size-3.5 shrink-0" aria-hidden="true" />{:else}<ChevronDownIcon
					class="size-3.5 shrink-0"
					aria-hidden="true"
				/>{/if}
		</button>
	</h3>
{/snippet}

{#snippet answer(id: string, what: string, onAnswer: (accept: boolean) => void)}
	<button
		type="button"
		class="{control} text-duvet-ink2 hover:text-duvet-alive"
		aria-label="Accept {what}"
		title="Accept"
		disabled={answering.has(id)}
		onclick={() => onAnswer(true)}
	>
		<CheckIcon class="size-4" />
	</button>
	<button
		type="button"
		class="{control} text-duvet-ink2 hover:text-duvet-danger"
		aria-label="Decline {what}"
		title="Decline"
		disabled={answering.has(id)}
		onclick={() => onAnswer(false)}
	>
		<XIcon class="size-4" />
	</button>
{/snippet}

{#if anything}
	<!-- Right under the rows. What doesn't fit scrolls in it; the voice dock stays. -->
	<section class="flex min-h-0 flex-col px-2.5 pb-1" aria-label="Now">
		<div class="-mx-2.5 flex min-h-0 flex-col overflow-y-auto px-2.5">
			{#if asks > 0}
				<ul class="flex flex-col gap-1 pt-2" aria-label="Asking you">
					{#each calls as call (call.conv.id)}
						<li
							class="rounded-card bg-duvet-card shadow-duvet-raised animate-fade-in flex items-center gap-1 p-1 motion-reduce:animate-none"
						>
							<button
								type="button"
								class="rounded-row hover:bg-duvet-bg/60 flex min-w-0 flex-1 items-center gap-2.5 p-1 text-left transition-colors motion-reduce:transition-none {rowFocus}"
								aria-label="Open {call.name}"
								data-jump
								onclick={() => onConversationSelect(call.conv.id)}
							>
								<span
									class="bg-duvet-bg text-duvet-alive shadow-duvet-press flex size-8 shrink-0 items-center justify-center rounded-xl"
								>
									<PhoneIcon class="size-4" />
								</span>
								<span class="flex min-w-0 flex-1 flex-col leading-tight">
									<span class="text-duvet-ink truncate text-sm font-bold">{call.name}</span>
									<span class="text-duvet-ink2 truncate text-xs"
										>{call.waits ? "Calling from another device" : "Call going on"}</span
									>
								</span>
								<FaceStack
									faces={call.faces.faces}
									more={call.faces.more}
									ring="ring-duvet-card"
									label="{peopleCount(call.faces.faces.length + call.faces.more)} in the call"
								/>
							</button>
							{#if !call.waits}
								<button
									type="button"
									class="bg-duvet-alive text-duvet-on-accent h-8 shrink-0 rounded-lg px-3 text-xs font-bold transition hover:brightness-110 motion-reduce:transition-none {roundFocus}"
									aria-label="Join the call in {call.name}"
									onclick={() => joinConversationCall(call.conv)}
								>
									Join
								</button>
							{/if}
						</li>
					{/each}

					{#each requests as request (request.id)}
						{@const name = request.user_alias ?? request.user_username}
						<li class="rounded-card bg-duvet-card shadow-duvet-raised flex items-center gap-1 p-1">
							<div class="flex min-w-0 flex-1 items-center gap-2.5 p-1">
								<UserAvatar src={getAvatarURL(request.sender_id, request.user_avatar)} {name} size={32} />
								<span class="flex min-w-0 flex-1 flex-col leading-tight">
									<span class="text-duvet-ink truncate text-sm font-bold">{name}</span>
									<span class="text-duvet-ink2 truncate text-xs">Wants to be friends</span>
								</span>
							</div>
							{@render answer(request.id, `${name}'s friend request`, (accept) => answerRequest(request, accept))}
						</li>
					{/each}

					{#each $pendingTeamInvites as invite (invite.id)}
						<li class="rounded-card bg-duvet-card shadow-duvet-raised flex items-center gap-1 p-1">
							<div class="flex min-w-0 flex-1 items-center gap-2.5 p-1">
								<span
									class="bg-duvet-bg text-duvet-accent-text shadow-duvet-press flex size-8 shrink-0 items-center justify-center rounded-xl"
								>
									<TeamIcon class="size-4" />
								</span>
								<span class="flex min-w-0 flex-1 flex-col leading-tight">
									<span class="text-duvet-ink truncate text-sm font-bold">{invite.team_name}</span>
									<span class="text-duvet-ink2 truncate text-xs">Team invite from {invite.invited_by_username}</span>
								</span>
							</div>
							{@render answer(invite.id, `the invite to ${invite.team_name}`, (accept) =>
								answerInvite(invite.id, accept),
							)}
						</li>
					{/each}

					{#each transfers as { t, target, owner, progress } (t.id)}
						<li class="rounded-card bg-duvet-card shadow-duvet-raised flex flex-col gap-1.5 p-2">
							<div class="flex min-w-0 items-center gap-2.5">
								<span
									class="bg-duvet-bg text-duvet-accent-text shadow-duvet-press flex size-8 shrink-0 items-center justify-center rounded-xl"
								>
									<TransferIcon class="size-4" />
								</span>
								<span class="flex min-w-0 flex-1 flex-col leading-tight">
									<span class="text-duvet-ink truncate text-sm font-bold"
										>Moving {owner ? `${owner}'s files` : "your files"}</span
									>
									<span class="text-duvet-ink2 truncate text-xs"
										>{target ? `To ${target}, ` : ""}{progress.done} of {progress.total}</span
									>
								</span>
								<span class="text-duvet-ink2 shrink-0 text-xs font-bold tabular-nums">{progress.percent}%</span>
							</div>
							<div
								class="bg-duvet-bg shadow-duvet-press h-1.5 overflow-hidden rounded-full"
								role="progressbar"
								aria-label="Moving {owner ? `${owner}'s files` : 'your files'}"
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
				{@render groupHeading("In voice now", liveRooms.length, navPrefs.now.roomsFolded, () =>
					toggleNow("roomsFolded"),
				)}
			{/if}
			{#if liveRooms.length > 0 && !navPrefs.now.roomsFolded}
				<ul class="flex flex-col gap-px">
					{#each shownRooms as { guild, channel, people, live } (channel.id)}
						{@const stack = capFaces(people, NOW_ROOM_FACES)}
						<li>
							<button
								type="button"
								class="rounded-row hover:bg-duvet-card/70 flex h-10 w-full items-center gap-2 px-1.5 text-left transition-colors motion-reduce:transition-none {rowFocus}"
								aria-label="{voiceRoomLabel(channel.name, guild.name, people.length)}{live
									? `, ${liveLabel[live].toLowerCase()}`
									: ''}"
								title="{channel.name} in {guild.name}"
								data-jump
								onclick={() => onRoomSelect(guild.id, channel.id)}
							>
								<span class="contents" aria-hidden="true"
									><SpaceIcon src={guild.icon_url || null} name={guild.name} size={28} /></span
								>
								<span class="bg-duvet-alive size-2 shrink-0 rounded-full"></span>
								<span class="text-duvet-ink min-w-0 flex-1 truncate text-sm font-semibold">{channel.name}</span>
								{@render liveMark(live)}
								<FaceStack
									faces={stack.faces.map((u) => ({ id: u.id, src: u.avatar_url, name: u.username }))}
									more={stack.more}
									ring="ring-duvet-sunk"
								/>
							</button>
						</li>
					{/each}
				</ul>
				{#if moreRooms > 0}
					<button
						type="button"
						class="rounded-row text-duvet-ink2 hover:bg-duvet-card/70 hover:text-duvet-ink flex h-8 w-full items-center gap-2 px-1.5 text-left text-xs font-semibold transition-colors motion-reduce:transition-none {rowFocus}"
						aria-expanded={navPrefs.now.allRooms}
						onclick={() => toggleNow("allRooms")}
					>
						<span class="flex w-7 shrink-0 justify-center" aria-hidden="true">
							{#if navPrefs.now.allRooms}<ChevronUpIcon class="size-3.5" />{:else}<ChevronDownIcon
									class="size-3.5"
								/>{/if}
						</span>
						{navPrefs.now.allRooms
							? "Show the busiest only"
							: `${moreRooms} more ${moreRooms === 1 ? "room" : "rooms"}`}
					</button>
				{/if}
			{/if}

			{#if onlineFriends.length > 0}
				{@render groupHeading("Online friends", onlineFriends.length, navPrefs.now.friendsFolded, () =>
					toggleNow("friendsFolded"),
				)}
			{/if}
			{#if onlineFriends.length > 0 && !navPrefs.now.friendsFolded}
				{#if friendsSplit.busy.length > 0}
					<ul class="flex flex-col gap-px">
						{#each friendsSplit.busy as { friend, activity } (friend.id)}
							<li>
								<button
									type="button"
									class="rounded-row hover:bg-duvet-card/70 flex h-11 w-full items-center gap-2.5 px-1.5 text-left transition-colors motion-reduce:transition-none {rowFocus}"
									aria-label="Message {friend.name}, {activity.kind === 'playing'
										? 'playing'
										: 'listening to'} {activity.text}"
									data-jump
									onclick={() => onFriend(friend.id)}
								>
									<span class="relative shrink-0">
										<UserAvatar src={friend.src} name={friend.name} size={28} />
										<StatusDot
											status={friend.status}
											class="border-duvet-sunk absolute -right-0.5 -bottom-0.5 size-2.5 border-2"
										/>
									</span>
									<span class="flex min-w-0 flex-1 flex-col leading-tight">
										<span class="text-duvet-ink truncate text-sm font-semibold">{friend.name}</span>
										<span class="text-duvet-ink2 flex min-w-0 items-center gap-1 text-xs">
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
					<ul class="flex items-center gap-1 px-1.5 pt-0.5 pb-1">
						{#each friendFaces.faces as friend (friend.id)}
							<li class="shrink-0">
								<button
									type="button"
									class="relative block rounded-full {roundFocus}"
									aria-label="Message {friend.name}"
									title={friend.name}
									data-jump
									onclick={() => onFriend(friend.id)}
								>
									<UserAvatar src={friend.src} name={friend.name} size={26} />
									<StatusDot
										status={friend.status}
										class="border-duvet-sunk absolute -right-0.5 -bottom-0.5 size-2.5 border-2"
									/>
								</button>
							</li>
						{/each}
						{#if friendFaces.more > 0}
							<li class="shrink-0">
								<button
									type="button"
									class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised hover:text-duvet-ink flex size-[26px] items-center justify-center rounded-full text-[11px] font-bold tabular-nums transition-colors motion-reduce:transition-none {roundFocus}"
									aria-label="{friendFaces.more} more online friends"
									title="{friendFaces.more} more online"
									onclick={onFriendsSelect}
								>
									+{friendFaces.more}
								</button>
							</li>
						{/if}
					</ul>
				{/if}
			{/if}
		</div>

		{#if dock}
			<!-- One row, as Discord has it: where the user is and who's there; Leave when docked. -->
			<div
				class="rounded-card bg-duvet-card shadow-duvet-raised mt-2 flex shrink-0 items-center gap-1 p-1"
				aria-label={dock.kind === "call" ? "Your call" : "Your voice"}
				role="group"
			>
				<button
					type="button"
					class="rounded-row hover:bg-duvet-bg/60 flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left transition-colors motion-reduce:transition-none {rowFocus}"
					aria-label="Open {dock.name}{dock.kind === 'room' ? ` in ${dock.place}` : ''}, {dockFacesLabel}"
					data-jump
					onclick={dock.open}
				>
					<span class="flex min-w-0 flex-1 flex-col leading-tight">
						<span
							class="flex min-w-0 items-center gap-1.5 text-[13px] font-bold {dockNote
								? 'text-duvet-ink2'
								: 'text-duvet-alive'}"
						>
							<span class="size-2 shrink-0 rounded-full {dockNote ? 'bg-duvet-ink2' : 'bg-duvet-alive'}"></span>
							<span class="truncate">{dockNote ?? (dock.kind === "call" ? "Call connected" : "Voice connected")}</span>
							{@render liveMark(dock.live)}
						</span>
						<span class="text-duvet-ink2 truncate text-xs"
							>{dock.kind === "room" ? `${dock.name} / ${dock.place}` : dock.name}</span
						>
					</span>
					<FaceStack faces={dockFaces.faces} more={dockFaces.more} size={18} ring="ring-duvet-card" />
				</button>
				{#if controls}
					<button
						type="button"
						class="{control} text-duvet-ink2 hover:text-duvet-danger"
						aria-label={dock.kind === "call" ? "Leave call" : "Leave voice"}
						title={dock.kind === "call" ? "Leave call" : "Leave voice"}
						onclick={disconnectVoice}
					>
						<PhoneDisconnectIcon class="size-4" />
					</button>
				{/if}
			</div>
		{/if}
	</section>
{/if}
