<script lang="ts">
	import { activeCall, activeVoiceRoomId, conversations, currentUser } from "$lib/stores.svelte";
	import { acceptCall, cancelCall, sendEventMessage } from "$lib/api/ws/connection";
	import { Phone, PhoneIncoming, PhoneOff, PhoneOutgoing } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { audioStore } from "$lib/stores/audio.svelte";
	import { callRings } from "$lib/status";
	import { callCardFace } from "$lib/calls";
	import {
		CALL_CARD_HEIGHT,
		CALL_CARD_WIDTH,
		CORNER_MARGIN,
		callCardBottom,
		callCardBox,
		streamWindowBox,
	} from "$lib/corner";
	import { onDestroy } from "svelte";

	// A call ringing here, or one the user places, as a card in the app's bottom right corner: it covers nothing else and
	// takes no focus, so the user goes on with what they were doing. A click on its name opens the call's conversation.
	let { onOpen }: { onOpen: (conversationId: string) => void } = $props();

	const call = $derived($activeCall);
	const ringing = $derived(call?.state === "ringing");
	const shown = $derived(call?.state === "ringing" || call?.state === "calling");
	const face = $derived(
		call
			? callCardFace(
					call,
					$conversations.find((c) => c.id === call.conversationId),
					$currentUser?.id,
				)
			: null,
	);

	// Right above the stream window when that window covers the card's place (lib/corner.ts), and the toasts right above
	// the card while it shows.
	let viewHeight = $state(globalThis.innerHeight ?? 0);
	const bottom = $derived(callCardBottom($streamWindowBox, viewHeight));
	$effect(() => {
		callCardBox.set(shown ? { right: CORNER_MARGIN, bottom, width: CALL_CARD_WIDTH, height: CALL_CARD_HEIGHT } : null);
	});

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
		callCardBox.set(null);
	});

	function open() {
		if (call) onOpen(call.conversationId);
	}

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

	// The calling card goes, and the user's own call no longer shows as ringing the others; the gateway decides the
	// rest. When it ends the call, CALL_ENDED takes it away. When the user called back into a call going on after
	// hanging up, it takes just their voice out (decision 64): the call goes on, and its conversation shows it with
	// Join, as after hanging up.
	function cancel() {
		if (!call) return;
		cancelCall(call.conversationId);
		activeCall.set(null);
	}
</script>

<svelte:window bind:innerHeight={viewHeight} />

{#if call && face && shown}
	<!-- Above every dialog's layer, so none covers a ringing call (CallCard.test.ts checks them all), and taking clicks
	     while a modal dialog turns them off on the body, as a toast does. -->
	<section
		aria-label={ringing ? "Incoming call" : "Calling"}
		class="rounded-card border-duvet-line bg-duvet-card text-duvet-ink shadow-duvet-float motion-safe:animate-slide-in pointer-events-auto fixed right-4 z-10000 flex h-18 w-80 items-center gap-3 border py-3 pr-3 pl-3.5"
		style="bottom: {bottom}px"
	>
		<button
			type="button"
			title="Open the conversation"
			class="focus-visible:outline-duvet-accent flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2"
			onclick={open}
		>
			<span class="relative shrink-0">
				<span
					class="motion-safe:animate-call-pulse absolute -inset-1 rounded-full border-2 {ringing
						? 'border-duvet-alive/50'
						: 'border-duvet-ink2/45'}"
				></span>
				<UserAvatar src={face.userId ? getAvatarURL(face.userId, face.avatar) : null} name={face.name} size={40} />
			</span>
			<span class="flex min-w-0 flex-col">
				<span class="truncate text-sm font-semibold">{face.name}</span>
				{#if ringing}
					<span class="text-duvet-alive flex min-w-0 items-center gap-1 text-xs">
						<PhoneIncoming class="size-3 shrink-0" />
						<span class="truncate"
							>Incoming call{#if face.place}<!-- An expression keeps the space Svelte trims from a tag's start. --><span
									class="text-duvet-ink2">{` · ${face.place}`}</span
								>{/if}</span
						>
					</span>
				{:else}
					<span class="text-duvet-ink2 flex items-center gap-1 text-xs">
						<PhoneOutgoing class="size-3 shrink-0" />
						<span>Calling…</span>
					</span>
				{/if}
			</span>
		</button>
		<div class="flex shrink-0 items-center gap-2">
			{#if ringing}
				<button
					type="button"
					aria-label="Accept call"
					title="Accept"
					class="text-fixed-white focus-visible:outline-duvet-accent flex size-9 items-center justify-center rounded-full bg-emerald-600 transition hover:bg-emerald-500 focus-visible:outline-2 active:scale-95"
					onclick={accept}
				>
					<Phone class="size-4.5" />
				</button>
				<button
					type="button"
					aria-label="Decline call"
					title="Decline"
					class="text-fixed-white focus-visible:outline-duvet-accent flex size-9 items-center justify-center rounded-full bg-red-600 transition hover:bg-red-500 focus-visible:outline-2 active:scale-95"
					onclick={decline}
				>
					<PhoneOff class="size-4.5" />
				</button>
			{:else}
				<button
					type="button"
					aria-label="Cancel call"
					title="Cancel"
					class="text-fixed-white focus-visible:outline-duvet-accent flex size-9 items-center justify-center rounded-full bg-red-600 transition hover:bg-red-500 focus-visible:outline-2 active:scale-95"
					onclick={cancel}
				>
					<PhoneOff class="size-4.5" />
				</button>
			{/if}
		</div>
		{#if ringing}
			<span role="alert" class="sr-only">Incoming call from {face.name}</span>
		{/if}
	</section>
{/if}
