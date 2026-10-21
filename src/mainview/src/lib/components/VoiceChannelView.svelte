<script lang="ts">
	import {
		activeVoiceRoomId,
		speakingUsers,
		isMuted,
		isDeafened,
		screenShareRequested,
		gatewaySpaces,
		voiceRemoteVideoStreams,
		voiceLocalVideoStream,
		currentUser,
		isScreenSharing,
		callVoiceStates,
		userAmplitudes,
		voiceFaces,
	} from "$lib/stores.svelte";
	import { sendEventMessage } from "$lib/api/ws/connection";
	import { getAvatarURL } from "$lib/common/common";
	import { LoaderCircle, Mic, MicOff, Headphones, Phone, PhoneOff, MonitorUp, Volume2 } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { hasPermission, Permission } from "$lib/permissions";

	let {
		channelId,
		channelName,
		spaceId = "",
		callMode = false,
		callMembers = [],
		onHangUp = undefined,
	}: {
		channelId: string;
		channelName: string;
		spaceId?: string;
		callMode?: boolean;
		callMembers?: { id: string; username: string; avatar_url: string | null }[];
		onHangUp?: () => void;
	} = $props();

	const isConnected = $derived(callMode || $activeVoiceRoomId === channelId);
	// Without SpeakInVoice the mic stays muted: UserStatusBar mutes it when the permission goes.
	const canSpeak = $derived.by(() => {
		if (callMode) return true;
		const space = $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === channelId));
		const room = space?.rooms.find((r) => r.id === channelId);
		return space && room ? hasPermission(space, room, Permission.SpeakInVoice) : true;
	});

	const voiceUsers = $derived.by(() => {
		if (callMode) {
			const states = $callVoiceStates.filter((vs) => vs.room_id === channelId);
			const me = $currentUser;
			const list = states.map((vs) => {
				const member = callMembers.find((m) => m.id === vs.user_id);
				const isMe = me && vs.user_id === me.id;
				return {
					id: vs.user_id,
					username: member?.username ?? vs.user_id.slice(0, 8),
					avatar_url: member?.avatar_url ?? null,
					muted: isMe ? $isMuted : (vs.muted ?? false),
					deafened: isMe ? $isDeafened : (vs.deafened ?? false),
					screen_sharing: isMe ? $isScreenSharing : (vs.screen_sharing ?? false),
				};
			});
			if (me && isConnected && !list.some((u) => u.id === me.id)) {
				list.push({
					id: me.id,
					username: me.alias ?? me.username ?? "Me",
					avatar_url: getAvatarURL(me.id, me.avatar),
					muted: $isMuted,
					deafened: $isDeafened,
					screen_sharing: $isScreenSharing,
				});
			}
			return list;
		}

		const space = $gatewaySpaces.find((s) => s.id === spaceId);
		const voiceStates = space?.voice_states?.filter((vs) => vs.room_id === channelId) ?? [];
		const me = $currentUser;
		const list = voiceStates.map((vs) => {
			const user = space?.users.find((u) => u.id === vs.user_id);
			return {
				id: vs.user_id,
				username: user?.alias ?? user?.username ?? "Unknown",
				avatar_url: user ? getAvatarURL(user.id, user.avatar) : null,
				muted: vs.muted ?? false,
				deafened: vs.deafened ?? false,
				screen_sharing: vs.screen_sharing ?? false,
			};
		});
		if (me && isConnected && !list.some((u) => u.id === me.id)) {
			list.push({
				id: me.id,
				username: me.alias ?? me.username ?? "Me",
				avatar_url: getAvatarURL(me.id, me.avatar),
				muted: $isMuted,
				deafened: $isDeafened,
				screen_sharing: $isScreenSharing,
			});
		}
		return list;
	});

	let videoPlayingStates = $state<Record<string, boolean>>({});
	let videoAccepted = $state<Record<string, boolean>>({});
	let focusedUserId = $state<string | null>(null);
	let showStreamMenu = $state(false);
	let streamVolumes = $state<Record<string, number>>({});
	let videoRefs = $state<Record<string, HTMLVideoElement>>({});

	// Sync volume to video elements
	$effect(() => {
		for (const [uid, vol] of Object.entries(streamVolumes)) {
			if (videoRefs[uid]) videoRefs[uid].volume = vol;
		}
	});

	// Track grid columns for eye gaze direction
	let gridEl = $state<HTMLDivElement | null>(null);
	let gridCols = $state(2);

	$effect(() => {
		if (!gridEl) return;
		const observer = new ResizeObserver(() => {
			if (!gridEl) return;
			const computed = getComputedStyle(gridEl);
			const cols = computed.gridTemplateColumns.split(" ").filter((s) => s !== "").length;
			gridCols = Math.max(1, cols);
		});
		observer.observe(gridEl);
		return () => observer.disconnect();
	});

	// Track the last speaking user for eye gaze
	let lastSpeakerId = $state<string | null>(null);

	$effect(() => {
		const speaking = voiceUsers.filter((u) => $speakingUsers.has(u.id));
		if (speaking.length > 0) {
			lastSpeakerId = speaking[speaking.length - 1].id;
		} else {
			lastSpeakerId = null;
		}
	});

	// Reactive eye offsets — recomputed when lastSpeakerId, voiceUsers, or gridCols change
	const eyeOffsets = $derived.by(() => {
		const offsets: Record<string, { x: number; y: number }> = {};
		const cols = gridCols;
		const speakerIndex = lastSpeakerId ? voiceUsers.findIndex((u) => u.id === lastSpeakerId) : -1;

		for (let i = 0; i < voiceUsers.length; i++) {
			const user = voiceUsers[i];
			if (!lastSpeakerId || lastSpeakerId === user.id || speakerIndex === -1) {
				offsets[user.id] = { x: 0, y: 0 };
				continue;
			}

			const myCol = i % cols;
			const myRow = Math.floor(i / cols);
			const spCol = speakerIndex % cols;
			const spRow = Math.floor(speakerIndex / cols);

			const dx = spCol - myCol;
			const dy = spRow - myRow;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist === 0) {
				offsets[user.id] = { x: 0, y: 0 };
			} else {
				offsets[user.id] = { x: Math.max(-1, Math.min(1, dx / dist)), y: Math.max(-1, Math.min(1, dy / dist)) };
			}
		}
		return offsets;
	});

	function srcObject(node: HTMLVideoElement, stream: MediaStream) {
		node.srcObject = stream;
		return {
			update(newStream: MediaStream) {
				if (node.srcObject !== newStream) node.srcObject = newStream;
			},
		};
	}

	function join() {
		$activeVoiceRoomId = channelId;
	}

	function leave() {
		if (callMode && onHangUp) {
			onHangUp();
		} else {
			$activeVoiceRoomId = null;
		}
	}

	function toggleMute() {
		if (!canSpeak) return;
		isMuted.update((m) => !m);
		if ($activeVoiceRoomId) {
			sendEventMessage("VOICE_SYNC", {
				room_id: $activeVoiceRoomId,
				muted: $isMuted,
				deafened: $isDeafened,
				screen_sharing: $isScreenSharing,
			});
		}
	}

	function toggleDeafen() {
		isDeafened.update((d) => !d);
		if ($isDeafened) isMuted.set(true);
		if ($activeVoiceRoomId) {
			sendEventMessage("VOICE_SYNC", {
				room_id: $activeVoiceRoomId,
				muted: $isMuted,
				deafened: $isDeafened,
				screen_sharing: $isScreenSharing,
			});
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,oklch(0.205_0.01_80),oklch(0.18_0.008_80))]">
	<!-- Header -->
	<div class="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-4 py-3">
		{#if callMode}
			<Phone class="size-4 shrink-0 text-emerald-400" />
		{:else}
			<Volume2 class="size-4 shrink-0 text-zinc-400" />
		{/if}
		<h2 class="truncate font-semibold text-zinc-100">{channelName}</h2>
		{#if isConnected}
			<span class="ml-auto shrink-0 rounded-full bg-stone-500/10 px-2 py-0.5 text-xs font-medium text-stone-400">
				Connected
			</span>
		{/if}
	</div>

	<!-- Video / Users grid -->
	<div class="min-h-0 flex-1 overflow-y-auto p-4">
		{#if voiceUsers.length === 0}
			<div class="flex h-full flex-col items-center justify-center gap-3 text-zinc-500 select-none">
				<Volume2 class="size-12 opacity-20" />
				<p class="text-sm">No one connected</p>
				{#if !isConnected}
					<p class="text-xs opacity-60">Join to start</p>
				{/if}
			</div>
		{:else}
			<div
				bind:this={gridEl}
				class={voiceUsers.length === 1
					? "flex h-full flex-col"
					: focusedUserId
						? "flex flex-row flex-wrap content-start gap-4"
						: "grid content-start gap-4"}
				style={!focusedUserId && voiceUsers.length !== 1
					? "grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))"
					: ""}
			>
				{#each voiceUsers as user, idx (user.id)}
					{@const isLocal = user.id === $currentUser?.id}
					{@const videoStream = isLocal ? $voiceLocalVideoStream : $voiceRemoteVideoStreams[user.id]}
					{@const isSpeaking = $speakingUsers.has(user.id) && !user.muted}

					<div
						class="group relative flex cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-zinc-800/70 shadow-lg transition-all {voiceUsers.length ===
						1
							? 'min-h-0 w-full flex-1'
							: focusedUserId === user.id
								? 'order-first h-[60vh] w-full'
								: focusedUserId
									? 'h-48 w-64 shrink-0'
									: 'h-48'} {isSpeaking
							? 'border-transparent ring-2 ring-stone-400 ring-inset'
							: 'border-zinc-700 hover:border-zinc-500'}"
						role="button"
						tabindex="0"
						onclick={() => (focusedUserId = focusedUserId === user.id ? null : user.id)}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								focusedUserId = focusedUserId === user.id ? null : user.id;
							}
						}}
					>
						{#if videoStream && (isLocal || videoAccepted[user.id])}
							<video
								bind:this={videoRefs[user.id]}
								use:srcObject={videoStream}
								autoplay
								playsinline
								muted={isLocal}
								class="h-full w-full object-contain backdrop-blur-md transition-opacity duration-300 {videoPlayingStates[
									user.id
								]
									? 'opacity-100'
									: 'opacity-0'}"
								onplaying={() => (videoPlayingStates = { ...videoPlayingStates, [user.id]: true })}
								onwaiting={() => (videoPlayingStates = { ...videoPlayingStates, [user.id]: false })}
							>
								<track kind="captions" srclang="en" label="captions" />
							</video>
							{#if !videoPlayingStates[user.id]}
								<div class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/60">
									<LoaderCircle class="size-8 animate-spin text-zinc-300" />
								</div>
							{/if}
							{#if !isLocal}
								<div
									class="absolute top-2 right-2 z-20 flex items-center gap-2 opacity-0 transition-all group-hover:opacity-100"
								>
									<div class="flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 backdrop-blur-sm">
										<Volume2 class="size-3 text-zinc-400" />
										<input
											type="range"
											min="0"
											max="1"
											step="0.01"
											value={streamVolumes[user.id] ?? 1}
											oninput={(e) =>
												(streamVolumes = {
													...streamVolumes,
													[user.id]: parseFloat((e.currentTarget as HTMLInputElement).value),
												})}
											class="h-1 w-16 cursor-pointer accent-white"
										/>
									</div>
									<button
										class="flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-zinc-300 backdrop-blur-sm transition-colors hover:bg-red-600/80 hover:text-white"
										onclick={(e) => {
											e.stopPropagation();
											videoAccepted = { ...videoAccepted, [user.id]: false };
											videoPlayingStates = { ...videoPlayingStates, [user.id]: false };
										}}
									>
										<PhoneOff class="size-3" />
										Stop
									</button>
								</div>
							{/if}
						{:else if videoStream && !isLocal}
							<!-- Remote user is sharing but viewer hasn't accepted -->
							<div class="flex flex-col items-center justify-center gap-3">
								<UserAvatar
									src={$voiceFaces ? null : user.avatar_url}
									name={user.username}
									size={64}
									mouthOpen={$userAmplitudes[user.id] ?? 0}
									eyeOffset={eyeOffsets[user.id] ?? { x: 0, y: 0 }}
								/>
								<button
									class="flex items-center gap-2 rounded-lg bg-stone-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-500"
									onclick={(e) => {
										e.stopPropagation();
										videoAccepted = { ...videoAccepted, [user.id]: true };
									}}
								>
									<MonitorUp class="size-4" />
									Watch stream
								</button>
							</div>
						{:else}
							<div class="flex items-center justify-center">
								<UserAvatar
									src={$voiceFaces ? null : user.avatar_url}
									name={user.username}
									size={80}
									mouthOpen={$userAmplitudes[user.id] ?? 0}
									eyeOffset={eyeOffsets[user.id] ?? { x: 0, y: 0 }}
								/>
							</div>
						{/if}

						<!-- Name label -->
						<div
							class="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-white backdrop-blur-md"
						>
							{#if user.deafened}
								<Headphones class="size-3.5 text-red-400" />
							{:else if user.muted}
								<MicOff class="size-3.5 text-red-400" />
							{/if}
							{#if videoStream || user.screen_sharing}
								<MonitorUp class="size-3.5 text-blue-400" />
							{/if}
							<span class="text-xs font-medium">{user.username}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Controls -->
	<div class="flex shrink-0 items-center justify-center gap-2 border-t border-zinc-800 px-4 py-4">
		{#if isConnected}
			<div class="relative">
				<button
					class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 text-zinc-300 transition-colors hover:bg-zinc-800"
					onclick={() => (showStreamMenu = !showStreamMenu)}
					title="Share screen"
				>
					<MonitorUp class="size-5" />
					<span class="text-xxs text-zinc-400">Stream</span>
				</button>
				{#if showStreamMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl"
						onmouseleave={() => (showStreamMenu = false)}
					>
						<button
							class="flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap text-zinc-200 transition-colors hover:bg-zinc-700"
							onclick={() => {
								showStreamMenu = false;
								screenShareRequested.set({ active: true, withAudio: false });
							}}
						>
							<MonitorUp class="size-4" />
							Screen only
						</button>
						<button
							class="flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap text-zinc-200 transition-colors hover:bg-zinc-700"
							onclick={() => {
								showStreamMenu = false;
								screenShareRequested.set({ active: true, withAudio: true });
							}}
						>
							<Volume2 class="size-4" />
							Screen + Audio
						</button>
					</div>
				{/if}
			</div>
			<button
				class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 transition-colors {$isMuted
					? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
					: 'text-zinc-300 hover:bg-zinc-800'}"
				class:opacity-50={!canSpeak}
				class:cursor-not-allowed={!canSpeak}
				disabled={!canSpeak}
				onclick={toggleMute}
				title={!canSpeak ? "You can't speak in this room" : $isMuted ? "Unmute" : "Mute"}
			>
				{#if $isMuted}
					<MicOff class="size-5" />
				{:else}
					<Mic class="size-5" />
				{/if}
				<span class="text-xxs {$isMuted ? 'text-red-400' : 'text-zinc-400'}">{$isMuted ? "Muted" : "Mic"}</span>
			</button>
			<button
				class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 transition-colors {$isDeafened
					? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
					: 'text-zinc-300 hover:bg-zinc-800'}"
				onclick={toggleDeafen}
				title={$isDeafened ? "Undeafen" : "Deafen"}
			>
				<Headphones class="size-5" />
				<span class="text-xxs {$isDeafened ? 'text-red-400' : 'text-zinc-400'}"
					>{$isDeafened ? "Deafened" : "Audio"}</span
				>
			</button>
			<button
				class="flex flex-col items-center gap-1 rounded-xl bg-red-500/10 px-4 py-2.5 text-red-400 transition-colors hover:bg-red-500/20"
				onclick={leave}
				title="Leave voice channel"
			>
				<PhoneOff class="size-5" />
				<span class="text-xxs text-red-400">Leave</span>
			</button>
		{:else}
			<button
				class="flex items-center gap-2 rounded-xl bg-stone-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-stone-500"
				onclick={join}
			>
				<Volume2 class="size-5" />
				Join channel
			</button>
		{/if}
	</div>
</div>
