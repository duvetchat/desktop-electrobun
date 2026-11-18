<script lang="ts" generics="Value extends string">
	import type { Component } from "svelte";
	import { RadioGroup } from "bits-ui";
	import { segmentIndex } from "./recipes";

	// A segmented control: one of a few options, picked at once, its thumb sliding to the pick on the spring. It is a
	// radio group: the arrows move the pick, Tab passes it by.
	let {
		options,
		value = $bindable(),
		onValueChange = undefined,
		label,
		size = "md",
		disabled = false,
		class: className = "",
	}: {
		options: readonly {
			value: Value;
			label: string;
			/** The option's tooltip, where its label alone doesn't say what it picks. */
			title?: string;
			icon?: Component<{ size?: number | string }>;
		}[];
		value: Value;
		onValueChange?: (value: Value) => void;
		/** What the options choose between, for a screen reader. */
		label: string;
		size?: "md" | "sm";
		disabled?: boolean;
		class?: string;
	} = $props();

	const index = $derived(
		segmentIndex(
			options.map((option) => option.value),
			value,
		),
	);
</script>

<RadioGroup.Root
	bind:value={() => value, (picked) => (value = picked as Value)}
	onValueChange={(picked) => onValueChange?.(picked as Value)}
	{disabled}
	orientation="horizontal"
	aria-label={label}
	style="--n: {options.length}; --i: {index};"
	class="bg-duvet-seg-track relative grid shrink-0 grid-cols-[repeat(var(--n),minmax(0,1fr))] rounded-[11px] p-[3px] data-disabled:opacity-50 {className}"
>
	<span
		class="bg-duvet-seg-thumb shadow-duvet-control ease-spring absolute top-[3px] bottom-[3px] left-[3px] w-[calc((100%-6px)/var(--n))] translate-x-[calc(var(--i)*100%)] rounded-lg transition-transform duration-[250ms] motion-reduce:transition-none"
		aria-hidden="true"
	></span>
	{#each options as option (option.value)}
		<RadioGroup.Item
			value={option.value}
			title={option.title}
			class="text-duvet-ink2 hover:text-duvet-ink data-[state=checked]:text-duvet-ink relative z-1 flex items-center justify-center gap-[5px] leading-none font-medium whitespace-nowrap {size ===
			'sm'
				? 'h-6 px-2.5 text-xs'
				: 'h-7 px-3 text-[12.5px]'}"
		>
			{#if option.icon}<option.icon size={14} />{/if}
			{option.label}
		</RadioGroup.Item>
	{/each}
</RadioGroup.Root>
