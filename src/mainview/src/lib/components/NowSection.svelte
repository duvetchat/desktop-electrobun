<script lang="ts">
	import { Phone as PhoneIcon, PhoneOff as PhoneDisconnectIcon } from "@lucide/svelte";
	import { getUserOnlineStatus } from "$lib/api/ws/connection";
	import { getAvatarURL } from "$lib/common/common";
	import {
		capFaces,
		callName,
		connectionNote,
		fitFaces,
		NOW_FRIENDS,
		NOW_ROOM_FACES,
		busiestRooms,
		nowKind,
		peopleCount,
		voiceRoomLabel,
		withSelf,
		type Face,
	} from "$lib/now";
	import { hasPermission, Permission } from "$lib/permissions";
	import {
		activeCall,
		activeVoiceRoomId,
		callVoiceStates,
		conversations,
		currentUser,
		friends,
		gatewaySpaces,
		isMuted,
		speakingUsers,
		voiceConnectionState,
	} from "$lib/stores.svelte";
	import { userStatusToString, type Guild } from "$lib/types";
	import { disconnectVoice } from "$lib/voice";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";

	// The foot of the spaces column: what's going on now. The voice the user is in, with Leave when docked; else
	// the voice rooms of their spaces with people in them; else their online friends. Nothing when there's none of those.
	let {
		guilds,
		controls = true,
		onRoomSelect,
		onConversationSelect,
		onFriend,
		onFriendsSelect,
	}: {
		guilds: Guild[];
		/** Off beside the folded edge, which has its own Leave: the dock then only says where the user is. Mute and
		 * deafen are always the user bar's. */
		controls?: boolean;
		onRoomSelect: (spaceId: string, roomId: string) => void;
		onConversationSelect: (conversationId: string) => void;
		/** Opens the direct message with a friend, starting it when there's none yet. */
		onFriend: (userId: string) => void;
		onFriendsSelect: () => void;
	} = $props();

	const headingId = $props.id();

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
			const people = (space.voice_states ?? [])
				.filter((vs) => vs.room_id === id)
				.map((vs): Person => {
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
				icon: guilds.find((g) => g.id === space.id)?.icon_url || null,
				open: () => onRoomSelect(space.id, room.id),
				people: withSelf(people, self),
			};
		}
		const call = $activeCall;
		if (call?.state !== "connected" || call.conversationId !== id) return null;
		const conv = $conversations.find((c) => c.id === id);
		const people = $callVoiceStates
			.filter((vs) => vs.room_id === id)
			.map((vs): Person => {
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
			icon: null,
			open: () => onConversationSelect(id),
			people: withSelf(people, self),
		};
	});

	const dockFaces = $derived.by(() => {
		const people = (dock?.people ?? []).map((p) => ({ ...p, speaking: $speakingUsers.has(p.id) && !p.muted }));
		return capFaces(people, NOW_ROOM_FACES);
	});
	const dockFacesLabel = $derived.by(() => {
		const speaking = (dock?.people ?? []).filter((p) => $speakingUsers.has(p.id) && !p.muted).map((p) => p.name);
		const count = `${peopleCount(dock?.people.length ?? 0)} in voice`;
		return speaking.length ? `${count}, ${speaking.join(", ")} speaking` : count;
	});
	const dockNote = $derived(connectionNote($voiceConnectionState));

	// ── The voice rooms of the user's spaces with people in them, those they can join, as the column's rows have them ──
	const liveRooms = $derived.by(() => {
		const spaceById = new Map($gatewaySpaces.map((s) => [s.id, s]));
		const rooms = guilds.flatMap((guild) => {
			const space = spaceById.get(guild.id);
			if (!space) return [];
			return guild.channels.flatMap((channel) => {
				if (channel.type !== "voice" || !channel.voiceUsers?.length) return [];
				const room = space.rooms.find((r) => r.id === channel.id);
				if (!room || !hasPermission(space, room, Permission.JoinVoice)) return [];
				return [{ guild, channel, people: channel.voiceUsers }];
			});
		});
		return busiestRooms(rooms, (r) => r.people.length);
	});

	// ── The user's friends who are online (idle and do not disturb are there too) ──
	const onlineFriends = $derived(
		$friends.flatMap((f) => {
			const id = f.sender_id === me?.id ? f.recipient_id : f.sender_id;
			const status = userStatusToString(getUserOnlineStatus(id));
			if (status === "offline") return [];
			return [{ id, src: getAvatarURL(id, f.user_avatar), name: f.user_alias ?? f.user_username, status }];
		}),
	);
	const friendFaces = $derived(fitFaces(onlineFriends, NOW_FRIENDS));

	const kind = $derived(nowKind(!!dock, liveRooms.length, onlineFriends.length));

	const rowFocus = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-duvet-accent";
	const roundFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-duvet-accent";
	const control = `hover:bg-duvet-bg flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors motion-reduce:transition-none ${rowFocus}`;
