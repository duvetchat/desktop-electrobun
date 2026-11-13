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
		isCameraOn,
		cameraRequested,
		incomingVideo,
		selectedCameraId,
		voiceLocalCameraStream,
		voiceRemoteCameraStreams,
		watchedStreams,
		watchingNow,
	} from "$lib/stores.svelte";
	import { toggleDeafen, toggleMute as toggleMic } from "$lib/voice";
	import type { VoicePerson } from "$lib/voice-place";
	import { startWatching, stopWatching, viewersOf } from "$lib/watching";
	import { getAvatarURL } from "$lib/common/common";
	import {
		Check,
		ChevronUp,
		LoaderCircle,
		Mic,
		MicOff,
		Headphones,
		Lock,
		Phone,
		PhoneOff,
		MonitorUp,
		Video,
		VideoOff,
		Volume2,
	} from "@lucide/svelte";
	import { DropdownMenu } from "bits-ui";
	import StreamViewers from "$lib/components/StreamViewers.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { hasPermission, Permission } from "$lib/permissions";

	let {
		channelId,
		channelName,
		spaceId = "",
		callMode = false,
		callMembers = [],
		onHangUp = undefined,
		showHeader = true,
	}: {
		channelId: string;
		channelName: string;
		spaceId?: string;
		callMode?: boolean;
		callMembers?: { id: string; username: string; avatar_url: string | null }[];
		onHangUp?: () => void;
		/** Off in a pane, whose bar names the room in its tab and says whether it's connected. */
		showHeader?: boolean;
	} = $props();

	const NO_VIDEO = "You can't use video in this room";
	const NO_VOICE = "You're not connected to voice";

	const isConnected = $derived(callMode || $activeVoiceRoomId === channelId);
	// The space room this is; a call has none, and asks for no permission.
	const voiceRoom = $derived.by(() => {
		if (callMode) return null;
		const space = $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === channelId));
		const room = space?.rooms.find((r) => r.id === channelId);
		return space && room ? { space, room } : null;
	});
	// This client's VoiceChat has this room's or call's connection: routes/app/+page.svelte mounts it for a room the
	// spaces have, or for the call. The controls can show without it: a call's a moment before it's mounted, and
	// after it's gone (its connection failed, or another session took the voice over) while the call lasts; a room's
	// in a tab left open on a room that's gone. A camera or screen request made then has no VoiceChat to take it.
	const voiceLive = $derived($activeVoiceRoomId === channelId && (callMode || voiceRoom !== null));
	// The gateway lets a member join with ViewChannels and JoinVoice in the room (voiceAccess) and refuses anyone else,
	// unanswered: without them the room is locked here, as ChannelsSidebar locks it.
	const canJoin = $derived(
		!voiceRoom || hasPermission(voiceRoom.space, voiceRoom.room, Permission.ViewChannels | Permission.JoinVoice),
	);
	// Without SpeakInVoice the mic stays muted: UserStatusBar mutes it when the permission goes.
	const canSpeak = $derived(!voiceRoom || hasPermission(voiceRoom.space, voiceRoom.room, Permission.SpeakInVoice));
	// Video is the camera and the screen.
	const canVideo = $derived(!voiceRoom || hasPermission(voiceRoom.space, voiceRoom.room, Permission.Video));
	const videoReady = $derived(voiceLive && canVideo);
	const videoTitle = $derived(!voiceLive ? NO_VOICE : !canVideo ? NO_VIDEO : null);

	const voiceUsers = $derived.by(() => {
		const me = $currentUser;
		// This client's own camera and screen, as captured: shown at once, and refused ones go off here too.
		const mine = { camera: $isCameraOn, screen_sharing: $isScreenSharing };
		if (callMode) {
			const states = $callVoiceStates.filter((vs) => vs.room_id === channelId);
			const list = states.map((vs) => {
				const member = callMembers.find((m) => m.id === vs.user_id);
				const isMe = me && vs.user_id === me.id;
				return {
					id: vs.user_id,
					username: member?.username ?? vs.user_id.slice(0, 8),
					avatar_url: member?.avatar_url ?? null,
					muted: isMe ? $isMuted : (vs.muted ?? false),
					deafened: isMe ? $isDeafened : (vs.deafened ?? false),
					screen_sharing: isMe ? mine.screen_sharing : (vs.screen_sharing ?? false),
					camera: isMe ? mine.camera : (vs.camera ?? false),
					watching: vs.watching ?? [],
				};
			});
			if (me && isConnected && !list.some((u) => u.id === me.id)) {
				list.push({
					id: me.id,
					username: me.alias ?? me.username ?? "Me",
					avatar_url: getAvatarURL(me.id, me.avatar),
					muted: $isMuted,
					deafened: $isDeafened,
					...mine,
					watching: [],
				});
			}
			return list;
		}

		const space = $gatewaySpaces.find((s) => s.id === spaceId);
		const voiceStates = space?.voice_states?.filter((vs) => vs.room_id === channelId) ?? [];
		const list = voiceStates.map((vs) => {
			const user = space?.users.find((u) => u.id === vs.user_id);
			const isMine = isConnected && vs.user_id === me?.id;
			return {
				id: vs.user_id,
				username: user?.alias ?? user?.username ?? "Unknown",
				avatar_url: user ? getAvatarURL(user.id, user.avatar) : null,
				muted: vs.muted ?? false,
				deafened: vs.deafened ?? false,
				screen_sharing: isMine ? mine.screen_sharing : (vs.screen_sharing ?? false),
				camera: isMine ? mine.camera : (vs.camera ?? false),
				watching: vs.watching ?? [],
			};
		});
		if (me && isConnected && !list.some((u) => u.id === me.id)) {
			list.push({
				id: me.id,
				username: me.alias ?? me.username ?? "Me",
				avatar_url: getAvatarURL(me.id, me.avatar),
				muted: $isMuted,
				deafened: $isDeafened,
				...mine,
				watching: [],
			});
		}
		return list;
	});

	// Who watches a screen share here, as its eye lists them (desktop#299); the user too, while they watch it in the
	// voice they're in, before the gateway's echo of it (and not while their incoming video is off).
	function viewersOfScreen(sharerId: string): VoicePerson[] {
		const me = isConnected && $currentUser ? { id: $currentUser.id, watching: $watchingNow } : null;
		const states = voiceUsers.map((u) => ({ user_id: u.id, watching: u.watching }));
		return viewersOf(sharerId, states, me).map((id) => {
			const user = voiceUsers.find((u) => u.id === id);
			return { id, name: user?.username ?? "Unknown", src: user?.avatar_url ?? null };
		});
	}

	type VoiceUser = (typeof voiceUsers)[number];
	type Tile = { key: string; kind: "person" | "screen"; user: VoiceUser };

	// A tile per person, with their camera or their face, and one more for each screen being shared.
	const tiles = $derived(
		voiceUsers.flatMap((user): Tile[] => {
			const person: Tile = { key: user.id, kind: "person", user };
			return user.screen_sharing ? [person, { key: `${user.id}:screen`, kind: "screen", user }] : [person];
		}),
	);

	// Videos that have shown a frame, by tile: until then the tile shows the face or a loader.
	let playing = $state<Record<string, boolean>>({});
	let focusedKey = $state<string | null>(null);
	// A focused tile that's gone (its person left, or stopped sharing) leaves the grid as it was.
	const focused = $derived(focusedKey && tiles.some((t) => t.key === focusedKey) ? focusedKey : null);
	let showStreamMenu = $state(false);
	let cameras = $state<MediaDeviceInfo[]>([]);

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

	// Reactive eye offsets: each face looks toward the speaker's tile, by where the tiles sit in the grid.
	const eyeOffsets = $derived.by(() => {
		const offsets: Record<string, { x: number; y: number }> = {};
		const cols = gridCols;
		const speakerIndex = lastSpeakerId
			? tiles.findIndex((t) => t.kind === "person" && t.user.id === lastSpeakerId)
			: -1;

		tiles.forEach((tile, i) => {
			if (tile.kind !== "person") return;
			const id = tile.user.id;
			if (speakerIndex === -1 || lastSpeakerId === id) {
				offsets[id] = { x: 0, y: 0 };
				return;
			}

			const myCol = i % cols;
			const myRow = Math.floor(i / cols);
			const spCol = speakerIndex % cols;
			const spRow = Math.floor(speakerIndex / cols);

			const dx = spCol - myCol;
			const dy = spRow - myRow;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist === 0) {
				offsets[id] = { x: 0, y: 0 };
			} else {
				offsets[id] = { x: Math.max(-1, Math.min(1, dx / dist)), y: Math.max(-1, Math.min(1, dy / dist)) };
			}
		});
		return offsets;
	});

	// Alone in a room, a tile fills the view. A call has no height of its own to fill (half the conversation at
	// most): its tiles are a grid of small 16:9 ones, even alone.
	const fills = $derived(!callMode && tiles.length === 1);

	// Focused, a tile is big above the others; else they're a grid of 16:9 tiles.
	function tileSize(key: string): string {
		if (fills) return "min-h-0 w-full flex-1";
		if (focused === key) return "order-first h-[60vh] w-full";
		if (focused) return "aspect-video w-64 shrink-0";
		return "aspect-video";
	}

	// A camera fills its 16:9 tile; a big one shows whole.
	function cameraFit(key: string): string {
		return fills || focused === key ? "object-contain" : "object-cover";
	}

	function toggleFocus(key: string) {
		focusedKey = focused === key ? null : key;
	}

	function srcObject(node: HTMLVideoElement, stream: MediaStream) {
		node.srcObject = stream;
		return {
			update(newStream: MediaStream) {
				if (node.srcObject !== newStream) node.srcObject = newStream;
			},
		};
	}

	function setPlaying(key: string, value: boolean) {
		if ((playing[key] ?? false) !== value) playing = { ...playing, [key]: value };
	}

	/** Notes when a tile's video has frames to show, and forgets it when the video goes. */
	function trackPlaying(node: HTMLVideoElement, key: string) {
		const onPlaying = () => setPlaying(key, true);
		const onStalled = () => setPlaying(key, false);
		node.addEventListener("playing", onPlaying);
		node.addEventListener("waiting", onStalled);
		node.addEventListener("emptied", onStalled);
		return {
			destroy() {
				node.removeEventListener("playing", onPlaying);
				node.removeEventListener("waiting", onStalled);
				node.removeEventListener("emptied", onStalled);
				setPlaying(key, false);
			},
		};
	}

	function join() {
		if (!canJoin) return;
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
		toggleMic();
	}

	function toggleCamera() {
		if (!videoReady) return;
		cameraRequested.set({ roomId: channelId, on: !$isCameraOn });
	}

	/** The cameras for the menu. Before the camera permission is given they have no names, so it's asked for
	 * first, as the mic menu does. */
	async function loadCameras() {
		try {
			const list = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
			cameras = await list();
			if (cameras.length > 0 && !cameras[0].label) {
				const stream = await navigator.mediaDevices.getUserMedia({ video: true });
				stream.getTracks().forEach((t) => t.stop());
				cameras = await list();
			}
		} catch (err) {
			console.error("[Voice] Couldn't list the cameras:", err);
		}
	}

	// The camera in use, else the one picked, else the system's default (the first).
	const activeCameraId = $derived(
		$voiceLocalCameraStream?.getVideoTracks().at(0)?.getSettings().deviceId ||
			$selectedCameraId ||
			cameras.at(0)?.deviceId ||
			"",
	);
