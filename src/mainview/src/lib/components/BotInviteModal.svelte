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
	import { t, type MessageKey } from "$lib/i18n";

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
	// Why the bot can't be shown, drawn in the app's language of the moment.
	let error = $state<MessageKey | null>(null);

	$effect(() => {
		if (open && botUserId) {
			loading = true;
			error = null;
			bot = null;
			getBotUser(botUserId)
				.then((user) => {
					if (!user.is_bot) {
						error = "people_bot_invite_not_bot";
					} else {
						bot = user;
					}
				})
				.catch(() => {
					error = "people_bot_invite_not_found";
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
			const spaceName = $gatewaySpaces.find((s) => s.id === spaceId)?.name;
			toast(
				spaceName === undefined
					? t("people_bot_invite_added_unnamed")
					: t("people_bot_invite_added", { space: spaceName }),
				"success",
			);
			open = false;
		} catch (err) {
			toast(getApiError(err, t("people_bot_invite_failed")), "error");
		} finally {
			adding = false;
		}
	}
</script>

<Sheet bind:open title={t("people_bot_invite_title")} class="max-w-[420px]">
	{#if loading}
		<div class="text-duvet-ink2 flex items-center justify-center py-8">
			<div class={spinnerClass("lg")} role="status" aria-label={t("people_bot_invite_loading")}></div>
		</div>
	{:else if error}
		<p class="text-duvet-danger py-4 text-center text-[13px]">{t(error)}</p>
	{:else if bot}
		<div class="flex items-center gap-3">
			<UserAvatar src={getAvatarURL(bot.id, bot.avatar)} name={bot.username} size={40} />
			<div class="flex min-w-0 items-center gap-1.5">
				<span class="text-duvet-ink truncate text-[14px] font-semibold">{bot.username}</span>
				<span
					class="bg-duvet-secondary-fill text-duvet-ink2 rounded-[5px] px-1.5 py-0.5 text-[9.5px] leading-none font-bold tracking-[0.04em]"
					>{t("people_tag_bot")}</span
				>
			</div>
		</div>

		<p class="text-duvet-ink2 text-xs">{t("people_bot_invite_pick")}</p>
		<div class="-mx-1 flex max-h-48 flex-col gap-0.5 overflow-y-auto px-1">
			{#each botSpaces as space (space.id)}
				<button
					class="hover:bg-duvet-hover flex shrink-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors disabled:opacity-45 motion-reduce:transition-none"
					onclick={() => handleAdd(space.id)}
					disabled={adding}
				>
					<div
						class="bg-duvet-chosen text-duvet-chosen-ink grid size-8 shrink-0 place-items-center rounded-[9px] text-sm font-bold select-none"
					>
						{space.name.charAt(0).toUpperCase()}
					</div>
					<span class="text-duvet-ink truncate text-[13.5px] font-medium">{space.name}</span>
				</button>
			{/each}
		</div>

		{#if $gatewaySpaces.length === 0}
			<p class="text-duvet-ink2 py-4 text-center text-[13px]">{t("people_bot_invite_no_spaces")}</p>
		{:else if botSpaces.length === 0}
			<p class="text-duvet-ink2 py-4 text-center text-[13px]">{t("people_bot_invite_no_permission")}</p>
		{/if}
	{/if}
</Sheet>
