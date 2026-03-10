<script lang="ts">
import { LoaderCircle, MicOff, MonitorUp, PhoneOff } from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { onWebRTCEvent, sendEventMessage } from "$lib/api/ws/connection";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { hasPermission, Permission } from "$lib/permissions";
import {
	activeVoiceRoomId,
	currentUser,
	gatewaySpaces,
	isDeafened,
	isMuted,
	selectedMicId,
	speakingUsers,
} from "$lib/stores.svelte";

export let channelId: string;
export let channelName: string;

let peerConnection: RTCPeerConnection | null = null;
let localAudioStream: MediaStream | null = null;
let localVideoStream: MediaStream | null = null;
let pendingIceCandidates: RTCIceCandidate[] = [];

let isScreenSharing = false;

let remoteAudioElements: { [id: string]: MediaStream } = {};
let remoteVideoElements: { [id: string]: MediaStream } = {};
let remoteUserMuted: { [id: string]: boolean } = {};
let videoPlayingStates: Record<string, boolean> = {};

let unsubscribeWs: () => void;
let audioContext: AudioContext | null = null;
let localAnalyser: AnalyserNode | null = null;
let localAudioSource: MediaStreamAudioSourceNode | null = null;
let isDestroyed = false;

function leaveVoice() {
	if (isDestroyed) return;
	isDestroyed = true;
	sendEventMessage("VOICE_LEAVE", { room_id: channelId });
	if (peerConnection) {
		peerConnection.close();
		peerConnection = null;
	}
	if (localAudioStream) localAudioStream.getTracks().forEach((t) => t.stop());
	if (localVideoStream) localVideoStream.getTracks().forEach((t) => t.stop());
	if (audioContext) audioContext.close();
	if (unsubscribeWs) unsubscribeWs();
	speakingUsers.set(new SvelteSet());
	if ($activeVoiceRoomId === channelId) activeVoiceRoomId.set(null);
}

let currentMicId = $selectedMicId;

let myUserId: string | null = null;
currentUser.subscribe((u) => (myUserId = u?.id || null));

let focusedUserId: string | null = null;

onMount(async () => {
	unsubscribeWs = onWebRTCEvent((type, data: any) => {
		if (data.room_id !== channelId) return;

		if (type === "VOICE_JOINED") {
			const pc = peerConnection;
			if (!pc) return;
			pc.setRemoteDescription(new RTCSessionDescription(data.answer)).then(() => {
				// Only flush if this is still the active connection
				if (pc !== peerConnection) return;
				const toFlush = pendingIceCandidates;
				pendingIceCandidates = [];
				for (const candidate of toFlush) {
					pc.addIceCandidate(candidate).catch(console.warn);
				}
			}).catch(console.warn);
		} else if (type === "WEBRTC_ICE_CANDIDATE") {
			const pc = peerConnection;
			if (!pc) return;
			const parsed = typeof data.candidate === "string"
				? JSON.parse(data.candidate)
				: data.candidate;
			const candidate = new RTCIceCandidate(parsed);
			if (pc.remoteDescription) {
				pc.addIceCandidate(candidate).catch(console.warn);
			} else {
				pendingIceCandidates.push(candidate);
			}
		} else if (type === "WEBRTC_RENEGOTIATE") {
			const pc = peerConnection;
			if (!pc) return;
			pc.setRemoteDescription(new RTCSessionDescription(data.offer))
				.then(() => {
					if (pc !== peerConnection) return;
					const toFlush = pendingIceCandidates;
					pendingIceCandidates = [];
					for (const candidate of toFlush) {
						pc.addIceCandidate(candidate).catch(console.warn);
					}
					return pc.createAnswer();
				})
				.then((answer) => {
					if (!answer || pc !== peerConnection) return;
					pc.setLocalDescription(answer);
					sendEventMessage("WEBRTC_ANSWER", {
						room_id: channelId,
						answer: answer,
					});
				}).catch(console.warn);
		} else if (type === "VOICE_STATE_UPDATE") {
			remoteUserMuted[data.user_id] = data.muted;
			remoteUserMuted = { ...remoteUserMuted };
		}
	});

	const space = $gatewaySpaces.find((s) =>
		s.rooms.some((r) => r.id === channelId),
	);
	const room = space?.rooms.find((r) => r.id === channelId);
	const canSpeak =
		space && room ? hasPermission(space, room, Permission.SpeakInVoice) : false;

	if (!canSpeak) {
		isMuted.set(true);
	} else {
		try {
			const constraints = $selectedMicId
				? { audio: { deviceId: { exact: $selectedMicId } } }
				: { audio: true };
			localAudioStream = await navigator.mediaDevices.getUserMedia(constraints);
		} catch (e) {
			console.error("Failed to get local audio", e);
		}
	}

	activeVoiceRoomId.set(channelId);
	connectWebRTC();
});

