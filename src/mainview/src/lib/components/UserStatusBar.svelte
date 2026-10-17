<script lang="ts">
	import {
		Mic as MicrophoneIcon,
		MicOff as MicrophoneSlashIcon,
		Headphones as HeadphonesIcon,
		SignalHigh as CellSignalFullIcon,
		SignalMedium as CellSignalMediumIcon,
		SignalLow as CellSignalLowIcon,
		PhoneOff as PhoneDisconnectIcon,
		Settings as GearSixIcon,
		AudioLines,
	} from "@lucide/svelte";
	import { ContextMenu } from "bits-ui";
	import {
		speakingUsers,
		currentUser,
		isMuted,
		isDeafened,
		activeVoiceRoomId,
		selectedMicId,
		gatewaySpaces,
		voiceConnectionState,
		activeCall,
		callVoiceStates,
		conversations,
		noiseSuppression,
		isScreenSharing,
	} from "$lib/stores.svelte";
	import { get } from "svelte/store";
	import { sendEventMessage } from "$lib/api/ws/connection";
	import { fly } from "svelte/transition";
	import { getHostURL, getAvatarURL } from "$lib/common/common";
	import { hasPermission, Permission } from "$lib/permissions";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import UserSettings from "$lib/components/UserSettings.svelte";
	import VoiceNoteBar from "$lib/components/VoiceNoteBar.svelte";

	let {
		collapsed = false,
	}: {
		collapsed?: boolean;
	} = $props();

	const activeVoiceSpace = $derived(
		$activeVoiceRoomId ? $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === $activeVoiceRoomId)) : null,
	);
	const activeVoiceRoom = $derived(activeVoiceSpace?.rooms.find((r) => r.id === $activeVoiceRoomId));
	const isInConversationCall = $derived(
		$activeCall?.state === "connected" && $activeVoiceRoomId === $activeCall?.conversationId,
	);
	const callConversationName = $derived.by(() => {
		if (!isInConversationCall || !$activeCall) return "";
		const conv = $conversations.find((c) => c.id === $activeCall!.conversationId);
		if (!conv) return "Call";
		const me = $currentUser;
		if (conv.type === 2) return conv.name ?? "Group call";
		const other = conv.members.find((m) => m.user_id !== me?.id);
		return other?.user?.alias ?? other?.user?.username ?? "Call";
	});

	const canSpeak = $derived(
		activeVoiceSpace && activeVoiceRoom
			? hasPermission(activeVoiceSpace, activeVoiceRoom, Permission.SpeakInVoice)
			: true,
	);

	$effect(() => {
		if (!canSpeak && !get(isMuted)) {
			// Tell the gateway too: when SpeakInVoice comes back it keeps showing this client muted,
			// which it stays until the user unmutes.
			isMuted.set(true);
			if ($activeVoiceRoomId) {
				sendEventMessage("VOICE_SYNC", {
					room_id: $activeVoiceRoomId,
					muted: true,
					deafened: $isDeafened,
					screen_sharing: $isScreenSharing,
				});
			}
		}
	});

	let showUserSettings = $state(false);
	let micContextOpen = $state(false);
	let availableMics = $state<MediaDeviceInfo[]>([]);
	let ping = $state<number | null>(null);
	let pingIntervalId = $state<ReturnType<typeof setInterval> | null>(null);

	const connectionLabel: Record<RTCPeerConnectionState, string> = {
		new: "Connecting...",
		connecting: "Connecting...",
		connected: "Voice Connected",
		disconnected: "Reconnecting...",
		failed: "Connection Failed",
		closed: "Disconnected",
	};

	$effect(() => {
		if ($activeVoiceRoomId) {
			if (!pingIntervalId) {
				measurePing();
				pingIntervalId = setInterval(measurePing, 3000);
			}
		} else {
			if (pingIntervalId) {
				clearInterval(pingIntervalId);
				pingIntervalId = null;
				ping = null;
			}
		}
	});

	$effect(() => {
		if (micContextOpen) void loadAvailableMics();
	});

	async function measurePing() {
		try {
			const start = performance.now();
			await fetch(`${getHostURL()}/health`, { method: "GET", cache: "no-store" });
			ping = Math.round(performance.now() - start);
		} catch {
			ping = null;
		}
	}

	async function loadAvailableMics() {
		try {
			let devices = await navigator.mediaDevices.enumerateDevices();
			let mics = devices.filter((d) => d.kind === "audioinput");

			// If labels are empty, request mic permission first to unlock device labels
			if (mics.length > 0 && !mics[0].label) {
				const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
				stream.getTracks().forEach((t) => t.stop());
				devices = await navigator.mediaDevices.enumerateDevices();
				mics = devices.filter((d) => d.kind === "audioinput");
			}

			availableMics = mics;
		} catch (err) {
			console.error("Failed to fetch media devices:", err);
		}
	}

	function selectMic(deviceId: string) {
		$selectedMicId = deviceId;
		micContextOpen = false;
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

	function pingIconColor(ms: number | null): string {
		if (ms === null || ms < 100) return "text-stone-500";
		if (ms < 250) return "text-orange-400";
		return "text-red-400";
	}

	function pingBgColor(ms: number | null): string {
		if (ms === null || ms < 100) return "bg-stone-900";
		if (ms < 250) return "bg-orange-950";
		return "bg-red-950";
	}
</script>

{#if !collapsed}
	<VoiceNoteBar />
{/if}

<!-- Voice status pill -->
{#if !collapsed && $activeVoiceRoomId && (activeVoiceRoom || isInConversationCall)}
	<div
		class="shrink-0 border-t border-zinc-800"
		in:fly={{ y: 20, duration: 200, opacity: 1 }}
		out:fly={{ y: 20, duration: 200, opacity: 1 }}
	>
		<div class="flex items-center gap-2 px-2 py-1.5 select-none">
			<div
				class="relative flex shrink-0 items-center justify-center rounded-full p-1.5 {isInConversationCall
					? 'bg-emerald-500/10'
					: pingBgColor(ping)}"
				title={isInConversationCall ? "In call" : ping !== null ? `Ping: ${ping}ms` : "Measuring ping..."}
			>
				{#if isInConversationCall}
					<PhoneDisconnectIcon class="size-3.5 text-emerald-400" />
				{:else if ping !== null && ping >= 250}
					<CellSignalLowIcon class="size-3.5 {pingIconColor(ping)}" />
				{:else if ping !== null && ping >= 100}
					<CellSignalMediumIcon class="size-3.5 {pingIconColor(ping)}" />
				{:else}
					<CellSignalFullIcon class="size-3.5 {pingIconColor(ping)}" />
				{/if}
			</div>
			<div class="flex min-w-0 flex-1 flex-col truncate">
				<span class="truncate text-xs font-semibold {isInConversationCall ? 'text-emerald-300' : 'text-stone-300'}">
					{isInConversationCall ? "In Call" : connectionLabel[$voiceConnectionState]}
				</span>
				<span class="text-xxs truncate text-zinc-400">
					{isInConversationCall
						? callConversationName
						: `${activeVoiceSpace?.name || ""} / ${activeVoiceRoom?.name || ""}`}
				</span>
			</div>
			<button
				class="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
				aria-label="Disconnect"
				onclick={() => {
					if (isInConversationCall && $activeCall) {
						sendEventMessage("CALL_LEAVE", { conversation_id: $activeCall.conversationId });
						activeCall.set(null);
						callVoiceStates.set([]);
					}
					$activeVoiceRoomId = null;
				}}
			>
				<PhoneDisconnectIcon class="size-3.5" />
			</button>
		</div>
	</div>
{/if}

{#if collapsed && $currentUser}
	<div class="flex shrink-0 flex-col items-center gap-1 border-t border-zinc-800 bg-zinc-900 px-1 py-2">
		{#if $activeVoiceRoomId}
			<div
				class="size-8 rounded-lg {isInConversationCall
					? 'bg-emerald-600/20'
					: pingBgColor(ping)} mb-0.5 flex items-center justify-center"
				title={isInConversationCall ? "In call" : ping !== null ? `Ping: ${ping}ms` : "Measuring ping..."}
			>
				{#if isInConversationCall}
					<PhoneDisconnectIcon class="size-4 text-emerald-400" />
				{:else if ping !== null && ping >= 250}
					<CellSignalLowIcon class="size-4 {pingIconColor(ping)}" />
				{:else if ping !== null && ping >= 100}
					<CellSignalMediumIcon class="size-4 {pingIconColor(ping)}" />
				{:else}
					<CellSignalFullIcon class="size-4 {pingIconColor(ping)}" />
				{/if}
			</div>
			<button
				class="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-red-400"
				aria-label="Disconnect"
				onclick={() => {
					if (isInConversationCall && $activeCall) {
						sendEventMessage("CALL_LEAVE", { conversation_id: $activeCall.conversationId });
						activeCall.set(null);
						callVoiceStates.set([]);
					}
					$activeVoiceRoomId = null;
				}}
			>
				<PhoneDisconnectIcon class="size-4" />
			</button>
			<div class="my-0.5 w-6 border-t border-zinc-700"></div>
		{/if}
		<div class="relative">
			<UserAvatar
				src={getAvatarURL($currentUser.id, $currentUser.avatar)}
				name={$currentUser.alias || $currentUser.username}
				size={28}
				class="box-border transition-all duration-200 {$speakingUsers.has($currentUser.id)
					? 'ring-[3px] ring-stone-500'
					: ''}"
			/>
		</div>
		<button
			class="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800 {$isMuted
				? 'text-red-400'
				: 'text-zinc-400'}"
			aria-label="Toggle Mute"
			onclick={() => canSpeak && toggleMute()}
		>
			{#if $isMuted}
				<MicrophoneSlashIcon class="size-4" />
			{:else}
				<MicrophoneIcon class="size-4" />
			{/if}
		</button>
		<button
			class="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800 {$isDeafened
				? 'text-red-400'
				: 'text-zinc-400'}"
			aria-label="Deafen"
			onclick={toggleDeafen}
		>
			<HeadphonesIcon class="size-4" />
		</button>
		<button
			class="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
			class:text-emerald-400={$noiseSuppression}
			class:text-zinc-400={!$noiseSuppression}
			aria-label="Toggle Noise Suppression"
			title={$noiseSuppression ? "Noise suppression on" : "Noise suppression off"}
			onclick={() => noiseSuppression.update((v) => !v)}
		>
			<AudioLines class="size-4" />
		</button>
		<button
			class="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800"
			aria-label="User Settings"
			onclick={() => (showUserSettings = true)}
		>
			<GearSixIcon class="size-4" />
		</button>
	</div>
{/if}

<!-- Current user profile bar -->
{#if !collapsed && $currentUser}
	<div class="z-100 flex h-16 shrink-0 items-center gap-1 border-t border-zinc-800 bg-zinc-900 px-2">
		<div
			class="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-full p-1 transition-colors hover:bg-zinc-800"
		>
			<div class="relative shrink-0">
				<UserAvatar
					src={getAvatarURL($currentUser.id, $currentUser.avatar)}
					name={$currentUser.alias || $currentUser.username}
					size={28}
					class="box-border transition-all duration-200 {$speakingUsers.has($currentUser.id)
						? 'ring-4 ring-stone-500'
						: ''}"
				/>
			</div>
			<div class="flex flex-col truncate">
				<span class="truncate text-sm font-semibold text-zinc-200">{$currentUser.alias || $currentUser.username}</span>
			</div>
		</div>

		<div class="relative flex shrink-0 items-center text-zinc-400">
			<ContextMenu.Root bind:open={micContextOpen}>
				<ContextMenu.Trigger>
					<button
						class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
						class:text-red-400={$isMuted}
						class:hover:bg-zinc-700={canSpeak}
						class:opacity-50={!canSpeak}
						class:cursor-not-allowed={!canSpeak}
						aria-label="Toggle Mute"
						onclick={() => canSpeak && toggleMute()}
					>
						{#if $isMuted}
							<MicrophoneSlashIcon class="size-5" />
						{:else}
							<MicrophoneIcon class="size-5" />
						{/if}
					</button>
				</ContextMenu.Trigger>
				<ContextMenu.Portal>
					<ContextMenu.Content class="z-200 min-w-56 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl">
						<div
							class="mb-1 border-b border-zinc-700 px-3 py-1.5 text-xs font-semibold tracking-wider text-zinc-400 uppercase"
						>
							Input Device
						</div>
						{#if availableMics.length === 0}
							<div class="px-3 py-2 text-sm text-zinc-400">No microphones found</div>
						{:else}
							{#each availableMics as mic, micIndex}
								<ContextMenu.Item
									class="w-full px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
									onSelect={() => selectMic(mic.deviceId)}
								>
									<div class="flex items-center justify-between gap-2">
										<span class="truncate pr-2">{mic.label || `Microphone ${micIndex + 1}`}</span>
										{#if $selectedMicId === mic.deviceId || ($selectedMicId === "" && mic.deviceId === "default")}
											<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400"></span>
										{/if}
									</div>
								</ContextMenu.Item>
							{/each}
						{/if}
					</ContextMenu.Content>
				</ContextMenu.Portal>
			</ContextMenu.Root>
			<button
				class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
				class:text-red-400={$isDeafened}
				aria-label="Deafen"
				onclick={toggleDeafen}
			>
				<HeadphonesIcon class="size-5" />
			</button>
			<button
				class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
				class:text-emerald-400={$noiseSuppression}
				class:text-zinc-400={!$noiseSuppression}
				aria-label="Toggle Noise Suppression"
				title={$noiseSuppression ? "Noise suppression on" : "Noise suppression off"}
				onclick={() => noiseSuppression.update((v) => !v)}
			>
				<AudioLines class="size-5" />
			</button>
			<button
				class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
				aria-label="User Settings"
				onclick={() => (showUserSettings = true)}
			>
				<GearSixIcon class="size-5" />
			</button>
		</div>
	</div>
{/if}

<UserSettings bind:open={showUserSettings} />
