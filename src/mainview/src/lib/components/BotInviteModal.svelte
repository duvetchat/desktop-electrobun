<script lang="ts">
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import { spinnerClass } from "$lib/overlay-forms";
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
			const spaceName = $gatewaySpaces.find((s) => s.id === spaceId)?.name ?? "the Space";
			toast(`Bot added to ${spaceName}`, "success");
			open = false;
		} catch (err) {
			toast(getApiError(err, "Failed to add bot"), "error");
		} finally {
			adding = false;
		}
	}
</script>

<Sheet bind:open title="Add a bot to a Space" class="max-w-[420px]">
	{#if loading}
		<div class="text-duvet-ink2 flex items-center justify-center py-8">
			<div class={spinnerClass("lg")} role="status" aria-label="Loading the bot"></div>
		</div>
	{:else if error}
		<p class="text-duvet-danger py-4 text-center text-[13px]">{error}</p>
	{:else if bot}
		<div class="flex items-center gap-3">
			<UserAvatar src={getAvatarURL(bot.id, bot.avatar)} name={bot.username} size={40} />
			<div class="flex min-w-0 items-center gap-1.5">
				<span class="text-duvet-ink truncate text-[14px] font-semibold">{bot.username}</span>
				<span
					class="bg-duvet-secondary-fill text-duvet-ink2 rounded-[5px] px-1.5 py-0.5 text-[9.5px] leading-none font-bold tracking-[0.04em]"
					>BOT</span
				>
			</div>
		</div>

		<p class="text-duvet-ink2 text-xs">Pick a Space</p>
		<div class="-mx-1 flex max-h-48 flex-col gap-0.5 overflow-y-auto px-1">
			{#each botSpaces as space (space.id)}
				<button
					class="hover:bg-duvet-hover flex shrink-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors disabled:opacity-45 motion-reduce:transition-none"
					onclick={() => handleAdd(space.id)}
					disabled={adding}
				>
					<div
						class="bg-duvet-chosen text-duvet-chosen-ink rounded-tile grid size-8 shrink-0 place-items-center text-sm font-bold select-none"
					>
						{space.name.charAt(0).toUpperCase()}
					</div>
					<span class="text-duvet-ink truncate text-[13.5px] font-medium">{space.name}</span>
				</button>
			{/each}
		</div>

		{#if $gatewaySpaces.length === 0}
			<p class="text-duvet-ink2 py-4 text-center text-[13px]">You're not in any Spaces yet.</p>
		{:else if botSpaces.length === 0}
			<p class="text-duvet-ink2 py-4 text-center text-[13px]">Adding a bot to a Space takes Manage Bots in it.</p>
		{/if}
	{/if}
</Sheet>
