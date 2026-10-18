<script lang="ts">
	import { Hash as HashIcon, Volume2 as SpeakerSimpleHighIcon } from "@lucide/svelte";
	import { ContextMenu } from "bits-ui";
	import type { Tab } from "$lib/types";
	import { gatewaySpaces } from "$lib/stores.svelte";

	let {
		tabs,
		activeTabId,
		leafId,
		onSelect,
		onClose,
		onReorder,
		onChannelDrop,
	}: {
		tabs: Tab[];
		activeTabId: string | null;
		leafId: string;
		onSelect: (channelId: string) => void;
		onClose: (channelIds: string[]) => void;
		onReorder: (newOrder: Tab[]) => void;
		onChannelDrop: (tab: Tab) => void;
	} = $props();

	let barEl: HTMLElement;
	let tabEls = $state<(HTMLElement | null)[]>([]);
	let dragSrcIndex = $state<number | null>(null);
	let dropIndex = $state<number | null>(null);
	let sidebarDragOver = $state(false);

	function computeDropIndex(clientX: number): number {
		for (let i = 0; i < tabEls.length; i++) {
			const el = tabEls[i];
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			if (clientX < rect.left + rect.width / 2) return i;
		}
		return tabEls.length;
	}

	function handleTabDragStart(e: DragEvent, origIndex: number) {
		dragSrcIndex = origIndex;
		e.dataTransfer!.effectAllowed = "move";
		const tab = tabs[origIndex];
		e.dataTransfer!.setData(
			"text/plain",
			JSON.stringify({
				type: "tab",
				index: origIndex,
				sourceLeafId: leafId,
				channelId: tab.channelId,
				channelName: tab.channelName,
				channelType: tab.channelType,
				spaceId: tab.spaceId,
			}),
		);
	}

	function handleBarDragOver(e: DragEvent) {
		e.preventDefault();
		if (dragSrcIndex !== null) {
			e.dataTransfer!.dropEffect = "move";
		} else {
			e.dataTransfer!.dropEffect = "copy";
			sidebarDragOver = true;
		}
		dropIndex = computeDropIndex(e.clientX);
	}

	function handleBarDragLeave(e: DragEvent) {
		const bar = e.currentTarget as HTMLElement;
		if (!bar.contains(e.relatedTarget as Node)) {
			dropIndex = null;
			sidebarDragOver = false;
		}
	}

	function handleBarDrop(e: DragEvent) {
		e.preventDefault();
		sidebarDragOver = false;
		const raw = e.dataTransfer?.getData("text/plain") ?? "";
		let data: {
			type: string;
			index?: number;
			channelId?: string;
			channelName?: string;
			channelType?: string;
			spaceId?: string;
		};
		try {
			data = JSON.parse(raw);
		} catch {
			dragSrcIndex = null;
			dropIndex = null;
			return;
		}

		if (data.type === "channel") {
			onChannelDrop({
				channelId: data.channelId!,
				channelName: data.channelName!,
				channelType: data.channelType!,
				spaceId: data.spaceId!,
			});
		} else if (data.type === "tab" && dragSrcIndex === null && data.channelId) {
			// Tab dragged from a different pane's tab bar — open it here
			onChannelDrop({
				channelId: data.channelId,
				channelName: data.channelName ?? data.channelId,
				channelType: data.channelType ?? "text",
				spaceId: data.spaceId ?? "",
			});
		} else if (data.type === "tab" && dragSrcIndex !== null && dropIndex !== null) {
			const arr = [...tabs];
			const [moved] = arr.splice(dragSrcIndex, 1);
			let insertAt = dropIndex > dragSrcIndex ? dropIndex - 1 : dropIndex;
			insertAt = Math.max(0, Math.min(insertAt, arr.length));
			arr.splice(insertAt, 0, moved);
			onReorder(arr);
		}

		dragSrcIndex = null;
		dropIndex = null;
	}

	function handleDragEnd() {
		dragSrcIndex = null;
		dropIndex = null;
		sidebarDragOver = false;
	}

	// The tabs stay on one row, which scrolls sideways once they don't fit: a mouse's wheel scrolls it
	// too, and the active tab is kept in view.
	function handleBarWheel(e: WheelEvent) {
		if (e.deltaY && !e.deltaX) barEl.scrollLeft += e.deltaY;
	}

	$effect(() => {
		void [activeTabId, tabs.length];
		barEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
	});

	const menuItemClass =
		"w-full px-3 py-2 text-left text-sm text-zinc-100 transition-colors hover:bg-zinc-700 data-disabled:cursor-default data-disabled:opacity-40 data-disabled:hover:bg-transparent";

	const showServerNames = true;

	function getSpaceName(spaceId: string): string {
		return $gatewaySpaces.find((s) => s.id === spaceId)?.name ?? "";
	}

	const previewTabs = $derived(
		(() => {
			const all = tabs.map((t, i) => ({ ...t, origIndex: i }));
			if (dragSrcIndex === null || dropIndex === null) return all;
			const arr = [...all];
			const [moved] = arr.splice(dragSrcIndex, 1);
			let insertAt = dropIndex > dragSrcIndex ? dropIndex - 1 : dropIndex;
			insertAt = Math.max(0, Math.min(insertAt, arr.length));
			arr.splice(insertAt, 0, moved);
			return arr;
		})(),
	);
