<script lang="ts">
	import { LoaderCircle, MicOff, MonitorUp, PhoneOff, Play } from "@lucide/svelte";
	import { onDestroy, onMount } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { onWebRTCEvent, sendEventMessage } from "$lib/api/ws/connection";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { hasPermission, Permission } from "$lib/permissions";
	import { createDenoisedStream } from "$lib/audio/noise-suppression";
	import {
		activeVoiceRoomId,
		currentUser,
		gatewaySpaces,
		isDeafened,
		isMuted,
		screenShareRequested,
		selectedMicId,
		speakingUsers,
		voiceConnectionState,
		voiceRemoteVideoStreams,
		voiceLocalVideoStream,
		isScreenSharing,
	} from "$lib/stores.svelte";

	let {
		channelId,
		channelName,
		compact = false,
	}: { channelId: string; channelName: string; compact?: boolean } = $props();

	let peerConnection: RTCPeerConnection | null = null;
	let localAudioStream: MediaStream | null = null;
	let audioSender: RTCRtpSender | null = null;
	let localVideoStream = $state<MediaStream | null>(null);
	let pendingIceCandidates: RTCIceCandidate[] = [];
	let negotiationReady = false;
	let negotiationChain: Promise<void> = Promise.resolve();
	// Resolves once VOICE_JOINED has been processed. Every WEBRTC_RENEGOTIATE
	// awaits this gate so it never runs before the initial answer is applied.
	let voiceJoinedResolve: (() => void) | null = null;
	let voiceJoinedPromise: Promise<void> = Promise.resolve();

	// isScreenSharing is shared via store so VoiceChannelView can read it

	$effect(() => {
		voiceRemoteVideoStreams.set(remoteVideoElements);
	});

	$effect(() => {
		voiceLocalVideoStream.set(localVideoStream);
	});

	$effect(() => {
		if ($screenShareRequested) {
			screenShareRequested.set(false);
			void toggleScreenShare();
		}
	});

	let remoteAudioElements = $state<{ [id: string]: MediaStream }>({});
	let remoteVideoElements = $state<{ [id: string]: MediaStream }>({});
	let videoPlayingStates = $state<Record<string, boolean>>({});
	let videoClickedStates = $state<Record<string, boolean>>({});
	let videoEls: Record<string, HTMLVideoElement> = {};
	let userAmplitudes = $state<Record<string, number>>({});

	let unsubscribeWs: () => void;
	let audioContext: AudioContext | null = null;
	let localAnalyser: AnalyserNode | null = null;
	let localAudioSource: MediaStreamAudioSourceNode | null = null;
	let denoiseCleanup: (() => void) | null = null;
	let rawMicStream: MediaStream | null = null;
	let isDestroyed = false;

	function leaveVoice() {
		if (isDestroyed) return;
		isDestroyed = true;
		new Audio("/sounds/leave_vc.ogg").play().catch(() => {});
		sendEventMessage("VOICE_LEAVE", { room_id: channelId });
		if (peerConnection) {
			peerConnection.close();
			peerConnection = null;
		}
		if (denoiseCleanup) {
			denoiseCleanup();
			denoiseCleanup = null;
		}
		if (rawMicStream) {
			rawMicStream.getTracks().forEach((t) => t.stop());
			rawMicStream = null;
		}
		if (localAudioStream) localAudioStream.getTracks().forEach((t) => t.stop());
		if (localVideoStream) localVideoStream.getTracks().forEach((t) => t.stop());
		if (audioContext) audioContext.close();
		if (unsubscribeWs) unsubscribeWs();
		// Only clear global stores if we're still the active voice session
		if ($activeVoiceRoomId === channelId || $activeVoiceRoomId === null) {
			speakingUsers.set(new SvelteSet());
			voiceRemoteVideoStreams.set({});
			voiceLocalVideoStream.set(null);
			isScreenSharing.set(false);
		}
		if ($activeVoiceRoomId === channelId) activeVoiceRoomId.set(null);
	}

	let currentMicId = $state($selectedMicId);

	let myUserId = $state<string | null>(null);
	currentUser.subscribe((u) => (myUserId = u?.id || null));

	let focusedUserId = $state<string | null>(null);

	const connectionState = voiceConnectionState;

	const connectionLabel: Record<RTCPeerConnectionState, string> = {
		new: "Connecting...",
		connecting: "Connecting...",
		connected: "Voice Connected",
		disconnected: "Reconnecting...",
		failed: "Connection Failed",
		closed: "Disconnected",
	};

	onMount(async () => {
		unsubscribeWs = onWebRTCEvent((type, data: any) => {
			if (data.room_id !== channelId) return;

			if (type === "VOICE_JOINED") {
				new Audio("/sounds/join_vc.ogg").play().catch(() => {});
				const pc = peerConnection;
				if (!pc) return;
				// Process the initial answer immediately — not through the chain —
				// so it can never be blocked by a queued WEBRTC_RENEGOTIATE.
				pc.setRemoteDescription(new RTCSessionDescription(data.answer))
					.then(() => {
						if (pc !== peerConnection) return;
						const toFlush = pendingIceCandidates;
						pendingIceCandidates = [];
						for (const candidate of toFlush) {
							pc.addIceCandidate(candidate).catch(console.warn);
						}
						// Now it's safe to renegotiate (e.g. when screen share is added)
						negotiationReady = true;
					})
					.catch(console.warn)
					// Always open the gate so queued renegotiations can proceed.
					.finally(() => voiceJoinedResolve?.());
			} else if (type === "WEBRTC_ICE_CANDIDATE") {
				const pc = peerConnection;
				if (!pc) return;
				const parsed = typeof data.candidate === "string" ? JSON.parse(data.candidate) : data.candidate;
				const candidate = new RTCIceCandidate(parsed);
				if (pc.remoteDescription) {
					pc.addIceCandidate(candidate).catch(console.warn);
				} else {
					pendingIceCandidates.push(candidate);
				}
			} else if (type === "WEBRTC_RENEGOTIATE") {
				const pc = peerConnection;
				if (!pc) return;
				// Capture the gate at enqueue-time. If VOICE_JOINED hasn't arrived
				// yet this renegotiation will wait for it before running, regardless
				// of its position in negotiationChain.
				const readyGate = voiceJoinedPromise;
				negotiationChain = negotiationChain
					.then(async () => {
						await readyGate; // never run before the initial answer is applied
						if (pc !== peerConnection) return;
						await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
						if (pc !== peerConnection) return;
						const toFlush = pendingIceCandidates;
						pendingIceCandidates = [];
						for (const candidate of toFlush) {
							pc.addIceCandidate(candidate).catch(console.warn);
						}
						const answer = await pc.createAnswer();
						if (pc !== peerConnection) return;
						await pc.setLocalDescription(answer);
						sendEventMessage("WEBRTC_ANSWER", {
							room_id: channelId,
							answer: answer,
						});
					})
					.catch(console.warn);
			} else if (type === "WEBRTC_RENEGOTIATE_ANSWER") {
				const pc = peerConnection;
				if (!pc) return;
				pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(console.warn);
			}
		});

		const space = $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === channelId));
		const room = space?.rooms.find((r) => r.id === channelId);
		// For conversation calls (no space/room), always allow speaking
		const canSpeak = space && room ? hasPermission(space, room, Permission.SpeakInVoice) : true;

		if (!canSpeak) {
			isMuted.set(true);
		} else {
			try {
				const constraints = $selectedMicId ? { audio: { deviceId: { exact: $selectedMicId } } } : { audio: true };
				rawMicStream = await navigator.mediaDevices.getUserMedia(constraints);

				if (!audioContext) {
					audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
				}
				const denoised = await createDenoisedStream(rawMicStream, audioContext);
				localAudioStream = denoised.stream;
				denoiseCleanup = denoised.cleanup;
			} catch (e) {
				console.error("Failed to get local audio", e);
				// Fallback to raw stream if denoise fails
				if (rawMicStream && !localAudioStream) {
					localAudioStream = rawMicStream;
				}
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
		negotiationReady = false;
		negotiationChain = Promise.resolve();
		voiceJoinedPromise = new Promise<void>((resolve) => {
			voiceJoinedResolve = resolve;
		});
		audioSender = null;
		connectionState.set("new");

		peerConnection = new RTCPeerConnection({
			iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
		});

		peerConnection.onnegotiationneeded = async () => {
			if (!negotiationReady) return;
			const pc = peerConnection;
			if (!pc) return;
			try {
				const offer = await pc.createOffer();
				if (pc !== peerConnection) return;
				await pc.setLocalDescription(offer);
				sendEventMessage("WEBRTC_RENEGOTIATE_OFFER", {
					room_id: channelId,
					offer: offer,
				});
			} catch (err) {
				console.error("[WebRTC] negotiationneeded error:", err);
			}
		};

		peerConnection.onconnectionstatechange = () => {
			const state = peerConnection?.connectionState;
			if (state) connectionState.set(state);
			if (state === "failed" && !isDestroyed) {
				leaveVoice();
			}
		};

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
					videoClickedStates = { ...videoClickedStates, [userId]: false };
				} else {
					delete remoteAudioElements[stream.id];
					remoteAudioElements = { ...remoteAudioElements };
				}
			};

			event.track.onended = () => {
				if (event.track.kind === "video") {
					delete remoteVideoElements[stream.id];
					remoteVideoElements = { ...remoteVideoElements };
					videoClickedStates = { ...videoClickedStates, [userId]: false };
				} else {
					delete remoteAudioElements[stream.id];
					remoteAudioElements = { ...remoteAudioElements };
				}
			};

			if (event.track.kind === "audio") {
				remoteAudioElements[stream.id] = stream;
				remoteAudioElements = { ...remoteAudioElements };

				if (!audioContext) {
					audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
				}

				const analyser = audioContext.createAnalyser();
				analyser.fftSize = 256;
				const source = audioContext.createMediaStreamSource(new MediaStream([event.track]));
				source.connect(analyser);
				const dataArray = new Uint8Array(analyser.frequencyBinCount);

				const checkAudioLevel = () => {
					if (isDestroyed || !audioContext || event.track.readyState === "ended") return;
					analyser.getByteFrequencyData(dataArray);
					let sum = 0;
					for (let i = 0; i < dataArray.length; i++) {
						sum += dataArray[i];
					}
					const average = sum / dataArray.length;
					// Normalize to 0-1 (values above ~50 are loud speech)
					const amplitude = Math.min(1, average / 50);

					speakingUsers.update((set) => {
						const newSet = new SvelteSet(set);
						if (average > 10) newSet.add(userId);
						else newSet.delete(userId);
						return newSet;
					});
					userAmplitudes[userId] = average > 10 ? amplitude : 0;

					requestAnimationFrame(checkAudioLevel);
				};
				checkAudioLevel();
			} else if (event.track.kind === "video") {
				remoteVideoElements[stream.id] = stream;
				remoteVideoElements = { ...remoteVideoElements };
				// Each new stream requires a fresh click to play.
				videoClickedStates = { ...videoClickedStates, [userId]: false };

				// When the sharer stops, the track becomes muted before the server
				// cleanup renegotiation arrives. Reset both states immediately.
				event.track.onmute = () => {
					videoPlayingStates = { ...videoPlayingStates, [userId]: false };
					videoClickedStates = { ...videoClickedStates, [userId]: false };
				};
			}
		};

		if (localAudioStream) {
			const audioTrack = localAudioStream.getAudioTracks().at(0);
			if (audioTrack && peerConnection) {
				audioSender = peerConnection.addTrack(audioTrack, localAudioStream);
				if ($isMuted || $isDeafened) {
					audioSender.replaceTrack(null).catch(console.warn);
				}
			}
			localAudioStream
				.getTracks()
				.filter((t) => t.kind !== "audio")
				.forEach((track) => {
					peerConnection?.addTrack(track, localAudioStream!);
				});

			if (!audioContext) {
				audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			}
			if (!localAnalyser) {
				localAnalyser = audioContext.createAnalyser();
				localAnalyser.fftSize = 256;
			}
			if (!localAudioSource || localAudioSource.mediaStream !== localAudioStream) {
				if (localAudioSource) localAudioSource.disconnect();
				try {
					localAudioSource = audioContext.createMediaStreamSource(localAudioStream);
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
				// Normalize to 0-1 (values above ~50 are loud speech)
				const amplitude = Math.min(1, average / 50);

				speakingUsers.update((set) => {
					const newSet = new SvelteSet(set);
					if (average > 10 && !$isMuted && myUserId) newSet.add(myUserId);
					else if (myUserId) newSet.delete(myUserId);
					return newSet;
				});
				if (myUserId) {
					userAmplitudes[myUserId] = average > 10 && !$isMuted ? amplitude : 0;
				}

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
			screen_sharing: $isScreenSharing,
		});
	}

	$effect(() => {
		const shouldSend = !$isMuted && !$isDeafened;
		if (audioSender) {
			const audioTrack = localAudioStream?.getAudioTracks().at(0) ?? null;
			audioSender.replaceTrack(shouldSend ? audioTrack : null).catch(console.warn);
		}
	});

	$effect(() => {
		if (peerConnection && currentMicId !== $selectedMicId) {
			currentMicId = $selectedMicId;
			switchMicrophone($selectedMicId).catch((err) => console.error("Failed to switch mic", err));
		}
	});

	async function switchMicrophone(deviceId: string) {
		const constraints = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
		const newRawStream = await navigator.mediaDevices.getUserMedia(constraints);

		// Cleanup old denoise
		if (denoiseCleanup) {
			denoiseCleanup();
			denoiseCleanup = null;
		}
		if (rawMicStream) {
			rawMicStream.getTracks().forEach((t) => t.stop());
		}
		rawMicStream = newRawStream;

		// Apply denoise to new stream
		if (!audioContext) {
			audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		}
		try {
			const denoised = await createDenoisedStream(newRawStream, audioContext);
			localAudioStream = denoised.stream;
			denoiseCleanup = denoised.cleanup;
		} catch {
			localAudioStream = newRawStream;
		}

		const newTrack = localAudioStream.getAudioTracks().at(0);
		if (newTrack && audioSender) {
			const shouldSend = !$isMuted && !$isDeafened;
			await audioSender.replaceTrack(shouldSend ? newTrack : null);
		}

		if (audioContext && localAnalyser) {
			if (localAudioSource) {
				localAudioSource.disconnect();
			}
			localAudioSource = audioContext.createMediaStreamSource(localAudioStream);
			localAudioSource.connect(localAnalyser);
		}
	}

	async function toggleScreenShare() {
		if ($isScreenSharing) {
			// Remove the video sender from the existing connection — no reconnect needed
			const sender = peerConnection?.getSenders().find((s) => s.track?.kind === "video");
			if (sender) {
				peerConnection?.removeTrack(sender);
			}
			localVideoStream?.getTracks().forEach((t) => t.stop());
			localVideoStream = null;
			isScreenSharing.set(false);
			sendEventMessage("VOICE_SYNC", {
				room_id: channelId,
				muted: $isMuted,
				deafened: $isDeafened,
				screen_sharing: false,
			});
		} else {
			try {
				localVideoStream = await navigator.mediaDevices.getDisplayMedia({
					video: true,
				});
				isScreenSharing.set(true);
				sendEventMessage("VOICE_SYNC", {
					room_id: channelId,
					muted: $isMuted,
					deafened: $isDeafened,
					screen_sharing: true,
				});

				const videoTrack = localVideoStream.getVideoTracks().at(0);
				if (!videoTrack) return;

				videoTrack.onended = () => {
					if ($isScreenSharing) toggleScreenShare(); // turn off when user clicks browser's stop sharing
				};

				// Add directly to the live peerConnection — the server's OnTrack will
				// fire and renegotiatePeer will push the track to all other peers.
				peerConnection?.addTrack(videoTrack, localVideoStream);
			} catch (err) {
				console.error("Screen share failed", err);
			}
		}
	}

	function srcObject(node: HTMLAudioElement | HTMLVideoElement, stream: MediaStream) {
		node.srcObject = stream;
		return {
			update(newStream: MediaStream) {
				if (node.srcObject !== newStream) {
					node.srcObject = newStream;
				}
			},
		};
	}

	function registerVideoEl(node: HTMLVideoElement, userId: string) {
		videoEls[userId] = node;
		return {
			destroy() {
				delete videoEls[userId];
			},
		};
	}

	function startVideo(userId: string) {
		videoClickedStates = { ...videoClickedStates, [userId]: true };
		videoEls[userId]?.play().catch(console.warn);
	}

	// Use an action to imperatively set the muted property on <audio> elements.
	// Svelte's muted={expr} binding may only set the HTML attribute (initial state)
	// and not the runtime DOM property on already-playing elements.
	function applyMuted(node: HTMLAudioElement, muted: boolean) {
		node.muted = muted;
		return {
			update(newMuted: boolean) {
				node.muted = newMuted;
			},
		};
	}

	const voiceUsers = $derived(
		(() => {
			const fromGateway = $gatewaySpaces.flatMap((space) => {
				const room = space.rooms.find((r) => r.id === channelId);
				if (!room) return [];
				const voiceStates = space.voice_states?.filter((vs) => vs.room_id === channelId) ?? [];
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
		})(),
	);
</script>

<div
	class="relative flex flex-1 flex-col text-white {compact
		? 'bg-transparent'
		: 'border-l border-zinc-800 bg-zinc-900 p-6'}"
>
	{#if !compact}
		<div class="mb-4">
			<h1 class="flex items-center gap-2 text-2xl font-bold">
				<span class="text-zinc-400 opacity-60">🔊</span>
				{channelName}
			</h1>
			<p
				class="text-sm {$connectionState === 'connected'
					? 'text-zinc-400'
					: $connectionState === 'disconnected'
						? 'text-yellow-400'
						: $connectionState === 'failed' || $connectionState === 'closed'
							? 'text-red-400'
							: 'text-zinc-500'}"
			>
				{connectionLabel[$connectionState]}
			</p>
		</div>
	{/if}

	<div
		class="flex-1 overflow-y-auto {compact ? 'pb-14' : 'pb-24'} {voiceUsers.length === 1
			? 'flex flex-col p-4'
			: focusedUserId
				? 'flex flex-row flex-wrap content-start gap-4 p-4'
				: 'grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] content-start gap-4 p-4'}"
	>
		{#each voiceUsers as user (user.id)}
			{@const isLocal = user.id === myUserId}
			{@const videoStream = isLocal ? localVideoStream : remoteVideoElements[user.id]}
			{@const audioStream = isLocal ? null : remoteAudioElements[user.id]}
			{@const isSpeaking = $speakingUsers.has(user.id)}
			{@const isForceMuted =
				(!isLocal && audioStream && audioStream.getAudioTracks().every((t) => !t.enabled)) || user.muted}

			<div
				class="relative flex cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-zinc-800/70 shadow-lg transition-all {voiceUsers.length ===
				1
					? 'min-h-0 w-full flex-1'
					: focusedUserId === user.id
						? 'order-first h-[60vh] w-full'
						: focusedUserId
							? 'h-48 w-64 shrink-0'
							: compact
								? 'h-32'
								: 'h-64'} {isSpeaking && !user.muted
					? 'border-transparent ring-2 ring-stone-400 ring-inset'
					: 'border-zinc-700 hover:border-zinc-500'}"
				onclick={() => (focusedUserId = focusedUserId === user.id ? null : user.id)}
				role="button"
				tabindex="0"
				onkeydown={(e) => {
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
						use:registerVideoEl={user.id}
						playsinline
						muted
						class="h-full w-full object-contain backdrop-blur-md transition-opacity duration-300 {videoPlayingStates[
							user.id
						]
							? 'opacity-100'
							: 'opacity-0'}"
						onplaying={() =>
							(videoPlayingStates = {
								...videoPlayingStates,
								[user.id]: true,
							})}
						onwaiting={() =>
							(videoPlayingStates = {
								...videoPlayingStates,
								[user.id]: false,
							})}
					>
						<track kind="captions" srclang="en" label="captions" />
					</video>

					{#if !isLocal && !videoClickedStates[user.id]}
						<button
							class="absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center rounded-lg bg-black/70 backdrop-blur-sm"
							onclick={(e) => {
								e.stopPropagation();
								startVideo(user.id);
							}}
							aria-label="Ver stream"
						>
							<Play class="mb-3 size-10 text-zinc-300" />
							<span class="text-sm font-medium text-zinc-300">Clic para ver</span>
						</button>
					{:else if !videoPlayingStates[user.id]}
						<div
							class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-black/60 backdrop-blur-sm"
						>
							<LoaderCircle class="mb-3 size-10 animate-spin text-zinc-300" />
							<span class="text-sm font-medium text-zinc-300">Connecting video...</span>
						</div>
					{/if}
				{:else}
					<div class="relative flex items-center justify-center">
						{#if isSpeaking && !isForceMuted}
							<span
								class="absolute size-38.5 animate-[voice-pulse_1.1s_ease-out_infinite] rounded-full border border-emerald-300/30"
							></span>
							<span
								class="absolute size-34 animate-[voice-pulse_1.1s_ease-out_0.35s_infinite] rounded-full border border-emerald-300/45"
							></span>
							<span
								class="absolute size-29.5 animate-[voice-glow_0.9s_ease-in-out_infinite] rounded-full bg-emerald-300/12"
							></span>
						{/if}
						<div class="relative">
							<UserAvatar
								src={user.avatar_url}
								name={user.username}
								size={96}
								mouthOpen={userAmplitudes[user.id] ?? 0}
								class={isSpeaking && !isForceMuted ? "voice-avatar-speaking" : ""}
							/>
						</div>
					</div>
				{/if}

				<div
					class="absolute bottom-4 left-4 flex items-center gap-2 rounded-md bg-black/60 px-3 py-1.5 text-white backdrop-blur-md"
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
				use:applyMuted={$isDeafened || (voiceUsers.find((u) => u.id === id)?.muted ?? false)}
				autoplay
				aria-label={`Audio stream ${id}`}
			></audio>
		{/each}
	</div>

	<div
		class="absolute {compact
			? 'bottom-2 gap-2 px-3 py-2'
			: 'bottom-8 gap-4 px-6 py-3'} left-1/2 flex -translate-x-1/2 items-center rounded-full border border-zinc-700 bg-zinc-800/80 shadow-xl backdrop-blur-md"
	>
		<button
			class="rounded-full p-4 hover:bg-zinc-700 {$isScreenSharing
				? 'bg-stone-400/20 text-stone-200 hover:bg-stone-400/30'
				: 'text-zinc-200'} transition-all"
			onclick={toggleScreenShare}
			aria-label="Share Screen"
		>
			<MonitorUp class="size-5" />
		</button>
		<button
			class="rounded-full bg-red-500/20 p-4 text-red-400 transition-all hover:bg-red-500/40"
			onclick={leaveVoice}
			aria-label="Leave Voice"
		>
			<PhoneOff class="size-5" />
		</button>
	</div>
</div>

<style>
	:global(.voice-avatar-speaking) {
		box-shadow:
			0 0 0 2px oklch(0.8 0.12 160 / 0.35),
			0 0 30px oklch(0.8 0.12 160 / 0.2);
		animation: voice-avatar-breath 0.9s ease-in-out infinite;
	}

	@keyframes voice-pulse {
		0% {
			transform: scale(0.9);
			opacity: 0.35;
		}
		100% {
			transform: scale(1.08);
			opacity: 0;
		}
	}

	@keyframes voice-glow {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(1);
		}
		50% {
			opacity: 0.6;
			transform: scale(1.06);
		}
	}

	@keyframes voice-avatar-breath {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.03);
		}
	}
</style>