onDestroy(() => {
	leaveVoice();
});

async function connectWebRTC() {
	if (peerConnection) {
		peerConnection.close();
	}
	remoteAudioElements = {};
	remoteVideoElements = {};
	pendingIceCandidates = [];

	peerConnection = new RTCPeerConnection({
		iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
	});

	peerConnection.onicecandidate = (event) => {
		if (event.candidate) {
			sendEventMessage("WEBRTC_ICE_CANDIDATE", {
				room_id: channelId,
				candidate: event.candidate.toJSON(),
			});
		}
	};

	peerConnection.ontrack = (event) => {
		const stream = event.streams.at(0);
		if (!stream) return;

		const userId = stream.id;

		stream.onremovetrack = (e) => {
			if (e.track.kind === "video") {
				delete remoteVideoElements[stream.id];
				remoteVideoElements = { ...remoteVideoElements };
			} else {
				delete remoteAudioElements[stream.id];
				remoteAudioElements = { ...remoteAudioElements };
			}
		};

		event.track.onended = () => {
			if (event.track.kind === "video") {
				delete remoteVideoElements[stream.id];
				remoteVideoElements = { ...remoteVideoElements };
			} else {
				delete remoteAudioElements[stream.id];
				remoteAudioElements = { ...remoteAudioElements };
			}
		};

		if (event.track.kind === "audio") {
			remoteAudioElements[stream.id] = stream;
			remoteAudioElements = { ...remoteAudioElements };

			if (!audioContext) {
				audioContext = new (
					window.AudioContext || (window as any).webkitAudioContext
				)();
			}

			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 256;
			const source = audioContext.createMediaStreamSource(
				new MediaStream([event.track]),
			);
			source.connect(analyser);
			const dataArray = new Uint8Array(analyser.frequencyBinCount);

			const checkAudioLevel = () => {
				if (isDestroyed || !audioContext || event.track.readyState === "ended")
					return;
				analyser.getByteFrequencyData(dataArray);
				let sum = 0;
				for (let i = 0; i < dataArray.length; i++) {
					sum += dataArray[i];
				}
				const average = sum / dataArray.length;

				speakingUsers.update((set) => {
					const newSet = new SvelteSet(set);
					if (average > 10) newSet.add(userId);
					else newSet.delete(userId);
					return newSet;
				});

				requestAnimationFrame(checkAudioLevel);
			};
			checkAudioLevel();
		} else if (event.track.kind === "video") {
			remoteVideoElements[stream.id] = stream;
			remoteVideoElements = { ...remoteVideoElements };
		}
	};

	if (localAudioStream) {
		localAudioStream.getTracks().forEach((track) => {
			peerConnection?.addTrack(track, localAudioStream!);
		});

		if (!audioContext) {
			audioContext = new (
				window.AudioContext || (window as any).webkitAudioContext
			)();
		}
		if (!localAnalyser) {
			localAnalyser = audioContext.createAnalyser();
			localAnalyser.fftSize = 256;
		}
		if (
			!localAudioSource ||
			localAudioSource.mediaStream !== localAudioStream
		) {
			if (localAudioSource) localAudioSource.disconnect();
			try {
				localAudioSource =
					audioContext.createMediaStreamSource(localAudioStream);
				localAudioSource.connect(localAnalyser);
			} catch (err) {
				console.error("AudioSource error", err);
			}
		}

		const dataArray = new Uint8Array(localAnalyser.frequencyBinCount);

		const checkLocalLevel = () => {
			if (isDestroyed || !audioContext || !localAnalyser) return;
			localAnalyser.getByteFrequencyData(dataArray);
			let sum = 0;
			for (let i = 0; i < dataArray.length; i++) {
				sum += dataArray[i];
			}
			const average = sum / dataArray.length;

			speakingUsers.update((set) => {
				const newSet = new SvelteSet(set);
				if (average > 10 && !$isMuted && myUserId) newSet.add(myUserId);
				else if (myUserId) newSet.delete(myUserId);
				return newSet;
			});

			requestAnimationFrame(checkLocalLevel);
		};
		checkLocalLevel();
	} else {
		peerConnection?.addTransceiver("audio", { direction: "recvonly" });
	}
	if (localVideoStream) {
		localVideoStream.getTracks().forEach((track) => {
			peerConnection?.addTrack(track, localVideoStream!);
		});
	} else {
		peerConnection?.addTransceiver("video", { direction: "recvonly" });
	}

	const offer = await peerConnection.createOffer();

	await peerConnection.setLocalDescription(offer);

	sendEventMessage("VOICE_JOIN", {
		room_id: channelId,
		offer: offer,
	});

	sendEventMessage("VOICE_SYNC", {
		room_id: channelId,
		muted: $isMuted,
		deafened: $isDeafened,
	});
}