</script>

<!-- A slim scrollbar: the scrollbar-width and scrollbar-color that app.css gives every element go back to
	auto here, since Chromium ignores the ::-webkit-scrollbar styles otherwise. -->
<div
	bind:this={barEl}
	class="flex h-10 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-zinc-800 bg-zinc-900 select-none [scrollbar-color:auto] [scrollbar-width:auto] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:border-0 {sidebarDragOver
		? 'ring-1 ring-stone-500/60 ring-inset'
		: ''}"
	role="tablist"
	tabindex="-1"
	onwheel={handleBarWheel}
	ondragover={handleBarDragOver}
	ondragleave={handleBarDragLeave}
	ondrop={handleBarDrop}
>
	{#each previewTabs as tab, i (tab.channelId)}
		<!-- A right click opens the tab's own menu, not the webview's. -->
		<ContextMenu.Root>
			<ContextMenu.Trigger>
				{#snippet child({ props })}
					<div
						{...props}
						class="group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-800 px-3 text-sm transition-all duration-100
						{tab.channelId === activeTabId
							? 'border-t-2 border-t-stone-300 bg-zinc-800 text-white'
							: 'border-t-2 border-t-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}
						{dragSrcIndex === tab.origIndex ? 'opacity-40' : 'opacity-100'}"
						role="tab"
						tabindex="0"
						aria-selected={tab.channelId === activeTabId}
						draggable="true"
						ondragstart={(e) => handleTabDragStart(e, tab.origIndex)}
						ondragend={handleDragEnd}
						onclick={() => onSelect(tab.channelId)}
						onkeydown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(tab.channelId)}
						bind:this={tabEls[i]}
					>
						<!-- Drop insertion indicator -->
						{#if dropIndex === i && dragSrcIndex !== null && dragSrcIndex !== tab.origIndex}
							<div class="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-stone-300"></div>
						{/if}

						{#if tab.channelType === "text"}
							<HashIcon class="size-3.5 shrink-0 opacity-70" />
						{:else}
							<SpeakerSimpleHighIcon class="size-3.5 shrink-0 opacity-70" />
						{/if}
						<span class="max-w-40 truncate text-xs font-medium">
							{#if showServerNames}
								<span class="font-normal text-zinc-500">{getSpaceName(tab.spaceId)}/</span>{tab.channelName}
							{:else}
								{tab.channelName}
							{/if}
						</span>
						<button
							type="button"
							class="ml-0.5 flex items-center justify-center rounded p-0.5 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-60 hover:bg-zinc-700 hover:opacity-100"
							onclick={(e) => {
								e.stopPropagation();
								onClose([tab.channelId]);
							}}
							aria-label="Close tab"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="10"
								height="10"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
							>
						</button>
					</div>
				{/snippet}
			</ContextMenu.Trigger>
			<ContextMenu.Portal>
				<ContextMenu.Content class="z-200 min-w-44 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl">
					<ContextMenu.Item class={menuItemClass} onSelect={() => onClose([tab.channelId])}>Close</ContextMenu.Item>
					<ContextMenu.Item
						class={menuItemClass}
						disabled={tabs.length < 2}
						onSelect={() => onClose(tabs.filter((t) => t.channelId !== tab.channelId).map((t) => t.channelId))}
					>
						Close Others
					</ContextMenu.Item>
					<ContextMenu.Item
						class={menuItemClass}
						disabled={tab.origIndex === 0}
						onSelect={() => onClose(tabs.slice(0, tab.origIndex).map((t) => t.channelId))}
					>
						Close to the Left
					</ContextMenu.Item>
					<ContextMenu.Item
						class={menuItemClass}
						disabled={tab.origIndex === tabs.length - 1}
						onSelect={() => onClose(tabs.slice(tab.origIndex + 1).map((t) => t.channelId))}
					>
						Close to the Right
					</ContextMenu.Item>
					<div class="my-1 border-t border-zinc-700"></div>
					<ContextMenu.Item class={menuItemClass} onSelect={() => onClose(tabs.map((t) => t.channelId))}>
						Close All
					</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Portal>
		</ContextMenu.Root>
	{/each}

	<!-- After-last-tab drop indicator -->
	{#if dropIndex === previewTabs.length && dragSrcIndex !== null}
		<div class="flex items-center px-0.5">
			<div class="h-5/6 w-0.5 rounded-full bg-stone-300"></div>
		</div>
	{/if}

	<!-- Spacer: also acts as drop zone when dragging from sidebar -->
	<div class="min-w-4 flex-1 {sidebarDragOver ? 'bg-stone-500/10' : ''}">
		{#if sidebarDragOver}
			<div class="flex h-full items-center gap-1.5 px-3 text-xs text-stone-300">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg
				>
				Open channel
			</div>
		{/if}
	</div>
</div>
