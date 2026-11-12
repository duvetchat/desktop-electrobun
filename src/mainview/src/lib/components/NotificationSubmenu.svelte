<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import { Bell as BellIcon, Check as CheckIcon, ChevronRight as ChevronRightIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import { clearNotificationLevel, setNotificationLevel } from "$lib/api/notifications";
	import { notificationLevels } from "$lib/notification-levels";
	import { toast } from "$lib/stores/toast.svelte";
	import type { NotificationLevel, NotificationTarget } from "$lib/types";

	// The Notifications submenu of a Space's, a room's or a chat's menu, a context menu's or a dropdown's alike: bits-ui
	// builds both from the same menu parts. A Space or a room also offers its default, which clears the user's own level
	// and falls back to `inherited` (lib/notification-levels.ts); a chat's default is every message, chosen as such. The
	// levels change once the API's NOTIFICATION_SETTINGS_UPDATE comes back. Its classes default to the rooms' and the
	// chats' context menus'.
	let {
		targetId,
		target,
		inherited = 0,
		itemClass = "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-zinc-100 outline-none transition-colors hover:bg-zinc-700 data-highlighted:bg-zinc-700",
		contentClass = "z-200 min-w-44 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl",
	}: {
		targetId: string;
		target: NotificationTarget;
		inherited?: NotificationLevel;
		itemClass?: string;
		contentClass?: string;
	} = $props();

	const LEVELS = ["All messages", "Only mentions", "Nothing"];
	const withDefault = $derived(target !== 2);
	const own = $derived($notificationLevels[targetId]);
	const chosen = $derived(own !== undefined ? String(own) : withDefault ? "default" : "0");

	async function choose(value: string) {
		if (value === chosen) return;
		try {
			if (value === "default") await clearNotificationLevel(targetId);
			else await setNotificationLevel(targetId, target, Number(value) as NotificationLevel);
		} catch (err) {
			toast(getApiError(err, "Couldn't change the notifications"), "error");
		}
	}
</script>

{#snippet choice(value: string, label: string)}
	<DropdownMenu.RadioItem {value} class={itemClass}>
		{#snippet children({ checked })}
			<span class="min-w-0 flex-1">{label}</span>
			{#if checked}<CheckIcon class="text-duvet-accent-text size-4 shrink-0" />{/if}
		{/snippet}
	</DropdownMenu.RadioItem>
{/snippet}

<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger class={itemClass}>
		<BellIcon class="size-4 shrink-0 text-zinc-400" />
		<span class="min-w-0 flex-1">Notifications</span>
		<ChevronRightIcon class="size-4 shrink-0 text-zinc-400" />
	</DropdownMenu.SubTrigger>
	<DropdownMenu.SubContent class={contentClass} sideOffset={4}>
		<DropdownMenu.RadioGroup value={chosen} onValueChange={choose}>
			{#if withDefault}
				{@render choice("default", `Default (${LEVELS[inherited]})`)}
			{/if}
			{#each LEVELS as label, level (label)}
				{@render choice(String(level), label)}
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.SubContent>
</DropdownMenu.Sub>