</script>

<div class="from-night-205 to-night-18 flex min-h-0 flex-1 flex-col bg-linear-to-b">
	<!-- Header -->
	{#if showHeader}
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
	{/if}

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
				class={fills
					? "flex h-full flex-col"
					: focused
						? "flex flex-row flex-wrap content-start gap-4"
						: callMode
							? "grid grid-cols-[repeat(auto-fit,minmax(200px,300px))] content-start justify-center gap-4"
							: "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] content-start gap-4"}
			>
				{#each tiles as tile (tile.key)}
					{@const user = tile.user}
					<!-- This client's own tiles show its own capture; another session of the same user's is remote. -->
					{@const isLocal = isConnected && user.id === $currentUser?.id}
					{@const isSpeaking = $speakingUsers.has(user.id) && !user.muted}

					<div
						class="group relative flex cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-zinc-800/70 shadow-lg transition-all {tileSize(
							tile.key,
						)} {isSpeaking ? 'border-transparent' : 'border-zinc-700 hover:border-zinc-500'}"
						role="button"
						tabindex="0"
						aria-label={tile.kind === "screen" ? `${user.username}'s screen` : user.username}
						onclick={() => toggleFocus(tile.key)}
						onkeydown={(e) => {
							// A button in the tile (Watch stream, Stop, the eye) takes its own keys.
							if (e.target !== e.currentTarget) return;
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								toggleFocus(tile.key);
							}
						}}
					>
						{#if tile.kind === "person"}
							{@const cameraStream = !user.camera
								? null
								: isLocal
									? $voiceLocalCameraStream
									: $incomingVideo
										? ($voiceRemoteCameraStreams[user.id] ?? null)
										: null}
							<!-- Videos are always muted: VoiceChat's <audio> plays everyone's sound. Only yours is mirrored. -->
							{#if cameraStream}
								<video
									use:srcObject={cameraStream}
									use:trackPlaying={tile.key}
									autoplay
									muted
									playsinline
									class="absolute inset-0 size-full {cameraFit(tile.key)} {isLocal ? '-scale-x-100' : ''}"
								></video>
							{/if}
							{#if !cameraStream || !playing[tile.key]}
								<div class="relative flex items-center justify-center">
									<UserAvatar
										src={$voiceFaces ? null : user.avatar_url}
										name={user.username}
										size={80}
										mouthOpen={$userAmplitudes[user.id] ?? 0}
										eyeOffset={eyeOffsets[user.id] ?? { x: 0, y: 0 }}
									/>
									{#if user.camera && !isLocal && !$incomingVideo}
										<span
											class="absolute -right-1 -bottom-1 rounded-full border border-zinc-700 bg-zinc-900 p-1.5"
											title="Camera on. Incoming video is off."
										>
											<VideoOff class="size-3.5 text-zinc-400" />
										</span>
									{/if}
								</div>
							{/if}
						{:else}
							{@const screenStream = isLocal
								? $voiceLocalVideoStream
								: $incomingVideo
									? ($voiceRemoteVideoStreams[user.id] ?? null)
									: null}
							{#if !isLocal && !$incomingVideo}
								<div class="flex flex-col items-center gap-2 text-zinc-400">
									<VideoOff class="size-6" />
									<span class="text-xs">Incoming video is off</span>
								</div>
							{:else if isLocal || (isConnected && $watchedStreams.includes(user.id))}
								{#if screenStream}
									<video
										use:srcObject={screenStream}
										use:trackPlaying={tile.key}
										autoplay
										muted
										playsinline
										class="absolute inset-0 size-full object-contain"
									></video>
								{/if}
								{#if !screenStream || !playing[tile.key]}
									<div class="absolute inset-0 flex items-center justify-center bg-black/60">
										<LoaderCircle class="size-8 animate-spin text-zinc-300" />
									</div>
								{/if}
								{#if !isLocal}
									<button
										class="hover:text-fixed-white absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-zinc-300 opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:bg-red-600/80"
										onclick={(e) => {
											e.stopPropagation();
											stopWatching(user.id);
										}}
									>
										<PhoneOff class="size-3" />
										Stop
									</button>
								{/if}
							{:else}
								<!-- Someone else shares and the user isn't watching: Watch only from the voice they're in -->
								<div class="flex flex-col items-center justify-center gap-3">
									<UserAvatar
										src={$voiceFaces ? null : user.avatar_url}
										name={user.username}
										size={64}
										mouthOpen={$userAmplitudes[user.id] ?? 0}
										eyeOffset={eyeOffsets[user.id] ?? { x: 0, y: 0 }}
									/>
									{#if isConnected}
										<button
											class="bg-fill-600 text-fixed-white hover:bg-fill-500 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
											onclick={(e) => {
												e.stopPropagation();
												startWatching(channelId, user.id);
											}}
										>
											<MonitorUp class="size-4" />
											Watch stream
										</button>
									{/if}
								</div>
							{/if}
							<div class="absolute top-2 left-2 z-10">
								<StreamViewers viewers={viewersOfScreen(user.id)} meId={$currentUser?.id} />
							</div>
						{/if}

						<!-- Name label -->
						<div
							class="text-fixed-white absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 backdrop-blur-md"
						>
							{#if tile.kind === "screen"}
								<MonitorUp class="size-3.5 shrink-0 text-blue-400" />
								<span class="truncate text-xs font-medium">{user.username}'s screen</span>
							{:else}
								{#if user.deafened}
									<Headphones class="size-3.5 shrink-0 text-red-400" />
								{:else if user.muted}
									<MicOff class="size-3.5 shrink-0 text-red-400" />
								{/if}
								<span class="truncate text-xs font-medium">{user.username}</span>
							{/if}
						</div>

						<!-- Speaking ring, above any video -->
						{#if isSpeaking}
							<div class="pointer-events-none absolute inset-0 z-20 rounded-lg ring-2 ring-stone-400 ring-inset"></div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Controls -->
	<div class="flex shrink-0 items-center justify-center gap-2 border-t border-zinc-800 px-4 py-4">
		{#if isConnected}
			<div class="flex items-stretch">
				<button
					class="flex flex-col items-center gap-1 rounded-l-xl py-2.5 pr-2 pl-4 transition-colors {$isCameraOn
						? 'bg-stone-400/20 text-stone-200 hover:bg-stone-400/30'
						: 'text-zinc-300 hover:bg-zinc-800'}"
					class:opacity-50={!videoReady}
					class:cursor-not-allowed={!videoReady}
					disabled={!videoReady}
					onclick={toggleCamera}
					title={videoTitle ?? ($isCameraOn ? "Turn off camera" : "Turn on camera")}
				>
					{#if $isCameraOn}
						<Video class="size-5" />
					{:else}
						<VideoOff class="size-5" />
					{/if}
					<span class="text-xxs {$isCameraOn ? 'text-stone-200' : 'text-zinc-400'}">Camera</span>
				</button>
				<DropdownMenu.Root
					onOpenChange={(open) => {
						if (open) void loadCameras();
					}}
				>
					<DropdownMenu.Trigger
						class="flex items-center rounded-r-xl px-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
						aria-label="Camera options"
						title="Camera options"
					>
						<ChevronUp class="size-4" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							class="z-200 w-64 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl"
							side="top"
							sideOffset={8}
						>
							<div
								class="mb-1 border-b border-zinc-700 px-3 py-1.5 text-xs font-semibold tracking-wider text-zinc-400 uppercase"
							>
								Camera
							</div>
							{#if cameras.length === 0}
								<div class="px-3 py-2 text-sm text-zinc-400">No cameras found</div>
							{:else}
								{#each cameras as camera, i (camera.deviceId || i)}
									<DropdownMenu.Item
										class="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm text-zinc-100 transition-colors outline-none hover:bg-zinc-700 data-highlighted:bg-zinc-700"
										onSelect={() => selectedCameraId.set(camera.deviceId)}
									>
										<span class="truncate">{camera.label || `Camera ${i + 1}`}</span>
										{#if camera.deviceId && camera.deviceId === activeCameraId}
											<Check class="size-4 shrink-0 text-stone-300" />
										{/if}
									</DropdownMenu.Item>
								{/each}
							{/if}
							<DropdownMenu.Separator class="my-1 h-px bg-zinc-700" />
							<DropdownMenu.CheckboxItem
								class="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm text-zinc-100 transition-colors outline-none hover:bg-zinc-700 data-highlighted:bg-zinc-700"
								checked={$incomingVideo}
								onCheckedChange={(checked) => incomingVideo.set(checked)}
								title="Off, you receive no one's camera or screen"
							>
								{#snippet children({ checked })}
									<span>Incoming video</span>
									{#if checked}
										<Check class="size-4 shrink-0 text-stone-300" />
									{/if}
								{/snippet}
							</DropdownMenu.CheckboxItem>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
			<div class="relative">
				<button
					class="flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 text-zinc-300 transition-colors hover:bg-zinc-800"
					class:opacity-50={!videoReady}
					class:cursor-not-allowed={!videoReady}
					disabled={!videoReady}
					onclick={() => (showStreamMenu = !showStreamMenu)}
					title={videoTitle ?? "Share screen"}
				>
					<MonitorUp class="size-5" />
					<span class="text-xxs text-zinc-400">Stream</span>
				</button>
				{#if showStreamMenu && videoReady}
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
								screenShareRequested.set({ roomId: channelId, withAudio: false });
							}}
						>
							<MonitorUp class="size-4" />
							Screen only
						</button>
						<button
							class="flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap text-zinc-200 transition-colors hover:bg-zinc-700"
							onclick={() => {
								showStreamMenu = false;
								screenShareRequested.set({ roomId: channelId, withAudio: true });
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
				title="Leave voice room"
			>
				<PhoneOff class="size-5" />
				<span class="text-xxs text-red-400">Leave</span>
			</button>
		{:else}
			<button
				class="bg-fill-600 text-fixed-white hover:bg-fill-500 flex items-center gap-2 rounded-xl px-6 py-3 font-semibold transition-colors"
				class:opacity-50={!canJoin}
				class:cursor-not-allowed={!canJoin}
				disabled={!canJoin}
				onclick={join}
				title={canJoin ? undefined : "You can't join this voice room"}
			>
				{#if canJoin}
					<Volume2 class="size-5" />
				{:else}
					<Lock class="size-5" />
				{/if}
				Join room
			</button>
		{/if}
	</div>
</div>
