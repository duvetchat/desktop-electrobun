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
	<div class="typing-bar">
		<div class="typing-avatars">
			{#each activeTypers.slice(0, 3) as user (user.user_id)}
				<div class="typing-avatar">
					<UserAvatar
						src={user.avatar}
						name={displayName(user)}
						size={18}
					/>
				</div>
			{/each}
		</div>
		<span class="typing-text">{typingText()}</span>
		<div class="typing-dots" aria-hidden="true">
			<span></span>
			<span></span>
			<span></span>
		</div>
	</div>
{/if}

<style>
	.typing-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 12px 4px;
		min-height: 20px;
		font-size: 12px;
		color: oklch(0.65 0.01 80);
	}

	.typing-avatars {
		display: flex;
		align-items: center;
	}

	.typing-avatar {
		border-radius: 50%;
		border: 1.5px solid oklch(0.19 0.008 80);
		margin-left: -4px;
	}

	.typing-avatar:first-child {
		margin-left: 0;
	}

	.typing-text {
		font-size: 12px;
		color: oklch(0.65 0.01 80);
	}

	.typing-text strong {
		color: oklch(0.85 0.008 80);
		font-weight: 600;
	}

	.typing-dots {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-left: 2px;
	}

	.typing-dots span {
		display: block;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: oklch(0.55 0.01 80);
		animation: typing-bounce 1.2s ease-in-out infinite;
	}

	.typing-dots span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.typing-dots span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes typing-bounce {
		0%, 60%, 100% {
			transform: translateY(0);
			opacity: 0.5;
		}
		30% {
			transform: translateY(-4px);
			opacity: 1;
		}
	}
</style>
