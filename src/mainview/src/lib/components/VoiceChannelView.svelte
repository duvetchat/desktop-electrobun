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
	} from "$lib/stores.svelte";
	import { sendEventMessage } from "$lib/api/ws/connection";
	import { LoaderCircle, Mic, MicOff, Headphones, Phone, PhoneOff, MonitorUp, Volume2 } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";

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
					avatar_url: me.avatar ?? null,
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
				avatar_url: user?.avatar ?? null,
				muted: vs.muted ?? false,
				deafened: vs.deafened ?? false,
				screen_sharing: vs.screen_sharing ?? false,
			};
		});
		if (me && isConnected && !list.some((u) => u.id === me.id)) {
			list.push({
				id: me.id,
				username: me.alias ?? me.username ?? "Me",
				avatar_url: me.avatar ?? null,
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
				class={voiceUsers.length === 1
					? "flex h-full flex-col"
					: focusedUserId
						? "flex flex-row flex-wrap content-start gap-4"
						: "grid content-start gap-4"}
				style={!focusedUserId && voiceUsers.length !== 1
					? "grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))"
					: ""}
			>
				{#each voiceUsers as user (user.id)}
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
								<button
									class="absolute top-2 right-2 z-20 flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-zinc-300 opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:bg-red-600/80 hover:text-white"
									onclick={(e) => {
										e.stopPropagation();
										videoAccepted = { ...videoAccepted, [user.id]: false };
										videoPlayingStates = { ...videoPlayingStates, [user.id]: false };
									}}
								>
									<PhoneOff class="size-3" />
									Stop watching
								</button>
							{/if}
						{:else if videoStream && !isLocal}
							<!-- Remote user is sharing but viewer hasn't accepted -->
							<div class="flex flex-col items-center justify-center gap-3">
								<UserAvatar src={user.avatar_url} name={user.username} size={64} mouthOpen={$userAmplitudes[user.id] ?? 0} />
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
								<UserAvatar src={user.avatar_url} name={user.username} size={80} mouthOpen={$userAmplitudes[user.id] ?? 0} />
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
			<button
				class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 text-zinc-300 transition-colors hover:bg-zinc-800"
				onclick={() => screenShareRequested.set(true)}
				title="Share screen"
			>
				<MonitorUp class="size-5" />
				<span class="text-xxs text-zinc-400">Stream</span>
			</button>
			<button
				class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 transition-colors {$isMuted
					? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
					: 'text-zinc-300 hover:bg-zinc-800'}"
				onclick={toggleMute}
				title={$isMuted ? "Unmute" : "Mute"}
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
