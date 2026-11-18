<script lang="ts">
	// A slider (#357, DESIGN-MAP.md S-47): a 4 px track, the accent up to its value, under an 18 px white thumb. It is
	// the browser's own range input, so the arrow keys, Home and End move it.
	let {
		value,
		min = 0,
		max = 100,
		step = 1,
		label,
		oninput,
		class: className = "",
	}: {
		value: number;
		min?: number;
		max?: number;
		step?: number;
		/** What it sets, for a screen reader. */
		label: string;
		oninput: (value: number) => void;
		class?: string;
	} = $props();

	const fill = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);
	const THUMB =
		"[&::-webkit-slider-thumb]:bg-fixed-white [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(0,0,0,0.28),0_0_0_0.5px_rgba(0,0,0,0.12)] " +
		"[&::-moz-range-thumb]:bg-fixed-white [&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-[0_1px_3px_rgba(0,0,0,0.28),0_0_0_0.5px_rgba(0,0,0,0.12)]";
</script>

<input
	type="range"
	{min}
	{max}
	{step}
	{value}
	aria-label={label}
	oninput={(event) => oninput(Number(event.currentTarget.value))}
	style="--fill: {fill}%;"
	class="h-1 w-[150px] shrink-0 cursor-pointer appearance-none rounded-sm bg-[linear-gradient(to_right,var(--duvet-accent)_var(--fill),var(--duvet-toggle-off)_var(--fill))] {THUMB} {className}"
/>
