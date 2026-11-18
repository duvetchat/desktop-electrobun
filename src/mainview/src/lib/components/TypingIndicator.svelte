<script lang="ts">
	import { Mic as MicIcon } from "@lucide/svelte";
	import { typingUsers, currentUser } from "$lib/stores.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { recordingPhrase, TYPING_TIMEOUT, typingPhrase } from "$lib/typing";

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

	function displayName(u: { alias: string | null; username: string }): string {
		return u.alias ?? u.username;
	}
</script>

<!-- Over the list's bottom (Chat's draftBars), in the 24 px the list leaves under its newest message, so it covers no
     message, and moves none as it comes and goes. It is a small glass pill: the messages that pass under it as the list
     scrolls stay out of its words. -->
{#if active.length > 0}
	<div
		class="bg-duvet-glass text-duvet-ink2 z-10 mb-0.5 flex h-5 max-w-full items-center gap-1.5 self-start rounded-full pr-2 pl-0.5 text-xs backdrop-blur-[20px] backdrop-saturate-[1.8]"
	>
		<div class="flex shrink-0 items-center">
			{#each active.slice(0, 3) as user, i (user.user_id)}
				<div class="ring-duvet-bg rounded-full ring-[1.5px] {i === 0 ? '' : '-ml-1'}">
					<UserAvatar src={getAvatarURL(user.user_id, user.avatar)} name={displayName(user)} size={16} />
				</div>
			{/each}
		</div>
		{#if typers.length > 0}
			<span class="text-duvet-ink2 [&_strong]:text-duvet-ink min-w-0 truncate text-xs [&_strong]:font-semibold"
				>{typingPhrase(typers)}</span
			>
			<div class="ml-0.5 flex shrink-0 items-center gap-0.75" aria-hidden="true">
				<span class="animate-typing-bounce bg-duvet-ink2 block size-1 rounded-full"></span>
				<span class="animate-typing-bounce bg-duvet-ink2 block size-1 rounded-full [animation-delay:0.2s]"></span>
				<span class="animate-typing-bounce bg-duvet-ink2 block size-1 rounded-full [animation-delay:0.4s]"></span>
			</div>
		{/if}
		{#if recorders.length > 0}
			<span class="text-duvet-ink2 min-w-0 truncate text-xs {typers.length > 0 ? 'ml-1.5' : ''}"
				>{recordingPhrase(recorders)}</span
			>
			<MicIcon class="text-duvet-call-red animate-rec-pulse size-3 shrink-0" aria-hidden="true" />
		{/if}
	</div>
{/if}