$: {
	if (localAudioStream) {
		localAudioStream
			.getAudioTracks()
			.forEach((t) => (t.enabled = !$isMuted && !$isDeafened));
	}
}

$: if (peerConnection && currentMicId !== $selectedMicId) {
	currentMicId = $selectedMicId;
	switchMicrophone($selectedMicId).catch((err) =>
		console.error("Failed to switch mic", err),
	);
}

async function switchMicrophone(deviceId: string) {
	const constraints = deviceId
		? { audio: { deviceId: { exact: deviceId } } }
		: { audio: true };
	const newStream = await navigator.mediaDevices.getUserMedia(constraints);

	const newTrack = newStream.getAudioTracks().at(0);
	if (newTrack) {
		newTrack.enabled = !$isMuted && !$isDeafened;
		const sender = peerConnection
			?.getSenders()
			.find((s) => s.track?.kind === "audio");
		if (sender) {
			await sender.replaceTrack(newTrack);
		}
	}

	if (localAudioStream) {
		localAudioStream.getTracks().forEach((t) => t.stop());
	}
	localAudioStream = newStream;

	if (audioContext && localAnalyser) {
		if (localAudioSource) {
			localAudioSource.disconnect();
		}
		localAudioSource = audioContext.createMediaStreamSource(localAudioStream);
		localAudioSource.connect(localAnalyser);
	}
}

async function toggleScreenShare() {
	if (isScreenSharing) {
		if (localVideoStream) {
			localVideoStream.getTracks().forEach((t) => t.stop());
			localVideoStream = null;
		}
		isScreenSharing = false;
		connectWebRTC(); // Reconnect without video track
	} else {
		try {
			localVideoStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
			});
			isScreenSharing = true;

			const videoTrack = localVideoStream.getVideoTracks().at(0);
			if (videoTrack)
				videoTrack.onended = () => {
					if (isScreenSharing) toggleScreenShare(); // turn off when user clicks browser's stop sharing
				};

			connectWebRTC(); // Reconnect with video track
		} catch (err) {
			console.error("Screen share failed", err);
		}
	}
}

function srcObject(
	node: HTMLAudioElement | HTMLVideoElement,
	stream: MediaStream,
) {
	node.srcObject = stream;
	return {
		update(newStream: MediaStream) {
			if (node.srcObject !== newStream) {
				node.srcObject = newStream;
			}
		},
	};
}

$: voiceUsers = (() => {
	const fromGateway = $gatewaySpaces.flatMap((space) => {
		const room = space.rooms.find((r) => r.id === channelId);
		if (!room) return [];
		const voiceStates =
			space.voice_states?.filter((vs) => vs.room_id === channelId) ?? [];
		return voiceStates.map((vs) => {
			const user = space.users.find((u) => u.id === vs.user_id);
			return {
				id: vs.user_id,
				username: user?.alias ?? user?.username ?? "Unknown",
				avatar_url: user?.avatar ?? null,
				muted: vs.muted ?? false,
				deafened: vs.deafened ?? false,
			};
		});
	});

	// Fallback: always show local user while connected, even if gateway
	// hasn't sent our voice_state yet.
	const me = $currentUser;
	if (me && !fromGateway.some((u) => u.id === me.id)) {
		fromGateway.push({
			id: me.id,
			username: me.alias ?? me.username ?? "Me",
			avatar_url: me.avatar ?? null,
			muted: $isMuted,
			deafened: $isDeafened,
		});
	}

	return fromGateway;
})();
</script>

<div
	class="relative flex flex-1 flex-col border-l border-zinc-800 bg-zinc-900 p-6 text-white"
