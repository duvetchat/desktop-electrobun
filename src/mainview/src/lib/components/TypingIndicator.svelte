<script lang="ts">
import { typingUsers, currentUser } from "$lib/stores.svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";

let { channelId }: { channelId: string } = $props();

const TYPING_TIMEOUT = 5000;

let now = $state(Date.now());

$effect(() => {
	const timer = setInterval(() => {
		now = Date.now();
	}, 1000);
	return () => clearInterval(timer);
});

const activeTypers = $derived(
	($typingUsers[channelId] ?? [])
		.filter((u) => now - u.timestamp < TYPING_TIMEOUT)
		.filter((u) => u.user_id !== $currentUser?.id),
);

function displayName(u: { alias: string | null; username: string }): string {
	return u.alias ?? u.username;
}

function typingText(): string {
	if (activeTypers.length === 1) return `${displayName(activeTypers[0])} is typing`;
	if (activeTypers.length === 2)
		return `${displayName(activeTypers[0])} and ${displayName(activeTypers[1])} are typing`;
	return "Several people are typing";
}
</script>

{#if activeTypers.length > 0}
	<div class="flex items-center gap-[6px] px-3 pt-[2px] pb-1 min-h-[20px] text-xs text-[oklch(0.65_0.01_80)]">
		<div class="flex items-center">
			{#each activeTypers.slice(0, 3) as user, i (user.user_id)}
				<div class="rounded-full border-[1.5px] border-[oklch(0.19_0.008_80)] {i === 0 ? '' : '-ml-1'}">
					<UserAvatar
						src={user.avatar}
						name={displayName(user)}
						size={18}
					/>
				</div>
			{/each}
		</div>
		<span class="text-xs text-[oklch(0.65_0.01_80)] [&_strong]:text-[oklch(0.85_0.008_80)] [&_strong]:font-semibold">{typingText()}</span>
		<div class="flex items-center gap-[3px] ml-[2px]" aria-hidden="true">
			<span class="block size-1 rounded-full bg-[oklch(0.55_0.01_80)] animate-typing-bounce"></span>
			<span class="block size-1 rounded-full bg-[oklch(0.55_0.01_80)] animate-typing-bounce [animation-delay:0.2s]"></span>
			<span class="block size-1 rounded-full bg-[oklch(0.55_0.01_80)] animate-typing-bounce [animation-delay:0.4s]"></span>
		</div>
	</div>
{/if}
