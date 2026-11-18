<script lang="ts">
	import {
		Mic as MicrophoneIcon,
		MicOff as MicrophoneSlashIcon,
		Headphones as HeadphonesIcon,
		AudioLines,
	} from "@lucide/svelte";
	import { ContextMenu } from "bits-ui";
	import {
		isMuted,
		isDeafened,
		activeVoiceRoomId,
		selectedMicId,
		gatewaySpaces,
		noiseSuppression,
	} from "$lib/stores.svelte";
	import { get } from "svelte/store";
	import { sendVoiceSync, toggleDeafen, toggleMute as toggleMic } from "$lib/voice";
	import { hasPermission, Permission } from "$lib/permissions";

	// The media controls of the user's panel (ProfileRow): the microphone, with its Input Device menu on a right-click,
	// deafen and noise suppression. They are there in and out of voice. In the folded column they stack, smaller, and
	// the mic has no menu. With UserStatusBar's profile row and voice status, they were one component until the
	// redesign (#357).
	let { collapsed = false }: { collapsed?: boolean } = $props();

	const activeVoiceSpace = $derived(
		$activeVoiceRoomId ? $gatewaySpaces.find((s) => s.rooms.some((r) => r.id === $activeVoiceRoomId)) : null,
	);
	const activeVoiceRoom = $derived(activeVoiceSpace?.rooms.find((r) => r.id === $activeVoiceRoomId));

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
			sendVoiceSync();
		}
	});

	let micContextOpen = $state(false);
	let availableMics = $state<MediaDeviceInfo[]>([]);

	$effect(() => {
		if (micContextOpen) void loadAvailableMics();
	});

	async function loadAvailableMics() {
		try {
			let devices = await navigator.mediaDevices.enumerateDevices();
			let mics = devices.filter((d) => d.kind === "audioinput");

			// If labels are empty, request mic permission first to unlock device labels
			if (mics.length > 0 && !mics[0]?.label) {
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
		toggleMic();
	}
</script>

{#if collapsed}
	<button
		class="hover:bg-duvet-card flex size-8 items-center justify-center rounded-lg transition-colors {$isMuted
			? 'text-duvet-danger'
			: 'text-duvet-ink2'}"
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
		class="hover:bg-duvet-card flex size-8 items-center justify-center rounded-lg transition-colors {$isDeafened
			? 'text-duvet-danger'
			: 'text-duvet-ink2'}"
		aria-label="Deafen"
		onclick={toggleDeafen}
	>
		<HeadphonesIcon class="size-4" />
	</button>
	<button
		class="hover:bg-duvet-card flex size-8 items-center justify-center rounded-lg transition-colors"
		class:text-duvet-alive={$noiseSuppression}
		class:text-duvet-ink2={!$noiseSuppression}
		aria-label="Toggle Noise Suppression"
		title={$noiseSuppression ? "Noise suppression on" : "Noise suppression off"}
		onclick={() => noiseSuppression.update((v) => !v)}
	>
		<AudioLines class="size-4" />
	</button>
{:else}
	<ContextMenu.Root bind:open={micContextOpen}>
		<ContextMenu.Trigger>
			<button
				class="hover:bg-duvet-card flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
				class:text-duvet-danger={$isMuted}
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
			<ContextMenu.Content
				class="rounded-card border-duvet-line bg-duvet-card shadow-duvet-float z-200 min-w-56 border py-1"
			>
				<div class="border-duvet-line text-duvet-ink2 mb-1 border-b px-3 py-1.5 text-[13px] font-bold">
					Input Device
				</div>
				{#if availableMics.length === 0}
					<div class="text-duvet-ink2 px-3 py-2 text-sm">No microphones found</div>
				{:else}
					{#each availableMics as mic, micIndex}
						<ContextMenu.Item
							class="text-duvet-ink hover:bg-duvet-ink/10 w-full px-3 py-2 text-left text-sm transition-colors"
							onSelect={() => selectMic(mic.deviceId)}
						>
							<div class="flex items-center justify-between gap-2">
								<span class="truncate pr-2">{mic.label || `Microphone ${micIndex + 1}`}</span>
								{#if $selectedMicId === mic.deviceId || ($selectedMicId === "" && mic.deviceId === "default")}
									<span class="bg-duvet-ink2 h-1.5 w-1.5 shrink-0 rounded-full"></span>
								{/if}
							</div>
						</ContextMenu.Item>
					{/each}
				{/if}
			</ContextMenu.Content>
		</ContextMenu.Portal>
	</ContextMenu.Root>
	<button
		class="hover:bg-duvet-card flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
		class:text-duvet-danger={$isDeafened}
		aria-label="Deafen"
		onclick={toggleDeafen}
	>
		<HeadphonesIcon class="size-5" />
	</button>
	<button
		class="hover:bg-duvet-card flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
		class:text-duvet-alive={$noiseSuppression}
		class:text-duvet-ink2={!$noiseSuppression}
		aria-label="Toggle Noise Suppression"
		title={$noiseSuppression ? "Noise suppression on" : "Noise suppression off"}
		onclick={() => noiseSuppression.update((v) => !v)}
	>
		<AudioLines class="size-5" />
	</button>
{/if}
