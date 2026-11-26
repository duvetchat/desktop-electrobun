<script lang="ts">
	import { onMount } from "svelte";
	import { getBotUser, type BotUser } from "$lib/api/developer";
	import { botInviteRequest } from "$lib/stores.svelte";
	import { getAvatarURL } from "$lib/common/common";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { t } from "$lib/i18n";
	import { MESSAGE_INVITE_CARD } from "$lib/message-styles";

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
	<div class={MESSAGE_INVITE_CARD}>
		<div class="bg-duvet-ink/10 mb-3 h-3 w-36 animate-pulse rounded"></div>
		<div class="mb-4 flex items-center gap-3">
			<div class="bg-duvet-ink/10 h-12 w-12 shrink-0 animate-pulse rounded-full"></div>
			<div class="flex flex-col gap-1.5">
				<div class="bg-duvet-ink/10 h-4 w-24 animate-pulse rounded"></div>
			</div>
		</div>
		<div class="bg-duvet-ink/10 h-9 w-full animate-pulse rounded-md"></div>
	</div>
{:else if !error && bot}
	<div class={MESSAGE_INVITE_CARD}>
		<p class="text-duvet-ink2 mb-3 text-[13px] font-bold">{t("media_bot_invite_title")}</p>
		<div class="mb-4 flex items-center gap-3">
			<div class="shrink-0">
				<UserAvatar src={getAvatarURL(bot.id, bot.avatar)} name={bot.username} size={48} />
			</div>
			<div class="min-w-0">
				<div class="flex items-center gap-1.5">
					<p class="text-duvet-ink truncate text-sm font-semibold">{bot.username}</p>
					<span class="text-xxs bg-duvet-accent text-duvet-on-accent rounded px-1 py-0.5 font-bold"
						>{t("media_bot_badge")}</span
					>
				</div>
			</div>
		</div>

		<button
			class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised w-full rounded-xl py-2 text-sm font-bold transition-colors hover:brightness-110 motion-reduce:transition-none"
			onclick={() => botInviteRequest.set(botUserId)}
		>
			{t("media_bot_invite_add")}
		</button>
	</div>
{/if}
