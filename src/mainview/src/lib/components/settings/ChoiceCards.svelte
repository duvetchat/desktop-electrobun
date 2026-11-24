<script lang="ts" generics="Value extends string">
	import type { Snippet } from "svelte";
	import { RadioGroup } from "bits-ui";
	import { TAG } from "./recipes";

	// A choice between a few looks, each drawn as a small picture (#357, DESIGN-MAP.md S-51): the theme, bubbles or
	// flat rows. It is a radio group: the arrows move the pick and the focus, Tab passes it by.
	let {
		options,
		value,
		onValueChange,
		label,
		preview,
	}: {
		options: readonly { value: Value; label: string; tag?: string }[];
		value: Value;
		onValueChange: (value: Value) => void;
		/** What the cards choose between, for a screen reader. */
		label: string;
		/** A card's picture. */
		preview: Snippet<[Value]>;
	} = $props();
</script>

<RadioGroup.Root
	{value}
	onValueChange={(picked) => onValueChange(picked as Value)}
	orientation="horizontal"
	aria-label={label}
	style="--n: {options.length};"
	class="grid grid-cols-[repeat(var(--n),minmax(0,1fr))] gap-3.5 p-4"
>
	{#each options as option (option.value)}
		<RadioGroup.Item value={option.value} class="group flex flex-col items-stretch gap-2 text-left">
			<span
				class="ring-duvet-line group-data-[state=checked]:ring-duvet-accent block aspect-[16/10] overflow-hidden rounded-xl ring-1 transition-shadow duration-[120ms] group-data-[state=checked]:ring-[3.5px] motion-reduce:transition-none"
				aria-hidden="true"
			>
				{@render preview(option.value)}
			</span>
			<span class="text-duvet-ink flex items-center gap-1.5 px-0.5 text-[14px] font-medium">
				{option.label}
				{#if option.tag}<span class="{TAG} bg-duvet-secondary-fill text-duvet-ink2">{option.tag}</span>{/if}
			</span>
		</RadioGroup.Item>
	{/each}
</RadioGroup.Root>
