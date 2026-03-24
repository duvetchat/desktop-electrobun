<script lang="ts">
	import { activeCall, activeVoiceRoomId, callVoiceStates } from "$lib/stores.svelte";
	import { isMuted } from "$lib/stores.svelte";
	import { sendEventMessage } from "$lib/api/ws/connection";
	import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, X } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { onDestroy } from "svelte";

	const call = $derived($activeCall);
	let ringAudio: HTMLAudioElement | null = null;

	// Play ringing sound
	$effect(() => {
		if (call && (call.state === "ringing" || call.state === "calling")) {
			if (!ringAudio) {
				ringAudio = new Audio("/sounds/voice_calling.ogg");
				ringAudio.loop = true;
			}
			ringAudio.currentTime = 0;
			ringAudio.play().catch(() => {});
		} else {
			ringAudio?.pause();
			if (ringAudio) ringAudio.currentTime = 0;
		}
	});

	onDestroy(() => {
		ringAudio?.pause();
	});

	function accept() {
		if (!call) return;
		sendEventMessage("CALL_ACCEPT", { conversation_id: call.conversationId });
		activeCall.update(c => c ? { ...c, state: "connected" } : null);
		// Use the conversation_id as voice room so VoiceChat mounts
		activeVoiceRoomId.set(call.conversationId);
	}

	function decline() {
		if (!call) return;
		sendEventMessage("CALL_DECLINE", { conversation_id: call.conversationId });
		activeCall.set(null);
	}

	function cancel() {
		if (!call) return;
		sendEventMessage("CALL_CANCEL", { conversation_id: call.conversationId });
		activeCall.set(null);
	}

	function hangUp() {
		if (!call) return;
		sendEventMessage("CALL_LEAVE", { conversation_id: call.conversationId });
		activeVoiceRoomId.set(null);
		activeCall.set(null);
		callVoiceStates.set([]);
	}

	function toggleMute() {
		isMuted.update(m => !m);
	}
</script>

{#if call && (call.state === "ringing" || call.state === "calling")}
	<!-- Ringing / Calling overlay -->
	<div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
		<div class="flex w-80 flex-col items-center gap-6 rounded-2xl border border-stone-700 bg-stone-900/95 p-8 shadow-2xl backdrop-blur-md">
			<!-- Pulsing avatar -->
			<div class="relative">
				<span class="absolute -inset-3 rounded-full border border-emerald-400/30 animate-call-pulse"></span>
				<span class="absolute -inset-5 rounded-full border border-emerald-400/20 animate-call-pulse [animation-delay:0.4s]"></span>
				<UserAvatar
					src={call.initiatorAvatar}
					name={call.initiatorName}
					size={80}
				/>
			</div>

			<!-- Name and status -->
			<div class="flex flex-col items-center gap-1">
				<span class="text-lg font-semibold text-stone-100">{call.initiatorName}</span>
				{#if call.state === "ringing"}
					<span class="flex items-center gap-1.5 text-sm text-emerald-400">
						<PhoneIncoming class="size-3.5" />
						Incoming call...
					</span>
				{:else}
					<span class="text-sm text-zinc-400">Calling...</span>
				{/if}
			</div>

			<!-- Action buttons -->
			<div class="flex items-center gap-4">
				{#if call.state === "ringing"}
					<button
						class="flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition-all hover:bg-emerald-500 hover:shadow-emerald-500/25 active:scale-95"
						onclick={accept}
						aria-label="Accept call"
					>
						<Phone class="size-6" />
					</button>
					<button
						class="flex size-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-all hover:bg-red-500 hover:shadow-red-500/25 active:scale-95"
						onclick={decline}
						aria-label="Decline call"
					>
						<PhoneOff class="size-6" />
					</button>
				{:else}
					<!-- Calling state: cancel button -->
					<button
						class="flex size-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-all hover:bg-red-500 hover:shadow-red-500/25 active:scale-95"
						onclick={cancel}
						aria-label="Cancel call"
					>
						<PhoneOff class="size-6" />
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
