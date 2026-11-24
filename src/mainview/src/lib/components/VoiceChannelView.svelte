<script lang="ts">
	import { untrack } from "svelte";
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
		voiceConnectionState,
	} from "$lib/stores.svelte";
	import { stopScreenShare, toggleDeafen, toggleMute as toggleMic } from "$lib/voice";
	import type { VoicePerson } from "$lib/voice-place";
	import { startWatching, stopWatching, viewersOf } from "$lib/watching";
	import { getAvatarURL } from "$lib/common/common";
	import {
		ChevronDown,
		ChevronUp,
		EyeOff,
		HeadphoneOff,
		Headphones,
		LoaderCircle,
		Lock,
		Mic,
		MicOff,
		Phone,
		PhoneCall,
		PhoneOff,
		ScreenShare,
		ScreenShareOff,
		Video,
		VideoOff,
		Volume2,
	} from "@lucide/svelte";
	import { mergeProps } from "bits-ui";
	import FaceStack from "$lib/components/FaceStack.svelte";
	import MascotPeek from "$lib/components/MascotPeek.svelte";
	import MediaButton from "$lib/components/MediaButton.svelte";
	import StreamViewers from "$lib/components/StreamViewers.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Menu from "$lib/components/ui/Menu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
	import { GLASS } from "$lib/components/ui/recipes";
	import { t } from "$lib/i18n";
	import { phaseOf, mediaTitle } from "$lib/media-state";
	import { capFaces } from "$lib/now";
	import { hasPermission, Permission } from "$lib/permissions";
	import {
		afterTiles,
		AUTO,
		eyesToward,
		gridColumns,
		pressTile,
		stagedKey,
		tilePlaces,
		type StageChoice,
	} from "$lib/voice-stage";

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
	// Without SpeakInVoice the mic stays muted: MediaControls mutes it when the permission goes.
	const canSpeak = $derived(!voiceRoom || hasPermission(voiceRoom.space, voiceRoom.room, Permission.SpeakInVoice));
	// Video is the camera and the screen.
	const canVideo = $derived(!voiceRoom || hasPermission(voiceRoom.space, voiceRoom.room, Permission.Video));
	const videoReady = $derived(voiceLive && canVideo);
	const videoTitle = $derived(
		!voiceLive ? t("call_video_not_connected") : !canVideo ? t("call_video_not_allowed", { place: "room" }) : null,
	);

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
					username: me.alias ?? me.username ?? t("call_me"),
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
				username: user?.alias ?? user?.username ?? t("call_unknown_person"),
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
				username: me.alias ?? me.username ?? t("call_me"),
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
			return { id, name: user?.username ?? t("call_unknown_person"), src: user?.avatar_url ?? null };
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
	let cameras = $state<MediaDeviceInfo[]>([]);

	// The stage (lib/voice-stage.ts): a screen share takes it, with everyone in a strip under it; a press on a tile puts
	// it there (the app's "focus"), and a press on the tile that is there gives the grid back.
	let choice = $state<StageChoice>(AUTO);
	let tilesBefore: Tile[] = [];
	$effect.pre(() => {
		const now = tiles;
		const next = afterTiles(
			untrack(() => choice),
			tilesBefore,
			now,
		);
		tilesBefore = now;
		if (next !== untrack(() => choice)) choice = next;
	});
	const staged = $derived(stagedKey(tiles, choice));
	const stagedTile = $derived(tiles.find((tile) => tile.key === staged) ?? null);
	// Under a staged tile, everyone: the people, and the other screens.
	const stripTiles = $derived(staged ? tiles.filter((tile) => tile.key !== staged) : []);
	// A room's grid fills the pane: one column alone, two up to four, three for more. A call's tiles are a row.
	const columns = $derived(callMode ? Math.max(1, tiles.length) : gridColumns(tiles.length));

	// Track the last speaking user for eye gaze
	let lastSpeakerId = $state<string | null>(null);

	$effect(() => {
		const speaking = voiceUsers.filter((u) => $speakingUsers.has(u.id));
		lastSpeakerId = speaking.at(-1)?.id ?? null;
	});

	// Where each tile sits (the staged one above the strip's middle, the others along the strip, or the grid's cells),
	// and where each face looks: toward the speaker's tile.
	const places = $derived(tilePlaces(tiles, staged, columns));
	const eyeOffsets = $derived(eyesToward(tiles, places, lastSpeakerId));

	// A camera fills its tile; on the stage, or alone in the room, it shows whole.
	function cameraFit(key: string): string {
		return staged === key || (!callMode && tiles.length === 1) ? "object-contain" : "object-cover";
	}

	function toggleFocus(key: string) {
		choice = pressTile(tiles, choice, key);
	}

	// A call's stage folds to its bar alone, and back.
	let folded = $state(false);

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
			if (cameras.length > 0 && !cameras[0]?.label) {
				const stream = await navigator.mediaDevices.getUserMedia({ video: true });
				stream.getTracks().forEach((track) => track.stop());
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

	function share(withAudio: boolean) {
		screenShareRequested.set({ roomId: channelId, withAudio });
	}

	// The faces of who is in the room, for the bar of someone who isn't: four, and a count of the rest.
	const roomFaces = $derived(
		capFaces(
			voiceUsers.map((u) => ({ id: u.id, name: u.username, src: u.avatar_url })),
			4,
		),
	);
	// How the call's connection is, in its bar.
	const callStatus = $derived(
		voiceLive
			? mediaTitle({
					place: { kind: "call", id: channelId, where: channelName },
					phase: phaseOf($voiceConnectionState),
				})
			: t("call_status_connecting"),
	);
	const micTip = $derived(!canSpeak ? t("call_cannot_speak") : $isMuted ? t("call_unmute") : t("call_mute"));
	const tone = $derived(callMode ? "stage" : "plain");
	const shape = $derived(callMode ? "stage" : "bar");
</script>

<!-- A tile: someone's camera or face, or the screen they share. `size` is where it sits: a cell of the room's grid, the
     stage, the strip under it, or a call's row. -->
{#snippet tileView(tile: Tile, size: "grid" | "stage" | "strip" | "call")}
	{@const user = tile.user}
	<!-- This client's own tiles show its own capture; another session of the same user's is remote. -->
	{@const isLocal = isConnected && user.id === $currentUser?.id}
	{@const isSpeaking = $speakingUsers.has(user.id) && !user.muted}
	{@const small = size === "strip"}
	{@const face = size === "strip" ? 44 : size === "call" ? 64 : size === "stage" ? 96 : 84}
	<div
		class="group relative flex min-h-0 min-w-0 cursor-pointer items-center justify-center overflow-hidden transition-shadow duration-200 motion-reduce:transition-none {size ===
		'strip'
			? 'h-full max-w-[150px] flex-1 rounded-2xl'
			: size === 'call'
				? 'h-[136px] w-[180px] shrink-0 rounded-[18px]'
				: 'size-full rounded-[20px]'} {callMode
			? 'bg-fixed-white/8 inset-ring-fixed-white/8 inset-ring-1'
			: 'bg-duvet-card shadow-duvet-raised'} {isSpeaking
			? 'shadow-[0_0_0_2px_var(--duvet-alive),0_0_32px_-6px_color-mix(in_srgb,var(--duvet-alive)_60%,transparent)]'
			: ''}"
		role="button"
		tabindex="0"
		aria-label={tile.kind === "screen" ? t("call_stream_of", { name: user.username }) : user.username}
		aria-pressed={staged === tile.key}
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
					<!-- Whoever speaks gets the live ring, breathing, around their face. -->
					<span
						class="rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.18)] {isSpeaking
							? 'animate-speak ring-duvet-alive ring-[3px]'
							: ''}"
					>
						<UserAvatar
							src={$voiceFaces ? null : user.avatar_url}
							name={user.username}
							size={face}
							mouthOpen={$userAmplitudes[user.id] ?? 0}
							eyeOffset={eyeOffsets[user.id] ?? { x: 0, y: 0 }}
						/>
					</span>
					{#if user.camera && !isLocal && !$incomingVideo}
						<span
							class="bg-duvet-media-scrim text-duvet-media-ink absolute -right-1 -bottom-1 rounded-lg p-1.5 backdrop-blur-[14px]"
							title={t("call_camera_on_incoming_off")}
						>
							<VideoOff size={small ? 11 : 14} />
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
				<div class="flex flex-col items-center gap-2 {callMode ? 'text-duvet-media-ink/70' : 'text-duvet-ink2'}">
					<EyeOff size={small ? 16 : 24} />
					{#if !small}<span class="text-xs">{t("call_incoming_video_off")}</span>{/if}
				</div>
			{:else if isLocal || (isConnected && $watchedStreams.includes(user.id))}
				{#if screenStream}
					<video
						use:srcObject={screenStream}
						use:trackPlaying={tile.key}
						autoplay
						muted
						playsinline
						class="bg-duvet-stage absolute inset-0 size-full object-contain"
					></video>
				{/if}
				{#if !screenStream || !playing[tile.key]}
					<div class="bg-duvet-stage/80 absolute inset-0 flex items-center justify-center">
						<LoaderCircle class="text-duvet-media-ink animate-spin motion-reduce:animate-none" size={small ? 18 : 32} />
					</div>
				{/if}
				{#if !isLocal && !small}
					<button
						type="button"
						class="bg-duvet-media-scrim text-duvet-media-ink hover:bg-duvet-call-red hover:text-duvet-on-call-red absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 rounded-[10px] px-2.5 py-[5px] text-xs font-semibold opacity-0 backdrop-blur-[14px] transition-[opacity,background-color] group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
						onclick={(e) => {
							e.stopPropagation();
							stopWatching(user.id);
						}}
					>
						<ScreenShareOff size={13} />
						{t("call_stop_watching_short")}
					</button>
				{/if}
			{:else}
				<!-- Someone else shares and the user isn't watching: Watch only from the voice they're in -->
				<div class="flex flex-col items-center justify-center gap-3">
					<UserAvatar
						src={$voiceFaces ? null : user.avatar_url}
						name={user.username}
						size={small ? 36 : 64}
						mouthOpen={$userAmplitudes[user.id] ?? 0}
						eyeOffset={eyeOffsets[user.id] ?? { x: 0, y: 0 }}
					/>
					{#if isConnected}
						<Button
							size={small ? "sm" : "md"}
							onclick={(e: MouseEvent) => {
								e.stopPropagation();
								startWatching(channelId, user.id);
							}}
						>
							<ScreenShare size={small ? 13 : 15} />
							{small ? t("call_watch") : t("call_watch_stream")}
						</Button>
					{/if}
				</div>
			{/if}
			{#if !small}
				<div class="absolute top-2.5 left-2.5 z-10">
					<StreamViewers viewers={viewersOfScreen(user.id)} meId={$currentUser?.id} />
				</div>
			{/if}
		{/if}

		<!-- Name label -->
		<div
			class="bg-duvet-media-scrim text-duvet-media-ink absolute z-10 flex items-center font-semibold backdrop-blur-[14px] {small
				? 'bottom-1.5 left-1.5 max-w-[calc(100%-12px)] gap-1 rounded-lg px-[7px] py-1 text-[11.5px]'
				: 'bottom-2.5 left-2.5 max-w-[calc(100%-20px)] gap-1.5 rounded-[10px] px-2.5 py-[5px] text-[12.5px]'} leading-[1.2]"
		>
			{#if tile.kind === "screen"}
				<ScreenShare class="shrink-0" size={small ? 12 : 13} />
				<span class="truncate">{t("call_stream_of", { name: user.username })}</span>
			{:else}
				{#if user.deafened}
					<HeadphoneOff class="text-duvet-call-red-ink shrink-0" size={small ? 12 : 13} />
				{:else if user.muted}
					<MicOff class="text-duvet-call-red-ink shrink-0" size={small ? 12 : 13} />
				{/if}
				<span class="truncate">{user.username}</span>
			{/if}
		</div>
	</div>
{/snippet}

<!-- The camera's options: which camera, and whether to receive anyone's video. -->
{#snippet cameraOptions()}
	<Menu
		side="top"
		align="center"
		label={t("call_camera_options")}
		onOpenChange={(open) => {
			if (open) void loadCameras();
		}}
	>
		{#snippet trigger(menuProps)}
			<Tooltip text={t("call_camera_options")} side="top">
				{#snippet trigger(props)}
					<button
						{...mergeProps(menuProps, props)}
						type="button"
						aria-label={t("call_camera_options")}
						class=" grid w-[18px] shrink-0 place-items-center rounded-l-[3px] rounded-r-xl transition-[box-shadow,background-color] duration-[120ms] motion-reduce:transition-none {callMode
							? 'bg-fixed-white/14 text-duvet-media-ink hover:bg-fixed-white/22 h-9'
							: 'bg-duvet-secondary-fill text-duvet-ink h-[38px] hover:shadow-[inset_0_0_0_100px_var(--duvet-hover)]'}"
					>
						<ChevronUp size={12} strokeWidth={2.5} />
					</button>
				{/snippet}
			</Tooltip>
		{/snippet}
		<div class="text-duvet-ink2 px-2 pt-1 pb-1.5 text-[11.5px] leading-none font-semibold">{t("call_camera")}</div>
		{#if cameras.length === 0}
			<div class="text-duvet-ink2 px-2 py-1.5 text-[13px]">{t("call_no_cameras")}</div>
		{:else}
			{#each cameras as camera, i (camera.deviceId || i)}
				<MenuItem
					checked={camera.deviceId !== "" && camera.deviceId === activeCameraId}
					onSelect={() => selectedCameraId.set(camera.deviceId)}
				>
					{camera.label || t("call_camera_numbered", { number: i + 1 })}
				</MenuItem>
			{/each}
		{/if}
		<MenuSeparator />
		<MenuItem
			checked={$incomingVideo}
			closeOnSelect={false}
			hint={t("call_incoming_video_hint")}
			onSelect={() => incomingVideo.update((on) => !on)}
		>
			{t("call_incoming_video")}
		</MenuItem>
	</Menu>
{/snippet}

<!-- The view's own controls, the same in a room's bar and a call's: the microphone, the sound, the camera with its
     options, the screen share, and Leave. -->
{#snippet controls()}
	<MediaButton
		label={$isMuted ? t("call_unmute") : t("call_mute")}
		tip={micTip}
		pressed={$isMuted}
		stateInName
		disabled={!canSpeak}
		{tone}
		{shape}
		onclick={toggleMute}
	>
		{#if $isMuted}<MicOff size={18} />{:else}<Mic size={18} />{/if}
	</MediaButton>
	<MediaButton
		label={$isDeafened ? t("call_undeafen") : t("call_deafen")}
		pressed={$isDeafened}
		stateInName
		{tone}
		{shape}
		onclick={toggleDeafen}
	>
		{#if $isDeafened}<HeadphoneOff size={18} />{:else}<Headphones size={18} />{/if}
	</MediaButton>
	<div class="flex gap-px">
		<MediaButton
			label={$isCameraOn ? t("call_camera_turn_off") : t("call_camera_turn_on")}
			tip={videoTitle ?? ($isCameraOn ? t("call_camera_turn_off") : t("call_camera_turn_on"))}
			pressed={$isCameraOn}
			stateInName
			disabled={!videoReady}
			{tone}
			{shape}
			class="rounded-r-[3px]"
			onclick={toggleCamera}
		>
			{#if $isCameraOn}<Video size={18} />{:else}<VideoOff size={18} />{/if}
		</MediaButton>
		{@render cameraOptions()}
	</div>
	{#if $isScreenSharing && videoReady}
		<MediaButton
			label={t("call_stop_sharing")}
			pressed
			stateInName
			{tone}
			{shape}
			onclick={() => stopScreenShare(channelId)}
		>
			<ScreenShareOff size={18} />
		</MediaButton>
	{:else}
		<!-- The system's (or the browser's) own picker follows: Duvet draws none. -->
		<Menu side="top" align="center" label={t("call_share_screen")}>
			{#snippet trigger(props)}
				<MediaButton
					label={t("call_share_screen")}
					tip={videoTitle ?? t("call_share_screen")}
					pressed={false}
					stateInName
					disabled={!videoReady}
					triggerProps={props}
					{tone}
					{shape}
				>
					<ScreenShare size={18} />
				</MediaButton>
			{/snippet}
			<MenuItem icon={ScreenShare} onSelect={() => share(false)}>{t("call_share_screen_only")}</MenuItem>
			<MenuItem icon={Volume2} onSelect={() => share(true)}>{t("call_share_screen_with_audio")}</MenuItem>
		</Menu>
	{/if}
	<span class="mx-0.5 h-[22px] w-px shrink-0 {callMode ? 'bg-fixed-white/14' : 'bg-duvet-line'}" aria-hidden="true"
	></span>
	<MediaButton
		label={callMode ? t("call_leave_call") : t("call_leave_voice_room")}
		tone={callMode ? "stage-leave" : "leave"}
		{shape}
		onclick={leave}
	>
		<PhoneOff size={18} />
	</MediaButton>
{/snippet}

{#snippet tilesArea()}
	{#if stagedTile}
		<div class="min-h-0 flex-1">
			{@render tileView(stagedTile, "stage")}
		</div>
		{#if stripTiles.length > 0}
			<div class="flex h-[104px] shrink-0 justify-center gap-2" role="group" aria-label={t("call_everyone_here")}>
				{#each stripTiles as tile (tile.key)}
					{@render tileView(tile, "strip")}
				{/each}
			</div>
		{/if}
	{:else if callMode}
		<div class="flex min-h-0 flex-1 items-center justify-center gap-3.5 overflow-x-auto">
			{#each tiles as tile (tile.key)}
				{@render tileView(tile, "call")}
			{/each}
		</div>
	{:else}
		<div
			class="grid min-h-0 flex-1 auto-rows-fr gap-2.5"
			style="grid-template-columns: repeat({columns}, minmax(0, 1fr));"
		>
			{#each tiles as tile (tile.key)}
				{@render tileView(tile, "grid")}
			{/each}
		</div>
	{/if}
{/snippet}

{#if callMode}
	<!-- A call in a DM or group, in place above the conversation: a dark stage, whatever the theme, which folds to its
	     bar alone. -->
	<section
		aria-label={t("call_stage_label", { name: channelName })}
		class="bg-duvet-stage text-duvet-media-ink shadow-duvet-lifted m-3 flex min-h-0 flex-col overflow-hidden rounded-[20px]"
	>
		{#if !folded}
			<div class="flex min-h-0 flex-col gap-2.5 px-3.5 pt-3.5 {stagedTile ? 'h-[min(46vh,420px)]' : 'h-[184px]'}">
				{@render tilesArea()}
			</div>
		{/if}
		<div class="flex h-[52px] shrink-0 items-center gap-2 pr-3 pl-4">
			<div class="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] font-semibold" role="status">
				{#if voiceLive && $voiceConnectionState === "connected"}
					<span class="bg-duvet-alive size-2 shrink-0 rounded-full"></span>
				{:else}
					<PhoneCall class="text-duvet-media-ink/70 shrink-0" size={14} />
				{/if}
				<span class="truncate">{callStatus}</span>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				{@render controls()}
			</div>
			<div class="flex min-w-0 flex-1 justify-end">
				<Tooltip text={folded ? t("call_show_call") : t("call_hide_call")} side="top">
					{#snippet trigger(props)}
						<button
							{...props}
							type="button"
							aria-label={folded ? t("call_show_call") : t("call_hide_call")}
							aria-expanded={!folded}
							class="text-duvet-media-ink hover:bg-fixed-white/14 grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors motion-reduce:transition-none"
							onclick={() => (folded = !folded)}
						>
							{#if folded}<ChevronDown size={15} />{:else}<ChevronUp size={15} />{/if}
						</button>
					{/snippet}
				</Tooltip>
			</div>
		</div>
	</section>
{:else}
	<div class="bg-duvet-bg relative flex min-h-0 flex-1 flex-col">
		{#if showHeader}
			<div class="border-duvet-line flex shrink-0 items-center gap-2 border-b px-4 py-3">
				<Volume2 class="text-duvet-ink2 size-4 shrink-0" />
				<h2 class="text-duvet-ink truncate font-serif text-[16px] font-medium">{channelName}</h2>
				{#if isConnected}
					<span
						class="bg-duvet-alive/14 text-duvet-alive-text ml-auto shrink-0 rounded-[9px] px-2 py-0.5 text-xs font-semibold"
					>
						{t("call_connected")}
					</span>
				{/if}
			</div>
		{/if}

		<!-- The tiles fill the pane, down to the bar that floats over its foot. -->
		<div class="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pt-3.5 pb-[78px]">
			{#if voiceUsers.length === 0}
				<div class="text-duvet-ink2 flex h-full flex-col items-center justify-center gap-1 text-center select-none">
					<MascotPeek class="mb-3 w-[120px]" mood="shy" />
					<p class="text-duvet-ink font-serif text-[19px] font-medium">{t("call_room_empty_title")}</p>
					{#if !isConnected}
						<p class="text-[13px]">{t("call_room_empty_line")}</p>
					{/if}
				</div>
			{:else}
				{@render tilesArea()}
			{/if}
		</div>

		<!-- The room's own bar: its controls once joined, else who is there and Join. -->
		<div class="pointer-events-none absolute inset-x-0 bottom-4 z-3 flex justify-center px-3.5">
			{#if isConnected}
				<div
					class="{GLASS} pointer-events-auto flex items-center gap-1.5 rounded-[18px] p-1.5"
					role="toolbar"
					aria-label={t("call_room_controls")}
				>
					{@render controls()}
				</div>
			{:else}
				<div class="{GLASS} pointer-events-auto flex max-w-full items-center gap-4 rounded-[18px] py-2 pr-2 pl-4">
					<div class="flex min-w-0 flex-col gap-0.5">
						<span class="text-duvet-ink truncate font-serif text-[16px] leading-[1.2] font-medium">{channelName}</span>
						<span class="text-duvet-ink2 flex items-center gap-1.5 text-xs leading-[1.2]">
							{#if voiceUsers.length === 0}
								{t("call_room_empty")}
							{:else}
								<span class="truncate">{t("call_people_in_room", { count: voiceUsers.length })}</span>
								<FaceStack faces={roomFaces.faces} more={roomFaces.more} size={18} ring="ring-duvet-card" />
							{/if}
						</span>
					</div>
					<Tooltip text={canJoin ? t("call_join_room_tip") : t("call_cannot_join_room")} side="top">
						{#snippet trigger(props)}
							<span {...props} class="shrink-0">
								<Button disabled={!canJoin} onclick={join}>
									{#if canJoin}<Phone size={15} />{:else}<Lock size={15} />{/if}
									{t("call_join_room")}
								</Button>
							</span>
						{/snippet}
					</Tooltip>
				</div>
			{/if}
		</div>
	</div>
{/if}
