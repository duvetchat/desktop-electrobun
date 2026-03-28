<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { onWebRTCEvent, sendEventMessage } from "$lib/api/ws/connection";
	import { activeCall, isMuted, isDeafened, selectedMicId } from "$lib/stores.svelte";
	import { createDenoisedStream } from "$lib/audio/noise-suppression";

	let { conversationId }: { conversationId: string } = $props();

	let peerConnection: RTCPeerConnection | null = null;
	let localAudioStream: MediaStream | null = null;
	let rawMicStream: MediaStream | null = null;
	let denoiseCleanup: (() => void) | null = null;
	let audioContext: AudioContext | null = null;
	let audioSender: RTCRtpSender | null = null;
	let pendingIceCandidates: RTCIceCandidate[] = [];
	let negotiationReady = false;
	let negotiationChain: Promise<void> = Promise.resolve();
	let voiceJoinedResolve: (() => void) | null = null;
	let voiceJoinedPromise: Promise<void> = Promise.resolve();
	let remoteAudioElements = $state<{ [id: string]: MediaStream }>({});
	let isDestroyed = false;
	let unsubscribeWs: () => void;

	let currentMicId = $state($selectedMicId);

	function leaveCall() {
		if (isDestroyed) return;
		isDestroyed = true;
		sendEventMessage("VOICE_LEAVE", { room_id: conversationId });
		sendEventMessage("CALL_LEAVE", { conversation_id: conversationId });
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
		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}
		if (unsubscribeWs) unsubscribeWs();
	}

	onMount(async () => {
		unsubscribeWs = onWebRTCEvent((type, data: any) => {
			if (data.room_id !== conversationId) return;

			if (type === "VOICE_JOINED") {
				const pc = peerConnection;
				if (!pc) return;
				pc.setRemoteDescription(new RTCSessionDescription(data.answer))
					.then(() => {
						if (pc !== peerConnection) return;
						const toFlush = pendingIceCandidates;
						pendingIceCandidates = [];
						for (const candidate of toFlush) {
							pc.addIceCandidate(candidate).catch(console.warn);
						}
						negotiationReady = true;
					})
					.catch(console.warn)
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
				const readyGate = voiceJoinedPromise;
				negotiationChain = negotiationChain
					.then(async () => {
						await readyGate;
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
							room_id: conversationId,
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

		// Get microphone with noise suppression
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
			console.error("[CallAudio] Failed to get local audio", e);
			if (rawMicStream && !localAudioStream) localAudioStream = rawMicStream;
		}

		connectWebRTC();
	});

	onDestroy(() => {
		leaveCall();
	});

	async function connectWebRTC() {
		if (peerConnection) {
			peerConnection.close();
		}
		remoteAudioElements = {};
		pendingIceCandidates = [];
		negotiationReady = false;
		negotiationChain = Promise.resolve();
		voiceJoinedPromise = new Promise<void>((resolve) => {
			voiceJoinedResolve = resolve;
		});
		audioSender = null;

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
					room_id: conversationId,
					offer: offer,
				});
			} catch (err) {
				console.error("[CallAudio] negotiationneeded error:", err);
			}
		};

		peerConnection.onconnectionstatechange = () => {
			const state = peerConnection?.connectionState;
			if (state === "failed" && !isDestroyed) {
				leaveCall();
				activeCall.set(null);
			}
		};

		peerConnection.onicecandidate = (event) => {
			if (event.candidate) {
				sendEventMessage("WEBRTC_ICE_CANDIDATE", {
					room_id: conversationId,
					candidate: event.candidate.toJSON(),
				});
			}
		};

		peerConnection.ontrack = (event) => {
			const stream = event.streams.at(0);
			if (!stream) return;

			stream.onremovetrack = () => {
				delete remoteAudioElements[stream.id];
				remoteAudioElements = { ...remoteAudioElements };
			};

			event.track.onended = () => {
				delete remoteAudioElements[stream.id];
				remoteAudioElements = { ...remoteAudioElements };
			};

			if (event.track.kind === "audio") {
				remoteAudioElements[stream.id] = stream;
				remoteAudioElements = { ...remoteAudioElements };
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
		} else {
			peerConnection?.addTransceiver("audio", { direction: "recvonly" });
		}

		// Add a recvonly video transceiver to satisfy the SDP negotiation
		peerConnection?.addTransceiver("video", { direction: "recvonly" });

		const offer = await peerConnection.createOffer();
		await peerConnection.setLocalDescription(offer);

		sendEventMessage("VOICE_JOIN", {
			room_id: conversationId,
			offer: offer,
		});

		sendEventMessage("VOICE_SYNC", {
			room_id: conversationId,
			muted: $isMuted,
			deafened: $isDeafened,
			screen_sharing: false,
		});
	}

	// Mute/unmute reactivity
	$effect(() => {
		const shouldSend = !$isMuted && !$isDeafened;
		if (audioSender) {
			const audioTrack = localAudioStream?.getAudioTracks().at(0) ?? null;
			audioSender.replaceTrack(shouldSend ? audioTrack : null).catch(console.warn);
		}
	});

	// Mic switch reactivity
	$effect(() => {
		if (peerConnection && currentMicId !== $selectedMicId) {
			currentMicId = $selectedMicId;
			switchMicrophone($selectedMicId).catch((err) => console.error("[CallAudio] Failed to switch mic", err));
		}
	});

	async function switchMicrophone(deviceId: string) {
		const constraints = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
		const newRawStream = await navigator.mediaDevices.getUserMedia(constraints);

		if (denoiseCleanup) {
			denoiseCleanup();
			denoiseCleanup = null;
		}
		if (rawMicStream) {
			rawMicStream.getTracks().forEach((t) => t.stop());
		}
		rawMicStream = newRawStream;

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
	}

	function srcObject(node: HTMLAudioElement, stream: MediaStream) {
		node.srcObject = stream;
		return {
			update(newStream: MediaStream) {
				if (node.srcObject !== newStream) {
					node.srcObject = newStream;
				}
			},
		};
	}

	function applyMuted(node: HTMLAudioElement, muted: boolean) {
		node.muted = muted;
		return {
			update(newMuted: boolean) {
				node.muted = newMuted;
			},
		};
	}
</script>

<!-- Hidden audio elements for remote streams -->
<div class="hidden">
	{#each Object.entries(remoteAudioElements) as [id, stream] (id)}
		<audio use:srcObject={stream} use:applyMuted={$isDeafened} autoplay aria-label={`Call audio stream ${id}`}></audio>
	{/each}
</div>