</script>

{#if kind}
	<!-- It stays in view at the column's foot, over the rows scrolling under it. -->
	<section
		class="bg-duvet-sunk before:from-duvet-sunk sticky bottom-0 -mx-2.5 mt-auto px-2.5 pt-1 before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-linear-to-t before:to-transparent"
		aria-labelledby={headingId}
	>
		<h3 id={headingId} class="text-duvet-ink2 mx-1.5 mt-2 mb-1 text-[13px] font-bold select-none">
			{kind === "friends" ? "Online friends" : "In voice now"}
		</h3>

		{#key kind}
			<div class="animate-fade-in motion-reduce:animate-none">
				{#if kind === "voice" && dock}
					<div class="rounded-card bg-duvet-card shadow-duvet-raised flex flex-col gap-1.5 p-1.5">
						<button
							type="button"
							class="rounded-row hover:bg-duvet-bg/60 flex min-w-0 items-center gap-2.5 p-1 text-left transition-colors motion-reduce:transition-none {rowFocus}"
							aria-label="Open {dock.name}{dock.kind === 'room' ? ` in ${dock.place}` : ''}"
							onclick={dock.open}
						>
							{#if dock.kind === "room"}
								<span class="contents" aria-hidden="true"
									><SpaceIcon src={dock.icon} name={dock.place} size={32} /></span
								>
							{:else}
								<span
									class="bg-duvet-bg text-duvet-alive shadow-duvet-press flex size-8 shrink-0 items-center justify-center rounded-xl"
								>
									<PhoneIcon class="size-4" />
								</span>
							{/if}
							<span class="flex min-w-0 flex-1 flex-col leading-tight">
								<span class="flex min-w-0 items-center gap-1.5">
									<span class="bg-duvet-alive size-2 shrink-0 rounded-full"></span>
									<span class="text-duvet-ink truncate text-sm font-bold">{dock.name}</span>
								</span>
								<span class="text-duvet-ink2 truncate text-xs"
									>{dockNote ? `${dock.place} · ${dockNote}` : dock.place}</span
								>
							</span>
						</button>
						<div class="flex items-center gap-1 pl-1">
							<FaceStack faces={dockFaces.faces} more={dockFaces.more} ring="ring-duvet-card" label={dockFacesLabel} />
							{#if controls}
								<span class="flex-1"></span>
								<button
									type="button"
									class="{control} text-duvet-ink2 hover:text-duvet-danger"
									aria-label={dock.kind === "call" ? "Leave call" : "Leave voice"}
									onclick={disconnectVoice}
								>
									<PhoneDisconnectIcon class="size-4" />
								</button>
							{/if}
						</div>
					</div>
				{:else if kind === "rooms"}
					<ul class="flex flex-col gap-px">
						{#each liveRooms as { guild, channel, people } (channel.id)}
							{@const stack = capFaces(people, NOW_ROOM_FACES)}
							<li>
								<button
									type="button"
									class="rounded-row hover:bg-duvet-card/70 flex h-10 w-full items-center gap-2 px-1.5 text-left transition-colors motion-reduce:transition-none {rowFocus}"
									aria-label={voiceRoomLabel(channel.name, guild.name, people.length)}
									title="{channel.name} in {guild.name}"
									onclick={() => onRoomSelect(guild.id, channel.id)}
								>
									<span class="contents" aria-hidden="true"
										><SpaceIcon src={guild.icon_url || null} name={guild.name} size={28} /></span
									>
									<span class="bg-duvet-alive size-2 shrink-0 rounded-full"></span>
									<span class="text-duvet-ink min-w-0 flex-1 truncate text-sm font-semibold">{channel.name}</span>
									<FaceStack
										faces={stack.faces.map((u) => ({ id: u.id, src: u.avatar_url, name: u.username }))}
										more={stack.more}
										ring="ring-duvet-sunk"
									/>
								</button>
							</li>
						{/each}
					</ul>
				{:else if kind === "friends"}
					<ul class="flex items-center gap-1 px-1.5 pt-0.5 pb-1">
						{#each friendFaces.faces as friend (friend.id)}
							<li class="shrink-0">
								<button
									type="button"
									class="relative block rounded-full {roundFocus}"
									aria-label="Message {friend.name}"
									title={friend.name}
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
			</div>
		{/key}
	</section>
{/if}
