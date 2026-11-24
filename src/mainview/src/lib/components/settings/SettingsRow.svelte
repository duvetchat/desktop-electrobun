<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import { rowClass, ROW_TILE } from "./recipes";

	// A row of a settings group (#357, DESIGN-MAP.md S-47): an optional icon tile, a label with a line under it, and
	// its control at the right. `stacked` puts the control under the words, for one too wide to sit beside them.
	let {
		label,
		line = undefined,
		icon = undefined,
		stacked = false,
		labelFor = undefined,
		class: className = "",
		children = undefined,
	}: {
		label: string;
		line?: string;
		icon?: Component<{ size?: number | string }>;
		stacked?: boolean;
		/** The ID of the control the label names. */
		labelFor?: string;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<div class="{rowClass(stacked)} {className}">
	<div class="flex min-w-0 flex-1 items-center gap-3">
		{#if icon}
			{@const Icon = icon}
			<span class={ROW_TILE} aria-hidden="true">
				<Icon size={16} />
			</span>
		{/if}
		<div class="min-w-0 flex-1">
			{#if labelFor}
				<label for={labelFor} class="text-duvet-ink block text-[13.5px] leading-[1.3] font-medium">{label}</label>
			{:else}
				<p class="text-duvet-ink text-[13.5px] leading-[1.3] font-medium">
					{label}
				</p>
			{/if}
			{#if line}<p class="text-duvet-ink2 mt-0.5 text-xs leading-[1.4]">{line}</p>{/if}
		</div>
	</div>
	{#if children}
		<div class="flex shrink-0 items-center gap-2 {stacked ? 'self-stretch' : ''}">{@render children()}</div>
	{/if}
</div>
