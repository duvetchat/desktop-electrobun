<script lang="ts">
	import { onDestroy, onMount, untrack } from "svelte";
	import { get } from "svelte/store";
	import { SvelteSet } from "svelte/reactivity";
	import { gatewayConnection, onWebRTCEvent, sendEventMessage, wantFreshSession } from "$lib/api/ws/connection";
	import { REJOIN_WINDOW_MS, sendAgain } from "$lib/resend";
	import { audioStore } from "$lib/stores/audio.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { hasPermission, Permission } from "$lib/permissions";
	import { askForMicWith, sendVoiceSync } from "$lib/voice";
	import {
		CAMERA_MAX_BITRATE,
		CAMERA_MAX_FRAMERATE,
		cameraConstraints,
		cameraErrorMessage,
		readStreamId,
		videoRefusedMessage,
		vp8First,
	} from "$lib/video";
	import type { VoiceVideoRefusedEvent } from "$lib/types";
	import {
		activeCall,
		activeVoiceRoomId,
		cameraRequested,
		currentUser,
		dropVoiceRequests,
		gatewaySpaces,
		iceServers,
		incomingVideo,
		isCameraOn,
		isDeafened,
		isMuted,
		isScreenSharing,
		noiseSuppression,
		screenShareRequested,
		selectedCameraId,
		selectedMicId,
		speakingUsers,
		userAmplitudes,
		voiceConnectionState,
		voiceLocalCameraStream,
		voiceLocalVideoStream,
		voiceRemoteCameraStreams,
		voiceRemoteVideoStreams,
	} from "$lib/stores.svelte";

	// The noise suppression loads when the mic needs it: its RNNoise WASM, 4.8 MB of base64, rode in the app page's chunk
	// and was parsed at every start (#285). A load that fails falls back to the raw mic, as a suppression that fails does.
	const createDenoisedStream: typeof import("$lib/audio/noise-suppression").createDenoisedStream = async (
		stream,
		ctx,
	) => (await import("$lib/audio/noise-suppression")).createDenoisedStream(stream, ctx);

	// Mounted hidden (routes/app/+page.svelte) while this client is in a voice room or a call: it carries the
	// WebRTC connection, captures the mic, the camera and the screen, and plays everyone's audio. What's seen of
	// a voice room is VoiceChannelView.
	let { channelId }: { channelId: string } = $props();
	// The room or call this one is for. channelId reads activeVoiceRoomId, so it's already the next room (or null)
	// in the moment before {#key} destroys this one.
	const ownRoomId = untrack(() => channelId);

	let peerConnection: RTCPeerConnection | null = null;
	let localAudioStream = $state<MediaStream | null>(null);
	let audioSender: RTCRtpSender | null = null;
	/** The screen this client shares, with its sound when it has any. */
	let localScreenStream = $state<MediaStream | null>(null);
	/** Sends the camera. It's created with the connection and VOICE_JOIN names it by its mid, so turning the
	 * camera on or off is a replaceTrack: never a renegotiation that could cross one from the gateway. */
	let cameraTransceiver: RTCRtpTransceiver | null = null;
	let localCameraStream = $state<MediaStream | null>(null);
	let cameraChain: Promise<void> = Promise.resolve();
	let pendingIceCandidates: RTCIceCandidate[] = [];
	let negotiationReady = false;
	let negotiationChain: Promise<void> = Promise.resolve();
	let webrtcGeneration = 0;
	// Resolves once VOICE_JOINED has been processed. Every WEBRTC_RENEGOTIATE
	// awaits this gate so it never runs before the initial answer is applied.
	let voiceJoinedResolve: (() => void) | null = null;
	let voiceJoinedPromise: Promise<void> = Promise.resolve();

	// What others send, by user ID: their `<user_id>` stream (voice, and their screen and its sound while
	// they share it) and their `<user_id>.camera` stream.
	let remoteAudioStreams = $state<Record<string, MediaStream>>({});
	let remoteScreenStreams = $state<Record<string, MediaStream>>({});
	let remoteCameraStreams = $state<Record<string, MediaStream>>({});

	$effect(() => {
		voiceRemoteVideoStreams.set(remoteScreenStreams);
	});
	$effect(() => {
		voiceLocalVideoStream.set(localScreenStream);
	});
	$effect(() => {
		voiceRemoteCameraStreams.set(remoteCameraStreams);
	});
	$effect(() => {
		voiceLocalCameraStream.set(localCameraStream);
	});

	// Only this room's or call's requests: one for another was left where no VoiceChat took it, and is dropped.
	$effect(() => {
		const request = $screenShareRequested;
		if (!request) return;
		screenShareRequested.set(null);
		if (request.roomId === channelId) void toggleScreenShare(request.withAudio);
	});

	let unsubscribeWs: () => void;
	let audioContext: AudioContext | null = null;
	let localAnalyser: AnalyserNode | null = null;
	let localAudioSource: MediaStreamAudioSourceNode | null = null;
	let localMeterRunning = false;
	let denoiseCleanup: (() => void) | null = null;
	let rawMicStream: MediaStream | null = null;
	let isDestroyed = false;
	// onMount got as far as joining: from then on, each new gateway session (READY) joins again.
	let joining = false;
	// The gateway connection the last VOICE_JOIN went out on, and whether its VOICE_JOINED came.
	let joinedOn: number | null = null;
	let joinAnswered = false;
	// The gateway answers a join it refuses with nothing (its permissions changed while it restarted, say).
	const JOIN_TIMEOUT_MS = 15_000;

	const myUserId = $derived($currentUser?.id ?? null);
	const isCall = $derived($activeCall?.conversationId === channelId);
	// The space room this is; null in a call, and for a moment while the gateway reconnects.
	const voiceRoom = $derived.by(() => {
		const space = $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === channelId));
		const room = space?.rooms.find((r) => r.id === channelId);
		return space && room ? { space, room } : null;
	});
	// The camera and the screen need Video in a room; a call asks for no permission.
	const canVideo = $derived(!voiceRoom || hasPermission(voiceRoom.space, voiceRoom.room, Permission.Video));

	function leaveVoice() {
		if (isDestroyed) return;
		isDestroyed = true;
		askForMicWith(null);
		audioStore.play("leave_vc");
		sendEventMessage("VOICE_LEAVE", { room_id: channelId });
		if (peerConnection) {
			peerConnection.close();
			peerConnection = null;
		}
		cameraTransceiver = null;
		if (denoiseCleanup) {
			denoiseCleanup();
			denoiseCleanup = null;
		}
		if (rawMicStream) {
			rawMicStream.getTracks().forEach((t) => t.stop());
			rawMicStream = null;
		}
		stopTracks(localAudioStream);
		stopTracks(localScreenStream);
		// Stopping the camera's track is what turns its light off.
		stopTracks(localCameraStream);
		localCameraStream = null;
		dropVoiceRequests();
		if (audioContext) audioContext.close();
		if (unsubscribeWs) unsubscribeWs();
		// Only clear global stores if we're still the active voice session
		if ($activeVoiceRoomId === channelId || $activeVoiceRoomId === null) {
			speakingUsers.set(new SvelteSet());
			voiceRemoteVideoStreams.set({});
			voiceLocalVideoStream.set(null);
			voiceRemoteCameraStreams.set({});
			voiceLocalCameraStream.set(null);
			isScreenSharing.set(false);
			isCameraOn.set(false);
		}
		if ($activeVoiceRoomId === channelId) activeVoiceRoomId.set(null);
	}

	let currentMicId = $state($selectedMicId);

	function handleWebRTCEvent(type: string, data: any) {
		// A new gateway session (it restarted for a deploy, or this client's ended while it was away) has no voice
		// connection of this client's: join again on it, with the mic, the camera and the screen as they are.
		if (type === "READY") {
			// A join sent on this connection went out after its identify, so it's already in the new session.
			if (!joining || isDestroyed || $activeVoiceRoomId !== ownRoomId || joinedOn === gatewayConnection()) return;
			if (joinedOn !== null && data.silent_ms > REJOIN_WINDOW_MS) {
				toast("You left voice: the connection was lost for a while", "error");
				leaveVoice();
			} else joinVoice();
			return;
		}
		// A resumed session answered in its replay what the gateway got before the socket dropped: a join still
		// unanswered, which went out on the dropped connection, never reached it, and joins again here. Each connection
		// gets READY or RESUMED, never both.
		if (type === "RESUMED") {
			const connection = gatewayConnection();
			if (!joining || isDestroyed || $activeVoiceRoomId !== ownRoomId || connection === null) return;
			const join = joinedOn === null ? null : { sentOn: joinedOn, answered: joinAnswered };
			if (sendAgain(join, connection)) joinVoice();
			return;
		}
		if (data.room_id !== channelId) return;

		if (type === "VOICE_JOINED") {
			joinAnswered = true;
			audioStore.play("join_vc");
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
		} else if (type === "VOICE_VIDEO_REFUSED") {
			onVideoRefused(data as VoiceVideoRefusedEvent);
		}
	}

	onMount(async () => {
		unsubscribeWs = onWebRTCEvent(handleWebRTCEvent);
		// A camera or screen left on in the room just left stayed there: this connection starts without them.
		isScreenSharing.set(false);
		isCameraOn.set(false);

		// For conversation calls (no space/room), always allow speaking
		const canSpeak = voiceRoom ? hasPermission(voiceRoom.space, voiceRoom.room, Permission.SpeakInVoice) : true;
		couldSpeak = canSpeak;

		if (!canSpeak) {
			isMuted.set(true);
		} else {
			try {
				await acquireMic();
			} catch (e) {
				console.error("[Voice] Failed to get local audio:", e);
				// It joins all the same, to listen, muted, as the others then see it: unmuting asks for the microphone again.
				if (!isDestroyed) {
					isMuted.set(true);
					askForMicWith(askForMicAgain);
					toast("Duvet can't use the microphone: you're listening only", "error");
				}
			}
		}
		// Left while the browser was asking for the mic: don't join after all.
		if (isDestroyed) return;

		activeVoiceRoomId.set(channelId);
		joining = true;
		joinVoice();
	});

	onDestroy(() => {
		leaveVoice();
	});

	function ensureAudioContext(): AudioContext {
		if (!audioContext) {
			audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		}
		return audioContext;
	}

	function stopTracks(stream: MediaStream | null) {
		stream?.getTracks().forEach((t) => t.stop());
	}

	const isLive = (track: MediaStreamTrack) => track.readyState === "live";

	function without(streams: Record<string, MediaStream>, userId: string): Record<string, MediaStream> {
		const next = { ...streams };
		delete next[userId];
		return next;
	}

	/** Opens the selected microphone into localAudioStream, denoised when that's on. If voice was
	 * left meanwhile, the mic is released again instead. */
	async function acquireMic() {
		const constraints = $selectedMicId ? { audio: { deviceId: { exact: $selectedMicId } } } : { audio: true };
		const stream = await navigator.mediaDevices.getUserMedia(constraints);
		if (isDestroyed) {
			stream.getTracks().forEach((t) => t.stop());
			return;
		}
		rawMicStream = stream;
		const ctx = ensureAudioContext();
		if (!$noiseSuppression) {
			localAudioStream = stream;
			return;
		}
		try {
			const denoised = await createDenoisedStream(stream, ctx);
			if (isDestroyed) {
				denoised.cleanup();
				stream.getTracks().forEach((t) => t.stop());
				return;
			}
			localAudioStream = denoised.stream;
			denoiseCleanup = denoised.cleanup;
		} catch (e) {
			console.error("[Voice] Noise suppression failed, using the raw microphone:", e);
			localAudioStream = stream;
		}
	}

	/** A user's speaking ring and their face's mouth, from the average level of their audio: the stores change only as
	 * what they show does, not every frame for every user in voice (#324). */
	function showLevel(userId: string, average: number) {
		const speaking = average > 10;
		if (get(speakingUsers).has(userId) !== speaking)
			speakingUsers.update((set) => {
				const next = new SvelteSet(set);
				if (speaking) next.add(userId);
				else next.delete(userId);
				return next;
			});
		const amplitude = speaking ? Math.min(1, average / 50) : 0;
		if (get(userAmplitudes)[userId] !== amplitude) userAmplitudes.update((a) => ({ ...a, [userId]: amplitude }));
	}

	function averageLevel(data: Uint8Array): number {
		let sum = 0;
		for (let i = 0; i < data.length; i++) {
			sum += data[i]!;
		}
		return sum / data.length;
	}

	/** Points the local meter at the stream being sent. Noise suppression and a mic switch replace that
	 * stream: a meter left on the old one showed this user silent until they rejoined. */
	function connectLocalMeter(stream: MediaStream) {
		const ctx = ensureAudioContext();
		if (!localAnalyser) {
			localAnalyser = ctx.createAnalyser();
			localAnalyser.fftSize = 256;
		}
		if (localAudioSource?.mediaStream === stream) return;
		localAudioSource?.disconnect();
		localAudioSource = null;
		try {
			localAudioSource = ctx.createMediaStreamSource(stream);
			localAudioSource.connect(localAnalyser);
		} catch (err) {
			console.error("[Voice] Couldn't meter the microphone:", err);
		}
	}

	$effect(() => {
		const stream = localAudioStream;
		if (stream && localMeterRunning) connectLocalMeter(stream);
	});

	/** Drives the speaking indicator of the local user from localAudioStream. */
	function startLocalLevelMeter() {
		const stream = localAudioStream;
		if (!stream) return;
		connectLocalMeter(stream);
		if (localMeterRunning || !localAnalyser) return;
		localMeterRunning = true;

		const analyser = localAnalyser;
		const dataArray = new Uint8Array(analyser.frequencyBinCount);

		// It meters the mic, not the connection, so a join again keeps it going.
		const checkLocalLevel = () => {
			if (isDestroyed || !audioContext) {
				localMeterRunning = false;
				return;
			}
			analyser.getByteFrequencyData(dataArray);
			if (myUserId) showLevel(myUserId, $isMuted ? 0 : averageLevel(dataArray));
			requestAnimationFrame(checkLocalLevel);
		};
		checkLocalLevel();
	}

	// The audio track that drives each remote user's speaking ring and face: one per user, as a shared tab's
	// sound comes in the same stream as the voice and two meters would fight over the ring.
	const meteredTracks = new Map<string, MediaStreamTrack>();

	/** Meters a remote user's first live audio track, their voice in the usual order, unless one is metered
	 * already. When that track leaves the stream, the next one takes over: a voice that came after a shared
	 * tab's sound (they joined muted) is metered once the tab's sound ends. */
	function meterUser(userId: string, stream: MediaStream) {
		const current = meteredTracks.get(userId);
		if (current && isLive(current) && stream.getAudioTracks().includes(current)) return;
		const next = stream.getAudioTracks().find(isLive);
		if (!next) {
			meteredTracks.delete(userId);
			return;
		}
		meteredTracks.set(userId, next);
		startRemoteMeter(userId, next, stream);
	}

	function startRemoteMeter(userId: string, track: MediaStreamTrack, stream: MediaStream) {
		const ctx = ensureAudioContext();
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 256;
		const source = ctx.createMediaStreamSource(new MediaStream([track]));
		source.connect(analyser);
		const dataArray = new Uint8Array(analyser.frequencyBinCount);
		const gen = webrtcGeneration;

		const checkAudioLevel = () => {
			if (isDestroyed || !audioContext || gen !== webrtcGeneration) return;
			if (meteredTracks.get(userId) !== track || !isLive(track) || !stream.getAudioTracks().includes(track)) {
				source.disconnect();
				showLevel(userId, 0);
				if (meteredTracks.get(userId) === track) {
					meteredTracks.delete(userId);
					meterUser(userId, stream);
				}
				return;
			}
			analyser.getByteFrequencyData(dataArray);
			showLevel(userId, averageLevel(dataArray));
			requestAnimationFrame(checkAudioLevel);
		};
		checkAudioLevel();
	}

	// Joined without SpeakInVoice, then got it: open the mic once per grant (a failure isn't retried
	// on every store update) and send on the audio transceiver. Self-mute stays as it was set on
	// joining, so nobody's mic goes live by surprise.
	let couldSpeak = true; // SpeakInVoice as last seen; onMount sets it to the value on joining
	$effect(() => {
		if (!voiceRoom) return;
		if (!hasPermission(voiceRoom.space, voiceRoom.room, Permission.SpeakInVoice)) {
			couldSpeak = false;
			return;
		}
		if (couldSpeak || localAudioStream || !audioSender) return;
		couldSpeak = true;
		acquireMic()
			.then(async () => {
				const track = localAudioStream?.getAudioTracks().at(0) ?? null;
				if (!track || !audioSender) return;
				await audioSender.replaceTrack(!$isMuted && !$isDeafened ? track : null);
				startLocalLevelMeter();
			})
			.catch((err) => {
				console.error("[Voice] Failed to open the mic after getting SpeakInVoice:", err);
				toast("Couldn't open your microphone", "error");
				if (!isDestroyed) askForMicWith(askForMicAgain);
			});
	});

	/** Asks the browser for the microphone again, for an unmute (askForMicWith): open, it's sent once the unmute takes
	 * the user's mute off (the effect on isMuted below), and the meter follows it. Resolves whether it's open: not while
	 * the browser still refuses it, nor once voice was left. */
	async function askForMicAgain(): Promise<boolean> {
		if (localAudioStream) return true;
		try {
			await acquireMic();
		} catch (err) {
			console.error("[Voice] The microphone is still refused:", err);
			return false;
		}
		if (isDestroyed || !localAudioStream) return false;
		askForMicWith(null);
		startLocalLevelMeter();
		return true;
	}

	/** Which of this client's transceivers carries what, by mid, for VOICE_JOIN and WEBRTC_RENEGOTIATE_OFFER:
	 * the gateway takes any other video it gets for the screen. */
	function trackLabels(): Record<string, "camera"> {
		const mid = cameraTransceiver?.mid;
		return mid ? { [mid]: "camera" } : {};
	}

	/** Offers VP8 first on the camera's transceiver: the gateway forwards it as it comes, and every viewer
	 * decodes VP8. */
	function preferVP8(transceiver: RTCRtpTransceiver) {
		const codecs = RTCRtpReceiver.getCapabilities?.("video")?.codecs;
		if (!codecs || typeof transceiver.setCodecPreferences !== "function") return;
		try {
			transceiver.setCodecPreferences(vp8First(codecs));
		} catch (err) {
			console.warn("[Voice] Couldn't put VP8 first for the camera:", err);
		}
	}

	function handleTrack(event: RTCTrackEvent) {
		const stream = event.streams.at(0);
		const source = stream ? readStreamId(stream.id) : null;
		if (!stream || !source) return;
		const { userId } = source;
		const track = event.track;

		if (source.camera) {
			if (track.kind !== "video") return;
			remoteCameraStreams = { ...remoteCameraStreams, [userId]: stream };
			// Taken away when its owner leaves, or when this client turns incoming video off.
			const drop = () => {
				if (stream.getVideoTracks().some(isLive) || remoteCameraStreams[userId] !== stream) return;
				remoteCameraStreams = without(remoteCameraStreams, userId);
			};
			stream.onremovetrack = drop;
			track.onended = drop;
			return;
		}

		// Each kind stays until its last track has left: a shared tab's sound ending mustn't silence the voice.
		const drop = () => {
			if (!stream.getAudioTracks().some(isLive) && remoteAudioStreams[userId] === stream) {
				remoteAudioStreams = without(remoteAudioStreams, userId);
			}
			if (!stream.getVideoTracks().some(isLive) && remoteScreenStreams[userId] === stream) {
				remoteScreenStreams = without(remoteScreenStreams, userId);
			}
		};
		stream.onremovetrack = drop;
		track.onended = drop;

		if (track.kind === "audio") {
			remoteAudioStreams = { ...remoteAudioStreams, [userId]: stream };
			meterUser(userId, stream);
		} else {
			remoteScreenStreams = { ...remoteScreenStreams, [userId]: stream };
		}
	}

	// Joins, or joins again. One that can't even start (WebRTC is off in this browser, say) leaves with a notice, as one the
	// gateway doesn't answer does, rather than wait for good with the mic open. An attempt that a newer one replaced fails
	// for that, its connection closed, and says nothing.
	function joinVoice() {
		const attempt = connectWebRTC();
		const generation = webrtcGeneration;
		attempt.catch((err) => {
			console.error("[Voice] Couldn't connect:", err);
			if (generation !== webrtcGeneration || isDestroyed) return;
			toast("Couldn't connect to voice", "error");
			leaveVoice();
		});
	}

	async function connectWebRTC() {
		// The gateway is down (restarting, or this client is offline), and a VOICE_JOIN sent now would be lost: the
		// next session's READY joins.
		if (gatewayConnection() === null) {
			wantFreshSession();
			voiceConnectionState.set("new");
			return;
		}
		if (peerConnection) {
			peerConnection.close();
		}
		webrtcGeneration++;
		remoteAudioStreams = {};
		remoteScreenStreams = {};
		remoteCameraStreams = {};
		meteredTracks.clear();
		pendingIceCandidates = [];
		negotiationReady = false;
		negotiationChain = Promise.resolve();
		voiceJoinedPromise = new Promise<void>((resolve) => {
			voiceJoinedResolve = resolve;
		});
		audioSender = null;
		voiceConnectionState.set("new");

		const pc = new RTCPeerConnection({
			iceServers: $iceServers,
		});
		peerConnection = pc;

		pc.onnegotiationneeded = async () => {
			if (!negotiationReady || pc !== peerConnection) return;
			try {
				const offer = await pc.createOffer();
				if (pc !== peerConnection) return;
				await pc.setLocalDescription(offer);
				sendEventMessage("WEBRTC_RENEGOTIATE_OFFER", {
					room_id: channelId,
					offer: offer,
					tracks: trackLabels(),
				});
			} catch (err) {
				console.error("[WebRTC] negotiationneeded error:", err);
			}
		};

		pc.onconnectionstatechange = () => {
			const state = pc.connectionState;
			if (pc !== peerConnection) return;
			voiceConnectionState.set(state);
			if (state !== "failed" || isDestroyed) return;
			// With the gateway down too (a restart that lasts), the next session's READY joins again. With it up,
			// it's this connection that can't get through: leave.
			if (gatewayConnection() !== null) {
				toast("Lost the connection to voice", "error");
				leaveVoice();
			} else wantFreshSession();
		};

		pc.onicecandidate = (event) => {
			if (event.candidate) {
				sendEventMessage("WEBRTC_ICE_CANDIDATE", {
					room_id: channelId,
					candidate: event.candidate.toJSON(),
				});
			}
		};

		pc.ontrack = handleTrack;

		if (localAudioStream) {
			const audioTrack = localAudioStream.getAudioTracks().at(0);
			if (audioTrack) {
				audioSender = pc.addTrack(audioTrack, localAudioStream);
				if ($isMuted || $isDeafened) {
					audioSender.replaceTrack(null).catch(console.warn);
				}
			}
			localAudioStream
				.getTracks()
				.filter((t) => t.kind !== "audio")
				.forEach((track) => {
					pc.addTrack(track, localAudioStream!);
				});
			startLocalLevelMeter();
		} else {
			// sendrecv even without a mic: SpeakInVoice granted later starts sending on it with
			// replaceTrack, with no renegotiation.
			audioSender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
		}
		// Receives the first screen shared in the room without a renegotiation.
		if (localScreenStream) {
			localScreenStream.getTracks().forEach((track) => {
				pc.addTrack(track, localScreenStream!);
			});
		} else {
			pc.addTransceiver("video", { direction: "recvonly" });
		}
		// After the recvonly one, so a screen shared before the gateway's answer goes on that one, never here.
		// A single encoding, no simulcast: the gateway would forward each layer as a track of its own.
		const camera = pc.addTransceiver("video", {
			direction: "sendonly",
			sendEncodings: [{ maxBitrate: CAMERA_MAX_BITRATE, maxFramerate: CAMERA_MAX_FRAMERATE }],
		});
		preferVP8(camera);
		cameraTransceiver = camera;
		// Joining again with the camera on: it goes on this connection's transceiver. Queued behind a camera change
		// under way, which may be turning it on.
		queueCamera(async () => {
			const track = localCameraStream?.getVideoTracks().at(0);
			if (track && cameraTransceiver === camera) await camera.sender.replaceTrack(track);
		});
		if (cameraWanted) {
			cameraWanted = false;
			queueCamera(startCamera);
		}

		const offer = await pc.createOffer();
		if (pc !== peerConnection) return;
		await pc.setLocalDescription(offer);
		if (pc !== peerConnection) return;

		// The socket can have closed meanwhile.
		const connection = gatewayConnection();
		if (connection === null) {
			wantFreshSession();
			return;
		}
		sendEventMessage("VOICE_JOIN", {
			room_id: channelId,
			offer: offer,
			tracks: trackLabels(),
			video_off: !$incomingVideo,
		});
		joinedOn = connection;
		joinAnswered = false;
		incomingVideoSent = $incomingVideo;
		sendVoiceSync(channelId);

		// Unanswered for long, the join leaves rather than wait in "new" with the mic open; with the gateway down by
		// then, the next session's READY joins again.
		const generation = webrtcGeneration;
		setTimeout(() => {
			if (generation !== webrtcGeneration || isDestroyed || negotiationReady) return;
			if (gatewayConnection() === null) {
				wantFreshSession();
				return;
			}
			toast("Couldn't connect to voice", "error");
			leaveVoice();
		}, JOIN_TIMEOUT_MS);
	}

	// Incoming video switched in the camera menu: VOICE_SYNC's video_off tells the gateway, which stops or
	// starts sending this client cameras and screens.
	let incomingVideoSent: boolean | null = null;
	$effect(() => {
		const incoming = $incomingVideo;
		if (incomingVideoSent === null || incoming === incomingVideoSent) return;
		incomingVideoSent = incoming;
		sendVoiceSync(channelId);
	});

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

	// Noise suppression switched during the call: the denoised or the raw mic takes the other's place.
	let noiseSuppressionGen = 0;
	$effect(() => {
		const on = $noiseSuppression;
		if (!rawMicStream || !peerConnection) return;
		void applyNoiseSuppression(on, ++noiseSuppressionGen);
	});

	async function applyNoiseSuppression(on: boolean, gen: number) {
		const raw = rawMicStream;
		if (!raw) return;
		let next: MediaStream = raw;
		let nextCleanup: (() => void) | null = null;
		if (on) {
			try {
				const denoised = await createDenoisedStream(raw, ensureAudioContext());
				next = denoised.stream;
				nextCleanup = denoised.cleanup;
			} catch (err) {
				console.error("[Voice] Noise suppression failed, using the raw microphone:", err);
			}
		}
		// Switched again, left, or another mic meanwhile: this one is already out of date.
		if (gen !== noiseSuppressionGen || isDestroyed || raw !== rawMicStream) {
			nextCleanup?.();
			return;
		}
		denoiseCleanup?.();
		denoiseCleanup = nextCleanup;
		// The meter follows localAudioStream ($effect above), so the speaking ring and the face keep working.
		localAudioStream = next;

		// Force track replacement on the sender (Edge/Chromium needs this)
		if (audioSender) {
			const shouldSend = !$isMuted && !$isDeafened;
			const track = shouldSend ? (next.getAudioTracks().at(0) ?? null) : null;
			await audioSender.replaceTrack(track).catch(console.warn);
		}
	}

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
		if ($noiseSuppression) {
			try {
				const denoised = await createDenoisedStream(newRawStream, ensureAudioContext());
				localAudioStream = denoised.stream;
				denoiseCleanup = denoised.cleanup;
			} catch {
				localAudioStream = newRawStream;
			}
		} else {
			localAudioStream = newRawStream;
		}

		const newTrack = localAudioStream.getAudioTracks().at(0);
		if (newTrack && audioSender) {
			const shouldSend = !$isMuted && !$isDeafened;
			await audioSender.replaceTrack(shouldSend ? newTrack : null);
		}
	}

	async function toggleScreenShare(withAudio = false) {
		if ($isScreenSharing) {
			// Remove the video and screen audio senders from the existing connection
			const screenTracks = localScreenStream?.getTracks() ?? [];
			for (const sender of peerConnection?.getSenders() ?? []) {
				if (sender.track && screenTracks.includes(sender.track)) {
					peerConnection?.removeTrack(sender);
				}
			}
			stopTracks(localScreenStream);
			localScreenStream = null;
			isScreenSharing.set(false);
			audioStore.play("screen_sharing_off");
			sendVoiceSync(channelId);
		} else {
			if (!canVideo) {
				videoOffNotice("You can't use video in this room");
				return;
			}
			try {
				let screen: MediaStream;
				try {
					screen = await navigator.mediaDevices.getDisplayMedia({
						video: true,
						audio: withAudio,
					});
				} catch (displayErr: any) {
					if (withAudio && displayErr?.name === "NotReadableError") {
						// Audio capture failed (window selected instead of tab) — retry without audio
						screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
						toast("Audio only works when sharing a browser tab, not a window.", "info");
					} else {
						throw displayErr;
					}
				}
				// Left (or lost Video) while the screen picker was open: this capture belongs to no call.
				if (isDestroyed || !canVideo || localScreenStream) {
					stopTracks(screen);
					if (!isDestroyed && !canVideo) videoOffNotice("You can't use video in this room");
					return;
				}
				localScreenStream = screen;
				isScreenSharing.set(true);
				audioStore.play("screen_sharing_on");
				sendVoiceSync(channelId);

				const videoTrack = screen.getVideoTracks().at(0);
				if (!videoTrack) return;

				videoTrack.onended = () => {
					if ($isScreenSharing) toggleScreenShare();
				};

				peerConnection?.addTrack(videoTrack, screen);

				// Add screen share audio track if present
				const screenAudioTrack = screen.getAudioTracks().at(0);
				if (screenAudioTrack) {
					peerConnection?.addTrack(screenAudioTrack, screen);
				} else if (withAudio) {
					toast("Audio not captured. Share a browser tab (not a window or screen) to include audio.", "info");
				}
			} catch (err) {
				console.error("Screen share failed", err);
			}
		}
	}

	/** Runs camera changes one at a time, in the order asked: an off that comes while the camera opens (a
	 * refusal, Video lost) still wins, and two switches never race. */
	function queueCamera(change: () => Promise<void>) {
		cameraChain = cameraChain.then(change).catch((err) => console.error("[Voice] Camera change failed:", err));
	}

	// Only this room's or call's requests: one for another, left where no VoiceChat took it, must not turn the
	// camera on here.
	$effect(() => {
		const request = $cameraRequested;
		if (!request) return;
		cameraRequested.set(null);
		if (request.roomId === channelId) queueCamera(request.on ? startCamera : stopCamera);
	});

	// Another camera picked in the menu while this one is on: it takes its place on the same transceiver.
	let cameraDeviceAsked = $selectedCameraId;
	$effect(() => {
		const deviceId = $selectedCameraId;
		if (deviceId === cameraDeviceAsked) return;
		cameraDeviceAsked = deviceId;
		queueCamera(() => switchCamera(deviceId));
	});

	// Video lost in the room mid-call: the camera and the screen go off, as the gateway turns them off.
	$effect(() => {
		if (canVideo) return;
		untrack(() => {
			if (!localCameraStream && !$isScreenSharing) return;
			queueCamera(stopCamera);
			if ($isScreenSharing) void toggleScreenShare();
			videoOffNotice("You can't use video in this room");
		});
	});

	/** The gateway turned the camera or the screen off, or never let it on (VOICE_VIDEO_REFUSED): the room
	 * has its most cameras on, this user has no Video permission there, or the camera sent more than the
	 * gateway allows. One that's already off was seen first here, as a permission's loss can be. */
	function onVideoRefused(event: VoiceVideoRefusedEvent) {
		if (event.kind === "screen") {
			if (!$isScreenSharing) return;
			void toggleScreenShare();
		} else {
			if (!localCameraStream) return;
			queueCamera(stopCamera);
		}
		videoOffNotice(videoRefusedMessage(event, isCall ? "call" : "room"));
	}

	// A permission's loss turns the camera and the screen off at once, each with its own refusal: one notice.
	let lastVideoNotice = { message: "", at: 0 };
	function videoOffNotice(message: string) {
		const now = Date.now();
		if (message === lastVideoNotice.message && now - lastVideoNotice.at < 3000) return;
		lastVideoNotice = { message, at: now };
		toast(message, "error");
	}

	/** Opens the camera picked in the menu, or the default one when that one is gone. */
	async function openCamera(deviceId: string): Promise<MediaStream> {
		try {
			return await navigator.mediaDevices.getUserMedia(cameraConstraints(deviceId));
		} catch (err) {
			const name = typeof err === "object" && err !== null && "name" in err ? err.name : undefined;
			if (!deviceId || (name !== "OverconstrainedError" && name !== "NotFoundError")) throw err;
			return navigator.mediaDevices.getUserMedia(cameraConstraints(""));
		}
	}

	function prepareCameraTrack(track: MediaStreamTrack, stream: MediaStream) {
		// Keeps the frame rate up over the sharpness when the bandwidth drops.
		track.contentHint = "motion";
		// Unplugged, or taken away by the system. stop() fires no ended.
		track.onended = () => {
			if (localCameraStream !== stream) return;
			queueCamera(stopCamera);
			toast("Your camera was disconnected", "error");
		};
	}

	// Asked for before the connection had its camera transceiver: the controls work as soon as this is mounted,
	// while the mic is still being opened. connectWebRTC turns it on once it has one.
	let cameraWanted = false;

	/** Puts the camera on its transceiver; VOICE_SYNC's camera then tells the gateway to forward it. */
	async function startCamera() {
		if (isDestroyed || localCameraStream) return;
		if (!cameraTransceiver) {
			cameraWanted = true;
			return;
		}
		if (!canVideo) {
			videoOffNotice("You can't use video in this room");
			return;
		}
		let stream: MediaStream;
		try {
			stream = await openCamera($selectedCameraId);
		} catch (err) {
			console.error("[Voice] Couldn't open the camera:", err);
			toast(cameraErrorMessage(err), "error");
			return;
		}
		const track = stream.getVideoTracks().at(0);
		// The connection's transceiver of now: joining again while the camera opened made a new one.
		const transceiver = cameraTransceiver;
		// Left, or lost Video, while the camera was opening.
		if (isDestroyed || !transceiver || !track || !canVideo) {
			stopTracks(stream);
			if (!isDestroyed && !canVideo) videoOffNotice("You can't use video in this room");
			return;
		}
		prepareCameraTrack(track, stream);
		try {
			await transceiver.sender.replaceTrack(track);
		} catch (err) {
			stopTracks(stream);
			throw err;
		}
		// Unplugged meanwhile: its ended came before it was the camera, so nothing turned it off.
		if (isDestroyed || track.readyState === "ended") {
			if (!isDestroyed) {
				await transceiver.sender.replaceTrack(null).catch(console.warn);
				toast("Your camera was disconnected", "error");
			}
			stopTracks(stream);
			return;
		}
		localCameraStream = stream;
		isCameraOn.set(true);
		sendVoiceSync(channelId);
	}

	async function stopCamera() {
		cameraWanted = false;
		const stream = localCameraStream;
		if (!stream) return;
		localCameraStream = null;
		isCameraOn.set(false);
		try {
			await cameraTransceiver?.sender.replaceTrack(null);
		} finally {
			// Stopping the track is what turns the camera's light off.
			stopTracks(stream);
			if (!isDestroyed) sendVoiceSync(channelId);
		}
	}

	async function switchCamera(deviceId: string) {
		const current = localCameraStream;
		if (isDestroyed || !cameraTransceiver || !current) return;
		let stream: MediaStream;
		try {
			stream = await openCamera(deviceId);
		} catch (err) {
			console.error("[Voice] Couldn't switch cameras:", err);
			toast(cameraErrorMessage(err), "error");
			return;
		}
		const track = stream.getVideoTracks().at(0);
		// The connection's transceiver of now, as in startCamera.
		const transceiver = cameraTransceiver;
		if (isDestroyed || localCameraStream !== current || !track || !transceiver) {
			stopTracks(stream);
			return;
		}
		prepareCameraTrack(track, stream);
		try {
			await transceiver.sender.replaceTrack(track);
		} catch (err) {
			stopTracks(stream);
			throw err;
		}
		if (isDestroyed || localCameraStream !== current) {
			stopTracks(stream);
			return;
		}
		localCameraStream = stream;
		stopTracks(current);
	}

	function srcObject(node: HTMLMediaElement, stream: MediaStream) {
		node.srcObject = stream;
		return {
			update(newStream: MediaStream) {
				if (node.srcObject !== newStream) {
					node.srcObject = newStream;
				}
			},
		};
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
</script>

<!-- Everyone's voice, and the sound of the screens they share: that stream also carries the screen, whose
     <video> in VoiceChannelView is muted so the voice doesn't play twice. Only deafening silences it: someone
     muted sends no voice, but a tab they share keeps its sound. -->
{#each Object.entries(remoteAudioStreams) as [id, stream] (id)}
	<audio use:srcObject={stream} use:applyMuted={$isDeafened} autoplay aria-label={`Audio stream ${id}`}></audio>
{/each}
