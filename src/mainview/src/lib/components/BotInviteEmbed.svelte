<script lang="ts">
	import { onMount } from "svelte";
	import { getBotUser, type BotUser } from "$lib/api/developer";
	import { botInviteRequest } from "$lib/stores.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import UserAvatar from "$lib/components/UserAvatar.svelte";

	let { botUserId }: { botUserId: string } = $props();

	let bot = $state<BotUser | null>(null);
	let loading = $state(true);
	let error = $state(false);

	onMount(async () => {
		try {
			const user = await getBotUser(botUserId);
			if (user.is_bot) bot = user;
			else error = true;
		} catch {
			error = true;
		} finally {
			loading = false;
		}
	});
</script>

{#if loading}
	<div class="mt-2 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 p-4">
		<div class="mb-3 h-3 w-36 animate-pulse rounded bg-zinc-800"></div>
		<div class="mb-4 flex items-center gap-3">
			<div class="h-12 w-12 shrink-0 animate-pulse rounded-full bg-zinc-800"></div>
			<div class="flex flex-col gap-1.5">
				<div class="h-4 w-24 animate-pulse rounded bg-zinc-800"></div>
			</div>
		</div>
		<div class="h-9 w-full animate-pulse rounded-md bg-zinc-800"></div>
	</div>
{:else if !error && bot}
	<div
		class="mt-2 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 p-4 transition-colors duration-150 hover:bg-zinc-800/90"
	>
		<p class="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase">Add a bot to your space</p>
		<div class="mb-4 flex items-center gap-3">
			<div class="shrink-0">
				<UserAvatar src={getAvatarURL(bot.id, bot.avatar)} name={bot.username} size={48} />
			</div>
			<div class="min-w-0">
				<div class="flex items-center gap-1.5">
					<p class="truncate text-sm font-semibold text-white">{bot.username}</p>
					<span class="text-xxs rounded bg-stone-600 px-1 py-0.5 font-semibold text-white">BOT</span>
				</div>
			</div>
		</div>

		<button
			class="w-full rounded-md bg-stone-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-500"
			onclick={() => botInviteRequest.set(botUserId)}
		>
			Add to Space
		</button>
	</div>
{/if}
