<script lang="ts">
	import { ContextMenu } from "bits-ui";
	import type { Tab } from "$lib/types";
	import { tabDragData, tabFromDragData, tabNews, tabTitle } from "$lib/pane";
	import {
		conversations,
		currentUser,
		gatewaySpaces,
		mentionCounts,
		typingNow,
		unreadChannels,
		unreadConversations,
	} from "$lib/stores.svelte";
	import { typingSentence } from "$lib/typing";
	import TabIcon from "$lib/components/TabIcon.svelte";

	let {
		tabs,
		activeTabId,
		leafId,
		onSelect,
		onClose,
		onReorder,
		onChannelDrop,
		description = null,
	}: {
		tabs: Tab[];
		activeTabId: string | null;
		leafId: string;
		onSelect: (channelId: string) => void;
		onClose: (channelIds: string[]) => void;
		onReorder: (newOrder: Tab[]) => void;
		onChannelDrop: (tab: Tab) => void;
		/** What the active room is for: it takes what the tabs leave of the row, and nothing when they fill it. */
		description?: string | null;
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
		e.dataTransfer!.setData(
			"text/plain",
			tabDragData(tabs[origIndex], { type: "tab", index: origIndex, sourceLeafId: leafId }),
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
			kind?: unknown;
		};
		try {
			data = JSON.parse(raw);
		} catch {
			dragSrcIndex = null;
			dropIndex = null;
			return;
		}

		const dropped = tabFromDragData(data);
		if (data.type === "channel" && dropped) {
			onChannelDrop(dropped);
		} else if (data.type === "tab" && dragSrcIndex === null && dropped) {
			// Tab dragged from a different pane's tab bar — open it here
			onChannelDrop(dropped);
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

	// The active tab names its space after the room; the others only in their tooltip, to keep the row short.
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

<!-- A slim scrollbar. -->
<div
	bind:this={barEl}
	class="bg-duvet-bg flex h-12 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden px-2 select-none [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:border-0 {sidebarDragOver
		? 'ring-duvet-accent/60 ring-1 ring-inset'
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
					{@const isActive = tab.channelId === activeTabId}
					{@const news = tabNews(tab, $unreadChannels, $unreadConversations, $mentionCounts)}
					{@const mentions = news.mentions}
					{@const unread = !isActive && news.unread}
					{@const title = tabTitle(tab, $conversations, $currentUser?.id)}
					{@const spaceName = getSpaceName(tab.spaceId)}
					{@const typing = typingSentence($typingNow[tab.channelId])}
					<div
						{...props}
						class="group rounded-row focus-visible:outline-duvet-accent relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 px-3 text-sm transition-colors duration-100 focus-visible:outline-2
						{isActive
							? 'bg-duvet-card text-duvet-ink shadow-duvet-raised font-semibold'
							: unread
								? 'text-duvet-ink hover:bg-duvet-card/60 font-bold'
								: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}
						{dragSrcIndex === tab.origIndex ? 'opacity-40' : 'opacity-100'}"
						title={[title, spaceName, typing].filter(Boolean).join(" · ")}
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
							<div class="bg-duvet-accent absolute top-1 bottom-1 -left-0.5 w-0.5 rounded-full"></div>
						{/if}

						<TabIcon {tab} size={14} />
						{#if typing}<span class="sr-only">{typing}</span>{/if}
						<span class="max-w-48 truncate">
							{title}
							{#if showServerNames && isActive && spaceName}
								<span class="text-duvet-ink2 ml-1 text-xs font-normal">{spaceName}</span>
							{/if}
						</span>
						{#if mentions > 0 && !isActive}
							<span
								class="bg-duvet-accent text-duvet-on-accent flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold"
								aria-label="{mentions} mentions">{mentions}</span
							>
						{/if}
						<button
							type="button"
							class="text-duvet-ink2 hover:bg-duvet-chosen hover:text-duvet-chosen-ink -mr-1 flex items-center justify-center rounded p-0.5 opacity-0 transition-opacity group-focus-within:opacity-60 group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100"
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
			<div class="bg-duvet-accent h-5/6 w-0.5 rounded-full"></div>
		</div>
	{/if}

	<!-- Spacer: also acts as drop zone when dragging from sidebar -->
	<div class="h-full min-w-4 flex-1 {sidebarDragOver ? 'bg-duvet-accent-tint' : ''}">
		{#if sidebarDragOver}
			<div class="text-duvet-accent-text flex h-full items-center gap-1.5 px-3 text-xs">
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
		{:else if description}
			<div class="flex h-full items-center overflow-hidden px-2">
				<span class="text-duvet-ink2 truncate text-xs" title={description}>{description}</span>
			</div>
		{/if}
	</div>
</div>
