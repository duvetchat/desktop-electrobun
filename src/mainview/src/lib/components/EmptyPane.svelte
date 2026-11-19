<script lang="ts">
	import helloOnLight from "$lib/assets/mascot/light/hello.svg";
	import helloOnDark from "$lib/assets/mascot/dark/hello.svg";
	import type { Conversation } from "$lib/api/conversations";
	import { getAvatarURL } from "$lib/common/common";
	import { conversationTitle, otherMember } from "$lib/pane";
	import { currentShell } from "$lib/platform";
	import { keysFor, SHELL_KEYS } from "$lib/shell-layout";
	import { conversations, currentUser } from "$lib/stores.svelte";
	import GroupMark from "$lib/components/GroupMark.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Kbd from "$lib/components/ui/Kbd.svelte";

	// A pane with no chat open (#357, S-12): the mascot, where to go from here, and the user's latest chats to open
	// in it with one click. A room or a chat can still be dragged onto it.
	let { onOpen }: { onOpen: (conversation: Conversation) => void } = $props();

	const keys = keysFor(currentShell().os === "mac", SHELL_KEYS.switcher);
	// The conversations come with the latest first.
	const recent = $derived($conversations.slice(0, 4));
</script>

<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto p-10 text-center">
	<img src={helloOnLight} alt="" class="hidden size-28 in-[.duvet-light]:block" draggable="false" />
	<img src={helloOnDark} alt="" class="size-28 in-[.duvet-light]:hidden" draggable="false" />
	<h2 class="font-serif-lg text-duvet-ink mt-1.5 text-2xl leading-[1.2] font-normal">Where to?</h2>
	<p class="text-duvet-ink2 flex flex-wrap items-center justify-center gap-1.5 text-[13px]">
		Pick a chat or a room in the sidebar, or press <Kbd>{keys}</Kbd>
	</p>
	{#if recent.length > 0}
		<ul class="mt-3.5 flex max-w-xl flex-wrap justify-center gap-2" aria-label="Latest chats">
			{#each recent as conversation (conversation.id)}
				{@const title = conversationTitle(conversation, $currentUser?.id)}
				{@const other = otherMember(conversation, $currentUser?.id)}
				<li>
					<button
						type="button"
						class="bg-duvet-card text-duvet-ink shadow-duvet-raised hover:shadow-duvet-lifted focus-visible:outline-duvet-accent flex h-[34px] max-w-56 items-center gap-2 rounded-xl pr-3 pl-2 text-[13px] font-medium transition-shadow duration-[120ms] focus-visible:outline-2 motion-reduce:transition-none"
						onclick={() => onOpen(conversation)}
					>
						{#if other}
							<UserAvatar src={getAvatarURL(other.user_id, other.user?.avatar)} name={title} size={18} />
						{:else}
							<GroupMark size={18} />
						{/if}
						<span class="truncate">{title}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
