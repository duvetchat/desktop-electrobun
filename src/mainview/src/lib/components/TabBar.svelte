<script lang="ts">
import { Hash as HashIcon, Volume2 as SpeakerSimpleHighIcon } from "lucide-svelte";
import type { Tab } from "$lib/types";

export let tabs: Tab[];
export let activeTabId: string | null;
export let onSelect: (channelId: string) => void;
export let onClose: (channelId: string) => void;
export let onReorder: (newOrder: Tab[]) => void;
export let onChannelDrop: (tab: Tab) => void;

let tabEls: (HTMLElement | null)[] = [];
let dragSrcIndex: number | null = null;
let dropIndex: number | null = null;
let sidebarDragOver = false;

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
	e.dataTransfer!.effectAllowed = "copy";
	const tab = tabs[origIndex];
	e.dataTransfer!.setData(
		"text/plain",
		JSON.stringify({
			type: "tab",
			index: origIndex,
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
		e.dataTransfer!.dropEffect = "copy";
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
	} else if (
		data.type === "tab" &&
		dragSrcIndex !== null &&
		dropIndex !== null
	) {
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

$: previewTabs = (() => {
	const all = tabs.map((t, i) => ({ ...t, origIndex: i }));
	if (dragSrcIndex === null || dropIndex === null) return all;
	const arr = [...all];
	const [moved] = arr.splice(dragSrcIndex, 1);
	let insertAt = dropIndex > dragSrcIndex ? dropIndex - 1 : dropIndex;
	insertAt = Math.max(0, Math.min(insertAt, arr.length));
	arr.splice(insertAt, 0, moved);
	return arr;
})();
</script>

<div
    class="flex items-stretch bg-zinc-900 border-b border-zinc-800 overflow-x-auto shrink-0 h-10 select-none {sidebarDragOver
        ? 'ring-1 ring-inset ring-stone-500/60'
        : ''}"
    role="tablist"
    tabindex="-1"
    on:dragover={handleBarDragOver}
    on:dragleave={handleBarDragLeave}
    on:drop={handleBarDrop}
>
    {#each previewTabs as tab, i (tab.channelId)}
        <div
            class="group relative flex items-center shrink-0 h-full px-3 gap-1.5 text-sm cursor-pointer border-r border-zinc-800 transition-all duration-100
			{tab.channelId === activeTabId
				? 'bg-zinc-800 text-white border-t-2 border-t-stone-300'
				: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border-t-2 border-t-transparent'}
			{dragSrcIndex === tab.origIndex ? 'opacity-40' : 'opacity-100'}"
            role="tab"
            tabindex="0"
            aria-selected={tab.channelId === activeTabId}
            draggable="true"
            on:dragstart={(e) => handleTabDragStart(e, tab.origIndex)}
            on:dragend={handleDragEnd}
            on:click={() => onSelect(tab.channelId)}
            on:keydown={(e) =>
                (e.key === "Enter" || e.key === " ") && onSelect(tab.channelId)}
            bind:this={tabEls[i]}
        >
            <!-- Drop insertion indicator -->
            {#if dropIndex === i && dragSrcIndex !== null && dragSrcIndex !== tab.origIndex}
                <div
                    class="absolute left-0 top-1 bottom-1 w-0.5 bg-stone-300 rounded-full"
                ></div>
            {/if}

            {#if tab.channelType === "text"}
                <HashIcon class="size-3.5 shrink-0 opacity-70" />
            {:else}
                <SpeakerSimpleHighIcon
                    class="size-3.5 shrink-0 opacity-70"
                />
            {/if}
            <span class="max-w-28 truncate text-xs font-medium"
                >{tab.channelName}</span
            >
            <button
                type="button"
                class="flex items-center justify-center opacity-0 group-hover:opacity-60 hover:opacity-100 ml-0.5 rounded p-0.5 hover:bg-zinc-700 transition-opacity text-zinc-300"
                on:click|stopPropagation={() => onClose(tab.channelId)}
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
                    stroke-linejoin="round"
                    ><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
                >
            </button>
        </div>
    {/each}

    <!-- After-last-tab drop indicator -->
    {#if dropIndex === previewTabs.length && dragSrcIndex !== null}
        <div class="flex items-center px-0.5 h-full">
            <div class="w-0.5 h-5/6 bg-stone-300 rounded-full"></div>
        </div>
    {/if}

    <!-- Spacer: also acts as drop zone when dragging from sidebar -->
    <div class="flex-1 min-w-4 h-full {sidebarDragOver ? 'bg-stone-500/10' : ''}">
        {#if sidebarDragOver}
            <div
                class="h-full flex items-center px-3 text-xs text-stone-300 gap-1.5"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg
                >
                Abrir canal
            </div>
        {/if}
    </div>
</div>
