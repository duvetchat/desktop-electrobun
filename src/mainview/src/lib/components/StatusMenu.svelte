<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import type { Snippet } from "svelte";
	import { Check } from "@lucide/svelte";
	import { currentUser } from "$lib/stores.svelte";
	import { setMyStatus } from "$lib/api/user";
	import { getApiError } from "$lib/api/api";
	import { toast } from "$lib/stores/toast.svelte";
	import { STATUS_CHOICES, chosenStatus } from "$lib/status";
	import { userStatusToString, type ChosenStatus } from "$lib/types";
	import StatusDot from "$lib/components/StatusDot.svelte";

	// The user panel's status menu: its trigger is the children, and it lists the statuses the user can choose.
	let { children, class: className = "" }: { children: Snippet; class?: string } = $props();

	const current = $derived(chosenStatus($currentUser?.status));
	const currentLabel = $derived(STATUS_CHOICES.find((c) => c.status === current)?.label ?? "");
	let saving = $state(false);

	async function choose(status: ChosenStatus) {
		if (saving || status === current) return;
		saving = true;
		try {
			const saved = await setMyStatus(status);
			// Every session hears of it (USER_STATUS_UPDATE), this one too; the menu shows it at once.
			currentUser.update((u) => (u?.id === saved.id ? { ...u, status: chosenStatus(saved.status) } : u));
		} catch (err) {
			toast(getApiError(err, "Failed to change your status"), "error");
		} finally {
			saving = false;
		}
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger class={className} aria-label="Status: {currentLabel}">
		{@render children()}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			class="z-200 w-64 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl"
			side="top"
			align="start"
			sideOffset={8}
		>
			{#each STATUS_CHOICES as choice (choice.status)}
				<DropdownMenu.Item
					class="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700 data-disabled:cursor-default data-disabled:opacity-50 data-highlighted:bg-zinc-700"
					disabled={saving}
					onSelect={() => choose(choice.status)}
				>
					<StatusDot status={userStatusToString(choice.status)} class="mt-1 size-2.5 shrink-0" />
					<span class="flex min-w-0 flex-1 flex-col">
						<span>{choice.label}</span>
						{#if choice.description}
							<span class="text-xs text-zinc-400">{choice.description}</span>
						{/if}
					</span>
					{#if current === choice.status}
						<Check class="mt-0.5 size-4 shrink-0 text-zinc-300" />
					{/if}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
