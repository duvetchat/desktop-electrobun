<script lang="ts" generics="Value extends string">
	import { untrack, type Component } from "svelte";
	import { RadioGroup } from "bits-ui";
	import { marqueeRun, segmentIndex, segmentTitle } from "./recipes";

	// A segmented control: one of a few options, picked at once, its thumb sliding to the pick on the spring. It is a
	// radio group: the arrows move the pick, Tab passes it by.
	let {
		options,
		value = $bindable(),
		onValueChange = undefined,
		label,
		size = "md",
		align = "center",
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
		/** "start" pins each icon near its option's left edge and centres the words in the room left beside it. */
		align?: "center" | "start";
		disabled?: boolean;
		class?: string;
	} = $props();

	const index = $derived(
		segmentIndex(
			options.map((option) => option.value),
			value,
		),
	);

	// The columns stay equal, and every option keeps its icon and its words (#562). A label longer than its column has
	// room for, a longer language's in the sidebar at its narrowest, is clipped, fading at its edges, and scrolls to its
	// end and back while its option is pointed at or has the keyboard's focus (app.css's animate-marquee, which reduced
	// motion turns off). Its tooltip then gives it whole. How far it scrolls, and so for how long, is measured as the
	// column or the words change width.
	let clipped = $state<Partial<Record<Value, boolean>>>({});
	// A clipped label fades out at its edges rather than ending on a cut letter, and scrolls.
	const CLIPPED = "[mask-image:linear-gradient(to_right,transparent,#000_3px,#000_calc(100%-3px),transparent)]";
	const SCROLLS = "group-hover/segment:animate-marquee group-focus-visible/segment:animate-marquee";
	// The padding that gives way, with the 2 px that stay: 12 px a side, or 10 when small.
	const gutter = $derived(size === "sm" ? "w-2" : "w-2.5");
	// With the icon pinned left, the words take the column's spare room, centred in it, from their own width up, so
	// the spacers still give way first.
	const words = $derived(align === "start" ? "flex-auto text-center" : "");

	function marquee(key: Value) {
		return (box: HTMLElement) => {
			const words = box.firstElementChild;
			if (!(words instanceof HTMLElement)) return;
			const measure = () => {
				const run = marqueeRun(words.getBoundingClientRect().width, box.getBoundingClientRect().width);
				box.style.setProperty("--shift", `${-run.shift}px`);
				words.style.animationDuration = `${run.seconds}s`;
				if ((clipped[key] ?? false) !== run.shift > 0) clipped[key] = run.shift > 0;
			};
			untrack(measure);
			const observer = new ResizeObserver(measure);
			observer.observe(box);
			observer.observe(words);
			return () => observer.disconnect();
		};
	}
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
		class="bg-duvet-seg-thumb shadow-duvet-control ease-spring absolute top-[3px] bottom-[3px] left-[3px] w-[calc((100%-6px)/var(--n))] translate-x-[calc(var(--i)*100%)] rounded-lg transition-transform duration-[250ms] motion-reduce:transition-none"
		aria-hidden="true"
	></span>
	{#each options as option (option.value)}
		<RadioGroup.Item
			value={option.value}
			title={segmentTitle(option, clipped[option.value] ?? false)}
			class="group/segment text-duvet-ink2 hover:text-duvet-ink data-[state=checked]:text-duvet-ink relative z-1 flex min-w-0 items-center justify-center px-0.5 leading-none font-medium whitespace-nowrap {size ===
			'sm'
				? 'h-6 text-xs'
				: 'h-7 text-[12.5px]'}"
		>
			<!-- The option's padding, past the 2 px that stay: as wide as ever where there's room (a control as wide as
			     its words is no narrower), and the first to give way in a tight column, before the words. -->
			<span class="{align === 'start' ? 'w-1' : gutter} min-w-0 shrink-[1000]" aria-hidden="true"></span>
			<!-- The icon never shrinks (#426): the words give way to it. -->
			{#if option.icon}<option.icon size={14} class="mr-[5px] shrink-0" />{/if}
			<!-- The words' window, as wide as the column leaves them, its line tall enough to keep their descenders; the
			     words in it on one line, whole. -->
			<span
				{@attach marquee(option.value)}
				class="min-w-0 overflow-hidden leading-normal {words} {clipped[option.value] ? CLIPPED : ''}"
			>
				<span class="inline-block {clipped[option.value] ? SCROLLS : ''}">{option.label}</span>
			</span>
			<span class="{align === 'start' ? 'w-1' : gutter} min-w-0 shrink-[1000]" aria-hidden="true"></span>
		</RadioGroup.Item>
	{/each}
</RadioGroup.Root>