>
	<div class="mb-4">
		<h1 class="text-2xl font-bold flex items-center gap-2">
			<span class="text-zinc-400 opacity-60">🔊</span>
			{channelName}
		</h1>
		<p class="text-sm text-zinc-400">Voice Connected</p>
	</div>

	<div
		class="flex-1 overflow-y-auto pb-24 {voiceUsers.length === 1
			? 'flex flex-col p-4'
			: focusedUserId
				? 'flex flex-row flex-wrap content-start p-4 gap-4'
				: 'grid grid-cols-auto-fit gap-4 content-start p-4'}"
	>
		{#each voiceUsers as user (user.id)}
			{@const isLocal = user.id === myUserId}
			{@const videoStream = isLocal
				? localVideoStream
				: remoteVideoElements[user.id]}
			{@const audioStream = isLocal ? null : remoteAudioElements[user.id]}
			{@const isSpeaking = $speakingUsers.has(user.id)}
			{@const isForceMuted =
				(!isLocal &&
					audioStream &&
					audioStream.getAudioTracks().every((t) => !t.enabled)) ||
				remoteUserMuted[user.id] ||
				user.muted}

			<div
				class="relative flex cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-zinc-800/70 shadow-lg transition-all {voiceUsers.length ===
				1
					? 'flex-1 min-h-0 w-full'
					: focusedUserId === user.id
						? 'w-full h-[60vh] order-first'
						: focusedUserId
							? 'w-64 h-48 shrink-0'
							: 'h-64'} {isSpeaking && !user.muted
					? 'border-transparent ring-2 ring-inset ring-stone-400'
					: 'border-zinc-700 hover:border-zinc-500'}"
				on:click={() =>
					(focusedUserId =
						focusedUserId === user.id ? null : user.id)}
				role="button"
				tabindex="0"
				on:keydown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						focusedUserId = focusedUserId === user.id ? null : user.id;
					}
				}}
				aria-label={`Focus participant ${user.username}`}
			>
				{#if videoStream}
					<video
						use:srcObject={videoStream}
						autoplay
						playsinline
						muted={isLocal}
						class="w-full h-full object-contain backdrop-blur-md transition-opacity duration-300 {videoPlayingStates[
							user.id
						]
							? 'opacity-100'
							: 'opacity-0'}"
						on:playing={() =>
							(videoPlayingStates = {
								...videoPlayingStates,
								[user.id]: true,
							})}
						on:waiting={() =>
							(videoPlayingStates = {
								...videoPlayingStates,
								[user.id]: false,
							})}
					>
						<track kind="captions" srclang="en" label="captions" />
					</video>

					{#if !videoPlayingStates[user.id]}
						<div
							class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10 rounded-lg"
						>
							<LoaderCircle
								class="mb-3 size-10 animate-spin text-zinc-300"
							/>
							<span class="text-sm font-medium text-zinc-300"
								>Connecting video...</span
							>
						</div>
					{/if}
				{:else}
					<UserAvatar
						src={user.avatar_url}
						name={user.username}
						size={96}
					/>
				{/if}

				<div
					class="absolute bottom-4 left-4 bg-black/60 px-3 py-1.5 rounded-md flex items-center gap-2 text-white backdrop-blur-md"
				>
					{#if user.deafened}
						<PhoneOff class="size-4 text-red-400" />
					{:else if isForceMuted}
						<MicOff class="size-4 text-red-400" />
					{/if}
					<span class="text-sm font-medium">{user.username}</span>
				</div>
			</div>
		{/each}
	</div>

	<div class="hidden">
		{#each Object.entries(remoteAudioElements) as [id, stream] (id)}
			<audio
				use:srcObject={stream}
				autoplay
				muted={$isDeafened}
				aria-label={`Audio stream ${id}`}
			></audio>
		{/each}
	</div>

	<div
		class="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full border border-zinc-700 bg-zinc-800/80 px-6 py-3 shadow-xl backdrop-blur-md"
	>
		<button
			class="rounded-full p-4 hover:bg-zinc-700 {isScreenSharing
				? 'text-stone-200 bg-stone-400/20 hover:bg-stone-400/30'
				: 'text-zinc-200'} transition-all"
			on:click={toggleScreenShare}
			aria-label="Share Screen"
		>
			<MonitorUp class="size-5" />
		</button>
		<button
			class="p-4 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-all"
			on:click={leaveVoice}
			aria-label="Leave Voice"
		>
			<PhoneOff class="size-5" />
		</button>
	</div>
</div>

<style>
	.grid-cols-auto-fit {
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	}
</style>
