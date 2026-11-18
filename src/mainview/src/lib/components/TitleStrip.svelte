<script lang="ts">
	import type { ComponentProps } from "svelte";
	import { PanelLeft as PanelLeftIcon, Plus as PlusIcon } from "@lucide/svelte";
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
	<WindowControls side="end" />
</div>
