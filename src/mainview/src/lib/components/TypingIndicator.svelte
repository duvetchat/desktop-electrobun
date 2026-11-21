<script lang="ts">
	import { Mic as MicIcon } from "@lucide/svelte";
	import { typingUsers, currentUser } from "$lib/stores.svelte";
	import GhostMark from "$lib/components/GhostMark.svelte";
	import { recordingPhrase, TYPING_TIMEOUT, typingPhrase, typingSentence } from "$lib/typing";

	let { channelId }: { channelId: string } = $props();

	let now = $state(Date.now());

	$effect(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(timer);
	});

	const active = $derived(
		($typingUsers[channelId] ?? [])
			.filter((u) => now - u.timestamp < TYPING_TIMEOUT)
			.filter((u) => u.user_id !== $currentUser?.id),
	);
	// Those typing, and those recording a voice message.
	const typers = $derived(active.filter((u) => !u.recording));
	const recorders = $derived(active.filter((u) => u.recording));
</script>

<!-- What a screen reader hears: the sentence, once, in a line that is there before anyone types, so that it is read as
     it changes (mobile's Semantics(liveRegion)). The pill says the same to the eye, and is hidden from it. -->
<span class="sr-only" role="status">{typingSentence(active) ?? ""}</span>
<!-- Over the list's bottom (Chat's draftBars), in the 24 px the list leaves under its newest message, so it covers no
     message, and moves none as it comes and goes. It is a small glass pill: the messages that pass under it as the list
     scrolls stay out of its words. As on mobile (bubble.dart's _TypingLine): the Duvet ghost, its violet typing dots,
     then who's typing; nobody's picture. -->
{#if active.length > 0}
	<div
		class="bg-duvet-glass text-duvet-ink2 z-10 mb-0.5 flex h-5 max-w-full items-center gap-1.5 self-start rounded-full pr-2 pl-1.5 text-xs backdrop-blur-[20px] backdrop-saturate-[1.8]"
		aria-hidden="true"
	>
		<GhostMark size={20} class="shrink-0" />
		{#if typers.length > 0}
			<!-- Mobile's TypingDots: each dot is at its brightest a third of the loop after the one before it. Under
			     reduced motion they stay as they are styled, one bright and two fainter. -->
			<div class="mr-0.5 flex shrink-0 items-center gap-1" data-typing-dots>
				<span class="animate-ghost-dot bg-duvet-chosen-ink block size-1.5 rounded-full"></span>
				<span
					class="animate-ghost-dot bg-duvet-chosen-ink block size-1.5 rounded-full opacity-60 [animation-delay:-0.8s]"
				></span>
				<span
					class="animate-ghost-dot bg-duvet-chosen-ink block size-1.5 rounded-full opacity-35 [animation-delay:-0.4s]"
				></span>
			</div>
			<span class="min-w-0 truncate">{typingPhrase(typers)}</span>
		{/if}
		{#if recorders.length > 0}
			<span class="min-w-0 truncate {typers.length > 0 ? 'ml-1.5' : ''}">{recordingPhrase(recorders)}</span>
			<MicIcon class="text-duvet-call-red animate-rec-pulse size-3 shrink-0" aria-hidden="true" />
		{/if}
	</div>
{/if}
