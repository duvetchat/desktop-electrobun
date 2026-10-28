<script lang="ts">
	import { Mic as MicIcon } from "@lucide/svelte";
	import { typingUsers, currentUser } from "$lib/stores.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { getAvatarURL } from "$lib/common/common";

	let { channelId }: { channelId: string } = $props();

	const TYPING_TIMEOUT = 5000;

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

	function typingText(): string {
		if (typers.length === 1) return `${displayName(typers[0])} is typing`;
		if (typers.length === 2) return `${displayName(typers[0])} and ${displayName(typers[1])} are typing`;
		return "Several people are typing";
	}

	function recordingText(): string {
		if (recorders.length === 1) return `${displayName(recorders[0])} is recording a voice message`;
		if (recorders.length === 2)
			return `${displayName(recorders[0])} and ${displayName(recorders[1])} are recording voice messages`;
		return "Several people are recording voice messages";
	}
</script>

{#if active.length > 0}
	<div class="text-night-65 flex min-h-5 items-center gap-1.5 px-3 pt-0.5 pb-1 text-xs">
		<div class="flex items-center">
			{#each active.slice(0, 3) as user, i (user.user_id)}
				<div class="border-night-19 rounded-full border-[1.5px] {i === 0 ? '' : '-ml-1'}">
					<UserAvatar src={getAvatarURL(user.user_id, user.avatar)} name={displayName(user)} size={18} />
				</div>
			{/each}
		</div>
		{#if typers.length > 0}
			<span class="text-night-65 [&_strong]:text-night-85 text-xs [&_strong]:font-semibold">{typingText()}</span>
			<div class="ml-0.5 flex items-center gap-0.75" aria-hidden="true">
				<span class="animate-typing-bounce bg-night-55 block size-1 rounded-full"></span>
				<span class="animate-typing-bounce bg-night-55 block size-1 rounded-full [animation-delay:0.2s]"></span>
				<span class="animate-typing-bounce bg-night-55 block size-1 rounded-full [animation-delay:0.4s]"></span>
			</div>
		{/if}
		{#if recorders.length > 0}
			<span class="text-night-65 text-xs {typers.length > 0 ? 'ml-1.5' : ''}">{recordingText()}</span>
			<MicIcon class="size-3 animate-pulse text-red-400" aria-hidden="true" />
		{/if}
	</div>
{/if}
