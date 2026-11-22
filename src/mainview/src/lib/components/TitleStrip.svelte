<script lang="ts">
	import { onMount, type ComponentProps } from "svelte";
	import {
		Download as DownloadIcon,
		PanelLeft as PanelLeftIcon,
		Plus as PlusIcon,
		RotateCw as RotateCwIcon,
	} from "@lucide/svelte";
	import { restarting, takeUpdate, updateOffer, watchUpdates } from "$lib/app-update";
	import { currentShell } from "$lib/platform";
	import DragRegion from "$lib/components/DragRegion.svelte";
	import TabBar from "$lib/components/TabBar.svelte";
	import WindowControls from "$lib/components/WindowControls.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";

	// The main column's half of the window's title line (#357, S-01, S-02): the tabs, the New tab button, then empty
	// room that drags the window, and at the end Windows' or Linux's own controls. The sidebar's header is the other
	// half. While the sidebar isn't docked the strip starts at the window's edge instead: it then leads with the corner
	// macOS's traffic lights keep, and the button that shows the sidebar again.
	let {
		lead = false,
		onShowSidebar = null,
		sidebarKeys = undefined,
		tabBar = null,
		onNewTab,
		newTabKeys = undefined,
		class: className = "",
	}: {
		/** The sidebar isn't docked: the strip is the whole window's title line. */
		lead?: boolean;
		/** Docks the sidebar again; null where the user chose a sidebar that hides by itself. */
		onShowSidebar?: (() => void) | null;
		sidebarKeys?: string;
		/** The focused pane's tabs; null when the open chats are listed in the sidebar instead. */
		tabBar?: ComponentProps<typeof TabBar> | null;
		onNewTab: () => void;
		newTabKeys?: string;
		class?: string;
	} = $props();

	const shell = currentShell();
	// Windows' buttons touch the window's edge.
	const flushEnd = shell.chrome === "windows";

	// A newer version Bun downloaded and verified (#456, lib/app-update.ts): the strip offers to restart into it, or to
	// download it where Bun can't apply it.
	onMount(() => void watchUpdates());
</script>

<div
	class="bg-duvet-bg text-duvet-ink relative z-[6] flex h-[52px] min-w-0 items-center gap-1.5 {lead
		? ''
		: 'pl-2.5'} {flushEnd ? '' : 'pr-2.5'} {className}"
	data-title-line
>
	{#if lead}
		<WindowControls side="start" />
		{#if shell.chrome !== "mac"}<span class="w-1 shrink-0"></span>{/if}
		{#if onShowSidebar}
			<Tooltip text="Show sidebar" keys={sidebarKeys}>
				{#snippet trigger(props)}
					<IconButton {...props} label="Show sidebar" class="titlebar-actions" onclick={onShowSidebar}>
						<PanelLeftIcon size={16} />
					</IconButton>
				{/snippet}
			</Tooltip>
		{/if}
	{/if}
	{#if tabBar}
		<TabBar {...tabBar} />
	{/if}
	<Tooltip text="New tab" keys={newTabKeys}>
		{#snippet trigger(props)}
			<IconButton {...props} label="New tab" class="titlebar-actions" onclick={onNewTab}>
				<PlusIcon size={15} />
			</IconButton>
		{/snippet}
	</Tooltip>
	<DragRegion class="h-full flex-1" />
	{#if $updateOffer}
		<button
			type="button"
			class="titlebar-actions bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium disabled:opacity-60"
			title={$updateOffer.how === "download"
				? `Duvet ${$updateOffer.version} is out: get it from duvet.chat`
				: `Duvet ${$updateOffer.version} is ready`}
			disabled={$restarting}
			onclick={() => void takeUpdate()}
		>
			{#if $updateOffer.how === "download"}
				<DownloadIcon size={13} aria-hidden="true" />
				Download update
			{:else}
				<RotateCwIcon size={13} aria-hidden="true" />
				{$restarting ? "Restarting…" : "Restart to update"}
			{/if}
		</button>
	{/if}
	<WindowControls side="end" />
</div>
