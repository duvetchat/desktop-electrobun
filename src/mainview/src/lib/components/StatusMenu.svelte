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
			class="rounded-card border-duvet-line bg-duvet-card text-duvet-ink shadow-duvet-float focus-override z-200 flex w-72 flex-col gap-1 border p-1.5 outline-none"
			side="top"
			align="start"
			sideOffset={8}
		>
			{#each STATUS_CHOICES as choice (choice.status)}
				{@const chosen = current === choice.status}
				<!-- The chosen status sits pressed in, as a chosen thing does in Duvet. -->
				<DropdownMenu.Item
					class="rounded-row flex w-full cursor-pointer items-center gap-3 p-2 text-left transition-colors data-disabled:cursor-default data-disabled:opacity-50 motion-reduce:transition-none {chosen
						? 'bg-duvet-bg shadow-duvet-press'
						: 'data-highlighted:bg-duvet-bg/60'}"
					disabled={saving}
					onSelect={() => choose(choice.status)}
				>
					<span
						class="flex size-9 shrink-0 items-center justify-center rounded-xl {chosen
							? 'bg-duvet-card shadow-duvet-raised'
							: 'bg-duvet-bg shadow-duvet-press'}"
					>
						<StatusDot status={userStatusToString(choice.status)} class="size-3" />
					</span>
					<span class="flex min-w-0 flex-1 flex-col leading-tight">
						<span class="text-sm font-bold">{choice.label}</span>
						{#if choice.description}
							<span class="text-duvet-ink2 mt-0.5 text-xs">{choice.description}</span>
						{/if}
					</span>
					{#if chosen}
						<Check class="text-duvet-accent-text size-4 shrink-0" />
					{/if}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
