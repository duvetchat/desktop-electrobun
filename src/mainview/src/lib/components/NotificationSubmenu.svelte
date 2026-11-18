<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import { Bell as BellIcon, Check as CheckIcon, ChevronRight as ChevronRightIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import { clearNotificationLevel, setNotificationLevel } from "$lib/api/notifications";
	import { notificationLevels } from "$lib/notification-levels";
	import { toast } from "$lib/stores/toast.svelte";
	import type { NotificationLevel, NotificationTarget } from "$lib/types";
	import { MENU_PANEL, menuItemClass } from "$lib/components/ui/recipes";

	// The Notifications submenu of a Space's, a room's or a chat's menu, a context menu's or a dropdown's alike: bits-ui
	// builds both from the same menu parts. A Space or a room also offers its default, which clears the user's own level
	// and falls back to `inherited` (lib/notification-levels.ts); a chat's default is every message, chosen as such. The
	// levels change once the API's NOTIFICATION_SETTINGS_UPDATE comes back. It is drawn as every menu is (the design
	// system's panel and items, components/ui/recipes.ts): a menu that still passes classes of its own keeps them.
	let {
		targetId,
		target,
		inherited = 0,
		itemClass = menuItemClass(),
		contentClass = `${MENU_PANEL} z-[1001] min-w-48`,
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
			<span class="text-duvet-accent-text grid w-[18px] shrink-0 place-items-center">
				{#if checked}<CheckIcon size={15} />{/if}
			</span>
			<span class="min-w-0 flex-1 truncate">{label}</span>
		{/snippet}
	</DropdownMenu.RadioItem>
{/snippet}

<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger class={itemClass}>
		<span class="text-duvet-ink2 grid w-[18px] shrink-0 place-items-center"><BellIcon size={16} /></span>
		<span class="min-w-0 flex-1 truncate">Notifications</span>
		<ChevronRightIcon size={14} class="text-duvet-ink2 shrink-0" />
	</DropdownMenu.SubTrigger>
	<!-- In the page's root, as MenuSub's panel is: a glass menu's backdrop filter would otherwise be what this panel's
	     fixed position is measured from. It opens to the right, or the left at the window's edge, 2 px from the menu,
	     its first item level with Notifications. -->
	<DropdownMenu.Portal>
		<DropdownMenu.SubContent
			class="{contentClass} origin-(--bits-floating-transform-origin)"
			side="right"
			align="start"
			sideOffset={8}
			alignOffset={-6}
			collisionPadding={10}
		>
			<DropdownMenu.RadioGroup value={chosen} onValueChange={choose}>
				{#if withDefault}
					{@render choice("default", `Default (${LEVELS[inherited]})`)}
				{/if}
				{#each LEVELS as label, level (label)}
					{@render choice(String(level), label)}
				{/each}
			</DropdownMenu.RadioGroup>
		</DropdownMenu.SubContent>
	</DropdownMenu.Portal>
</DropdownMenu.Sub>
