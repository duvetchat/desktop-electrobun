<script lang="ts">
	import type { Component, Snippet } from "svelte";

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

<div
	class="flex min-h-[50px] gap-x-3 gap-y-2 px-3.5 py-2 {stacked
		? 'flex-col justify-center'
		: 'items-center'} {className}"
>
	<div class="flex min-w-0 flex-1 items-center gap-3">
		{#if icon}
			{@const Icon = icon}
			<span
				class="bg-duvet-secondary-fill text-duvet-accent-text grid size-[30px] shrink-0 place-items-center rounded-[9px]"
				aria-hidden="true"
			>
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
