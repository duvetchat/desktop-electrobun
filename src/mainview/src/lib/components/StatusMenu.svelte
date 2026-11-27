<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { DropdownMenu } from "bits-ui";
	import type { Snippet } from "svelte";
	import { Check } from "@lucide/svelte";
	import { currentUser } from "$lib/stores.svelte";
	import { setMyStatus } from "$lib/api/user";
	import { getApiError } from "$lib/api/api";
	import { t } from "$lib/i18n";
	import { toast } from "$lib/stores/toast.svelte";
	import { STATUS_CHOICES, chosenStatus } from "$lib/status";
	import { userStatusToString, type ChosenStatus } from "$lib/types";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import { MENU_PANEL, menuItemClass } from "$lib/components/ui/recipes";

	// The user panel's status menu: its trigger is the children, and it lists the statuses the user can choose.
	let { children, class: className = "" }: { children: Snippet; class?: string } = $props();

	const current = $derived(chosenStatus($currentUser?.status));
	let saving = $state(false);

	async function choose(status: ChosenStatus) {
		if (saving || status === current) return;
		saving = true;
		try {
			const saved = await setMyStatus(status);
			// Every session hears of it (USER_STATUS_UPDATE), this one too; the menu shows it at once.
			currentUser.update((u) => (u?.id === saved.id ? { ...u, status: chosenStatus(saved.status) } : u));
		} catch (err) {
			toast(getApiError(err, t("status_change_failed")), "error");
		} finally {
			saving = false;
		}
	}

	let open = $state(false);

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger
		class={className}
		aria-label={t("status_menu_label", {
			name: $currentUser?.alias || $currentUser?.username || "",
			status: current === 2 ? "dnd" : "online",
		})}
	>
		{@render children()}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		{#if layer}
			<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
			<div class="fixed top-0 left-0" style={layerStyle(layer)}>
				<DropdownMenu.Content
					class="{MENU_PANEL} focus-override w-72 origin-(--bits-floating-transform-origin)"
					side="top"
					align="start"
					sideOffset={6}
					collisionPadding={10}
				>
					{#each STATUS_CHOICES as choice (choice.status)}
						{@const chosen = current === choice.status}
						<!-- The chosen status carries the check; choosing it again does nothing. -->
						<DropdownMenu.Item
							class="{menuItemClass()} cursor-pointer data-disabled:cursor-default"
							disabled={saving}
							aria-current={chosen ? "true" : undefined}
							onSelect={() => choose(choice.status)}
						>
							<span class="grid w-[18px] shrink-0 place-items-center">
								<StatusDot status={userStatusToString(choice.status)} class="w-2.5" />
							</span>
							<span class="flex min-w-0 flex-1 flex-col gap-px">
								<span class="truncate">{t(choice.label)}</span>
								{#if choice.description}
									<span class="text-duvet-ink2 text-[11px] leading-[1.2] font-normal">{t(choice.description)}</span>
								{/if}
							</span>
							{#if chosen}
								<Check size={15} class="text-duvet-accent-text shrink-0" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</div>
		{/if}
	</DropdownMenu.Portal>
</DropdownMenu.Root>
