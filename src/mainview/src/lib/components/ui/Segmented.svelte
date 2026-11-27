<script lang="ts" generics="Value extends string">
	import type { Component } from "svelte";
	import { RadioGroup } from "bits-ui";
	import { segmentIndex, segmentNaming, segmentsFit } from "./recipes";

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
			icon?: Component<{ size?: number | string; class?: string }>;
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

	// An option's type, the same on the option and on its measure, and its padding.
	const type = $derived(size === "sm" ? "text-xs" : "text-[12.5px]");
	const padding = $derived(size === "sm" ? "px-2.5" : "px-3");

	// The columns stay equal while every label fits its own (#562): a longer language's word in the sidebar at its
	// narrowest would spill past its column. When one doesn't fit, every option shows its icon only, its label its name
	// and tooltip; without icons to fall back on, a label that doesn't fit is cut with an ellipsis. What each option
	// needs is measured on a hidden copy of it that always has its label, so showing the icons alone never changes the
	// answer; the track's width, and so a column's, is watched as the sidebar or the window is resized.
	let thumb = $state<HTMLElement | null>(null);
	let measures = $state<HTMLElement | null>(null);
	let fits = $state(true);
	const allIcons = $derived(options.length > 0 && options.every((option) => option.icon));
	const iconsOnly = $derived(!fits && allIcons);

	$effect(() => {
		// Again for another set of options: a new option brings a new measure to watch.
		if (!thumb || !measures || options.length === 0) return;
		const column = thumb;
		const copies = measures;
		const track = column.parentElement;
		const measure = () => {
			fits = segmentsFit(
				[...copies.children].map((copy) => copy.getBoundingClientRect().width),
				column.getBoundingClientRect().width,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (track) observer.observe(track);
		for (const copy of copies.children) observer.observe(copy);
		return () => observer.disconnect();
	});
</script>

<RadioGroup.Root
	bind:value={() => value, (picked) => (value = picked as Value)}
	onValueChange={(picked) => onValueChange?.(picked as Value)}
	{disabled}
	orientation="horizontal"
	aria-label={label}
	style="--n: {options.length}; --i: {index};"
	class="bg-duvet-seg-track rounded-control relative grid shrink-0 grid-cols-[repeat(var(--n),minmax(0,1fr))] p-[3px] data-disabled:opacity-50 {className}"
>
	<span
		bind:this={thumb}
		class="bg-duvet-seg-thumb shadow-duvet-control ease-spring absolute top-[3px] bottom-[3px] left-[3px] w-[calc((100%-6px)/var(--n))] translate-x-[calc(var(--i)*100%)] rounded-lg transition-transform duration-[250ms] motion-reduce:transition-none"
		aria-hidden="true"
	></span>
	{#each options as option (option.value)}
		{@const naming = segmentNaming(option, iconsOnly)}
		<RadioGroup.Item
			value={option.value}
			title={naming.title}
			aria-label={naming.ariaLabel}
			class="text-duvet-ink2 hover:text-duvet-ink data-[state=checked]:text-duvet-ink relative z-1 flex min-w-0 items-center justify-center gap-[5px] leading-none font-medium whitespace-nowrap {size ===
			'sm'
				? 'h-6'
				: 'h-7'} {padding} {type}"
		>
			<!-- The icon never shrinks: in a column narrower than the row, centred, the row spills into the side padding
			     instead (#426). -->
			{#if option.icon}<option.icon size={14} class="shrink-0" />{/if}
			<!-- With icons, whole, spilling into the padding as the icon would (the icons alone take over before it spills
			     past its column); without, cut where it can't fit, its line tall enough that the cut keeps its descenders. -->
			{#if !iconsOnly}<span class={allIcons ? "shrink-0" : "min-w-0 truncate leading-normal"}>{option.label}</span>{/if}
		</RadioGroup.Item>
	{/each}
	<!-- What each option takes with its label on one line: its icon's room and its words, with 2 px either side, as the
	     padding gives way before them (#426): English's Spaces fits the sidebar at its narrowest so. Out of sight, of
	     the page's flow and of a screen reader's reach; a box of no size, so it never widens what scrolls around it. -->
	<span bind:this={measures} class="invisible absolute top-0 left-0 flex size-0 overflow-hidden" aria-hidden="true">
		{#each options as option (option.value)}
			<span class="flex w-max shrink-0 items-center gap-[5px] leading-none font-medium whitespace-nowrap {type} px-0.5">
				{#if option.icon}<span class="size-[14px] shrink-0"></span>{/if}
				{option.label}
			</span>
		{/each}
	</span>
</RadioGroup.Root>
