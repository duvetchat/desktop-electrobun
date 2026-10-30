<script lang="ts">
	import { Dialog } from "bits-ui";
	import { X as XIcon } from "@lucide/svelte";
	import { getBotUser, addBotToSpace, type BotUser } from "$lib/api/developer";
	import { gatewaySpaces } from "$lib/stores.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { getApiError } from "$lib/api/api";
	import { hasSpacePermission, Permission } from "$lib/permissions";

	let {
		open = $bindable(false),
		botUserId = $bindable(""),
	}: {
		open?: boolean;
		botUserId?: string;
	} = $props();

	// The spaces the user can add a bot to: the API takes ManageBots in the space.
	const botSpaces = $derived($gatewaySpaces.filter((s) => hasSpacePermission(s, Permission.ManageBots)));

	let bot = $state<BotUser | null>(null);
	let loading = $state(false);
	let adding = $state(false);
	let error = $state("");

	$effect(() => {
		if (open && botUserId) {
			loading = true;
			error = "";
			bot = null;
			getBotUser(botUserId)
				.then((user) => {
					if (!user.is_bot) {
						error = "This user is not a bot.";
					} else {
						bot = user;
					}
				})
				.catch(() => {
					error = "Bot not found.";
				})
				.finally(() => {
					loading = false;
				});
		}
	});

	async function handleAdd(spaceId: string) {
		adding = true;
		try {
			await addBotToSpace(spaceId, botUserId);
			const spaceName = $gatewaySpaces.find((s) => s.id === spaceId)?.name ?? "the space";
			toast(`Bot added to ${spaceName}!`, "success");
			open = false;
		} catch (err) {
			toast(getApiError(err, "Failed to add bot"), "error");
		} finally {
			adding = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<Dialog.Content
			class="fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-base font-semibold text-white">Add Bot to Space</h2>
				<Dialog.Close class="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white">
					<XIcon class="size-5" />
				</Dialog.Close>
			</div>

			{#if loading}
				<div class="flex items-center justify-center py-8">
					<div class="h-8 w-8 animate-spin rounded-full border-3 border-stone-500 border-t-transparent"></div>
				</div>
			{:else if error}
				<p class="py-4 text-center text-sm text-red-400">{error}</p>
			{:else if bot}
				<div class="mb-4 flex items-center gap-3">
					<UserAvatar src={getAvatarURL(bot.id, bot.avatar)} name={bot.username} size={40} />
					<div>
						<div class="flex items-center gap-1.5">
							<span class="text-sm font-semibold text-white">{bot.username}</span>
							<span class="text-xxs bg-fill-600 text-fixed-white rounded px-1 py-0.5 font-semibold">BOT</span>
						</div>
					</div>
				</div>

				<p class="mb-3 text-xs text-zinc-500">Select a space:</p>
				<div class="flex max-h-48 flex-col gap-1 overflow-y-auto">
					{#each botSpaces as space (space.id)}
						<button
							class="flex items-center gap-3 rounded-lg bg-zinc-800 px-3 py-2.5 text-left transition-colors hover:bg-zinc-700 disabled:opacity-50"
							onclick={() => handleAdd(space.id)}
							disabled={adding}
						>
							<div
								class="from-fill-500 to-fill-700 text-fixed-white flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br text-sm font-bold select-none"
							>
								{space.name.charAt(0).toUpperCase()}
							</div>
							<span class="truncate text-sm text-white">{space.name}</span>
						</button>
					{/each}
				</div>

				{#if $gatewaySpaces.length === 0}
					<p class="py-4 text-center text-sm text-zinc-500">You're not in any spaces yet.</p>
				{:else if botSpaces.length === 0}
					<p class="py-4 text-center text-sm text-zinc-500">Adding a bot to a space takes Manage Bots in it.</p>
				{/if}
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
