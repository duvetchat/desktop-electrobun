<script lang="ts">
	import { activeCall, activeVoiceRoomId, conversations, currentUser } from "$lib/stores.svelte";
	import { acceptCall, cancelCall, sendEventMessage } from "$lib/api/ws/connection";
	import { Phone, PhoneIncoming, PhoneOff, PhoneOutgoing } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { audioStore } from "$lib/stores/audio.svelte";
	import { callRings } from "$lib/status";
	import { callCardFace } from "$lib/calls";
	import { GLASS } from "$lib/components/ui/recipes";
	import { openCallChatWith } from "$lib/media-source";
	import { onDestroy, onMount } from "svelte";

	// A call ringing here, or one the user places, as a notice at the top centre of the app (#357: the redesign moves
	// it there from the bottom right corner, DECISIONS.md): it covers nothing else and takes no focus, so the user goes
	// on with what they were doing. A click on its name opens the call's chat.
	let { onOpen }: { onOpen: (conversationId: string) => void } = $props();

	// The call panel's first line opens a call's chat too, while the call still rings (lib/media-source.ts).
	onMount(() => {
		openCallChatWith(onOpen);
		return () => openCallChatWith(null);
	});

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

{#if call && face && shown}
	<!-- Above every dialog's layer, so none covers a ringing call (CallCard.test.ts checks them all), and taking clicks
	     while a modal dialog turns them off on the body, as a toast does. Under the title bar, where the notices are. -->
	<section
		aria-label={ringing ? "Incoming call" : "Calling"}
		class="{GLASS} text-duvet-ink animate-notice-in pointer-events-auto fixed inset-x-0 top-[62px] z-10000 mx-auto flex w-[min(420px,calc(100vw-32px))] items-center gap-3 rounded-[18px] py-3 pr-3 pl-3.5"
	>
		<button
			type="button"
			title="Open the chat"
			class=" flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
			onclick={open}
		>
			<span class="relative shrink-0">
				<span
					class="motion-safe:animate-call-pulse absolute -inset-1 rounded-full border-2 {ringing
						? 'border-duvet-alive/50'
						: 'border-duvet-ink2/45'}"
				></span>
				<UserAvatar src={face.userId ? getAvatarURL(face.userId, face.avatar) : null} name={face.name} size={36} />
			</span>
			<span class="flex min-w-0 flex-col gap-0.5">
				<span class="truncate text-[13.5px] leading-[1.25] font-semibold">{face.name}</span>
				{#if ringing}
					<span class="font-content flex min-w-0 items-center gap-1.5 text-[13.5px] leading-[1.35]">
						<PhoneIncoming class="text-duvet-alive shrink-0" size={13} />
						<span class="truncate"
							>Incoming call{#if face.place}<!-- An expression keeps the space Svelte trims from a tag's start. --><span
									class="text-duvet-ink2">{` · ${face.place}`}</span
								>{/if}</span
						>
					</span>
				{:else}
					<span class="text-duvet-ink2 font-content flex items-center gap-1.5 text-[13.5px] leading-[1.35]">
						<PhoneOutgoing class="shrink-0" size={13} />
						<span>Calling…</span>
					</span>
				{/if}
			</span>
		</button>
		<div class="flex shrink-0 items-center gap-2">
			{#if ringing}
				<button
					type="button"
					aria-label="Decline call"
					title="Decline"
					class="bg-duvet-call-red text-fixed-white grid h-9 w-10 place-items-center rounded-xl transition-[filter] hover:brightness-[1.08] motion-reduce:transition-none"
					onclick={decline}
				>
					<PhoneOff size={16} />
				</button>
				<button
					type="button"
					aria-label="Accept call"
					title="Accept"
					class="bg-duvet-alive text-fixed-white animate-ring grid h-9 w-10 place-items-center rounded-xl transition-[filter] hover:brightness-[1.08] motion-reduce:transition-none"
					onclick={accept}
				>
					<Phone size={16} />
				</button>
			{:else}
				<button
					type="button"
					aria-label="Cancel call"
					title="Cancel"
					class="bg-duvet-call-red text-fixed-white grid h-9 w-10 place-items-center rounded-xl transition-[filter] hover:brightness-[1.08] motion-reduce:transition-none"
					onclick={cancel}
				>
					<PhoneOff size={16} />
				</button>
			{/if}
		</div>
		{#if ringing}
			<span role="alert" class="sr-only">Incoming call from {face.name}</span>
		{/if}
	</section>
{/if}
