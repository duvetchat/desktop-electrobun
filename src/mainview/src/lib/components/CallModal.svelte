<script lang="ts">
	import { activeCall, activeVoiceRoomId, currentUser } from "$lib/stores.svelte";
	import { isMuted } from "$lib/stores.svelte";
	import { acceptCall, cancelCall, sendEventMessage } from "$lib/api/ws/connection";
	import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, X } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { audioStore } from "$lib/stores/audio.svelte";
	import { callRings } from "$lib/status";
	import { onDestroy } from "svelte";

	const call = $derived($activeCall);
	let ringAudio: HTMLAudioElement | null = null;

	// In do not disturb a call coming in shows without its ring.
	$effect(() => {
		if (call && callRings(call.state, $currentUser?.status)) {
			if (!ringAudio) {
				ringAudio = audioStore.playLoop("voice_calling");
			}
		} else {
			ringAudio?.pause();
			if (ringAudio) ringAudio.currentTime = 0;
			ringAudio = null;
		}
	});

	onDestroy(() => {
		ringAudio?.pause();
	});

	function accept() {
		if (!call) return;
		const convId = call.conversationId;
		acceptCall(convId);
		activeCall.update((c) => (c ? { ...c, state: "connected" } : null));
		// Delay slightly so gateway processes CALL_ACCEPT before VoiceChat sends VOICE_JOIN
		setTimeout(() => activeVoiceRoomId.set(convId), 50);
	}

	function decline() {
		if (!call) return;
		sendEventMessage("CALL_DECLINE", { conversation_id: call.conversationId });
		activeCall.set(null);
	}

	// The calling screen goes, and the user's own call no longer shows as ringing the others; the gateway decides the
	// rest. When it ends the call, CALL_ENDED takes it away. When the user called back into a call going on after
	// hanging up, it takes just their voice out (decision 64): the call goes on, and its conversation shows it with
	// Join, as after hanging up.
	function cancel() {
		if (!call) return;
		cancelCall(call.conversationId);
		activeCall.set(null);
	}

	function toggleMute() {
		isMuted.update((m) => !m);
	}
</script>

{#if call && (call.state === "ringing" || call.state === "calling")}
	<!-- Ringing / Calling overlay -->
	<div class="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-sm">
		<div
			class="flex w-80 flex-col items-center gap-6 rounded-2xl border border-stone-700 bg-stone-900/95 p-8 shadow-2xl backdrop-blur-md"
		>
			<!-- Pulsing avatar -->
			<div class="relative">
				<span class="animate-call-pulse absolute -inset-3 rounded-full border border-emerald-400/30"></span>
				<span
					class="animate-call-pulse absolute -inset-5 rounded-full border border-emerald-400/20 [animation-delay:0.4s]"
				></span>
				<UserAvatar src={getAvatarURL(call.initiatorId, call.initiatorAvatar)} name={call.initiatorName} size={80} />
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
						class="text-fixed-white flex size-14 items-center justify-center rounded-full bg-emerald-600 shadow-lg transition-all hover:bg-emerald-500 hover:shadow-emerald-500/25 active:scale-95"
						onclick={accept}
						aria-label="Accept call"
					>
						<Phone class="size-6" />
					</button>
					<button
						class="text-fixed-white flex size-14 items-center justify-center rounded-full bg-red-600 shadow-lg transition-all hover:bg-red-500 hover:shadow-red-500/25 active:scale-95"
						onclick={decline}
						aria-label="Decline call"
					>
						<PhoneOff class="size-6" />
					</button>
				{:else}
					<!-- Calling state: cancel button -->
					<button
						class="text-fixed-white flex size-14 items-center justify-center rounded-full bg-red-600 shadow-lg transition-all hover:bg-red-500 hover:shadow-red-500/25 active:scale-95"
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
