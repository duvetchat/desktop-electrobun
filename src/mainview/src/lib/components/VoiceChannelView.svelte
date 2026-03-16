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
	} from "$lib/stores.svelte";
	import { sendEventMessage } from "$lib/api/ws/connection";
	import {
		LoaderCircle,
		Mic,
		MicOff,
		Headphones,
		PhoneOff,
		MonitorUp,
		Volume2,
	} from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";

	let {
		channelId,
		channelName,
		spaceId,
	}: {
		channelId: string;
		channelName: string;
		spaceId: string;
	} = $props();

	const isConnected = $derived($activeVoiceRoomId === channelId);

	const voiceUsers = $derived.by(() => {
		const space = $gatewaySpaces.find((s) => s.id === spaceId);
		const voiceStates = space?.voice_states?.filter((vs) => vs.room_id === channelId) ?? [];
		// always show self while connected even before gateway update
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
		$activeVoiceRoomId = null;
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

<div class="flex flex-col flex-1 min-h-0 bg-[linear-gradient(180deg,oklch(0.205_0.01_80),oklch(0.18_0.008_80))]">
	<!-- Header -->
	<div class="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
		<Volume2 class="size-4 text-zinc-400 shrink-0" />
		<h2 class="font-semibold text-zinc-100 truncate">{channelName}</h2>
		{#if isConnected}
			<span class="ml-auto shrink-0 text-xs text-stone-400 font-medium bg-stone-500/10 px-2 py-0.5 rounded-full">
				Conectado
			</span>
		{/if}
	</div>

	<!-- Video / Users grid -->
	<div class="flex-1 min-h-0 overflow-y-auto p-4">
		{#if voiceUsers.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-3 text-zinc-500 select-none">
				<Volume2 class="size-12 opacity-20" />
				<p class="text-sm">Nadie conectado</p>
				{#if !isConnected}
					<p class="text-xs opacity-60">Únete para empezar</p>
				{/if}
			</div>
		{:else}
			<div class="{voiceUsers.length === 1 ? 'flex flex-col h-full' : focusedUserId ? 'flex flex-row flex-wrap content-start gap-4' : 'grid gap-4 content-start'}" style="{!focusedUserId && voiceUsers.length !== 1 ? 'grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))' : ''}">
				{#each voiceUsers as user (user.id)}
					{@const isLocal = user.id === $currentUser?.id}
					{@const videoStream = isLocal ? $voiceLocalVideoStream : $voiceRemoteVideoStreams[user.id]}
					{@const isSpeaking = $speakingUsers.has(user.id) && !user.muted}

					<div
						class="relative flex items-center justify-center overflow-hidden rounded-lg border bg-zinc-800/70 shadow-lg cursor-pointer transition-all {voiceUsers.length === 1 ? 'flex-1 min-h-0 w-full' : focusedUserId === user.id ? 'w-full h-[60vh] order-first' : focusedUserId ? 'w-64 h-48 shrink-0' : 'h-48'} {isSpeaking ? 'border-transparent ring-2 ring-inset ring-stone-400' : 'border-zinc-700 hover:border-zinc-500'}"
						role="button"
						tabindex="0"
						onclick={() => (focusedUserId = focusedUserId === user.id ? null : user.id)}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusedUserId = focusedUserId === user.id ? null : user.id; } }}
					>
						{#if videoStream}
							<video
								use:srcObject={videoStream}
								autoplay
								playsinline
								muted={isLocal}
								class="w-full h-full object-contain backdrop-blur-md transition-opacity duration-300 {videoPlayingStates[user.id] ? 'opacity-100' : 'opacity-0'}"
								onplaying={() => (videoPlayingStates = { ...videoPlayingStates, [user.id]: true })}
								onwaiting={() => (videoPlayingStates = { ...videoPlayingStates, [user.id]: false })}
							>
								<track kind="captions" srclang="en" label="captions" />
							</video>
							{#if !videoPlayingStates[user.id]}
								<div class="absolute inset-0 flex items-center justify-center bg-black/60 z-10 rounded-lg">
									<LoaderCircle class="size-8 animate-spin text-zinc-300" />
								</div>
							{/if}
						{:else}
							<div class="flex items-center justify-center">
								<UserAvatar src={user.avatar_url} name={user.username} size={80} />
							</div>
						{/if}

						<!-- Name label -->
						<div class="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded-md flex items-center gap-1.5 text-white backdrop-blur-md">
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
	<div class="shrink-0 flex items-center justify-center gap-2 px-4 py-4 border-t border-zinc-800">
		{#if isConnected}
			<button
				class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
				onclick={() => screenShareRequested.set(true)}
				title="Transmitir pantalla"
			>
				<MonitorUp class="size-5" />
				<span class="text-xxs text-zinc-400">Transmitir</span>
			</button>
			<button
				class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 transition-colors {$isMuted ? 'text-red-400 bg-red-500/10 hover:bg-red-500/20' : 'text-zinc-300 hover:bg-zinc-800'}"
				onclick={toggleMute}
				title={$isMuted ? "Activar micrófono" : "Silenciar"}
			>
				{#if $isMuted}
					<MicOff class="size-5" />
				{:else}
					<Mic class="size-5" />
				{/if}
				<span class="text-xxs {$isMuted ? 'text-red-400' : 'text-zinc-400'}">{$isMuted ? "Silenciado" : "Micro"}</span>
			</button>
			<button
				class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 transition-colors {$isDeafened ? 'text-red-400 bg-red-500/10 hover:bg-red-500/20' : 'text-zinc-300 hover:bg-zinc-800'}"
				onclick={toggleDeafen}
				title={$isDeafened ? "Dejar de ensordecer" : "Ensordecer"}
			>
				<Headphones class="size-5" />
				<span class="text-xxs {$isDeafened ? 'text-red-400' : 'text-zinc-400'}">{$isDeafened ? "Deafened" : "Audio"}</span>
			</button>
			<button
				class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
				onclick={leave}
				title="Leave voice channel"
			>
				<PhoneOff class="size-5" />
				<span class="text-xxs text-red-400">Leave</span>
			</button>
		{:else}
			<button
				class="flex items-center gap-2 rounded-xl bg-stone-600 hover:bg-stone-500 text-white font-semibold px-6 py-3 transition-colors"
				onclick={join}
			>
				<Volume2 class="size-5" />
				Join channel
			</button>
		{/if}
	</div>
</div>
