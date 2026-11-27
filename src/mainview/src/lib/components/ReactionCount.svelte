<script lang="ts">
	import { prefersReducedMotion } from "svelte/motion";
	import { fly } from "svelte/transition";
	import { formatNumber } from "$lib/i18n/format";
	import { countRoll } from "$lib/reactions";

	let { count }: { count: number } = $props();

	// Each change of the count rolls a new number in while the one shown rolls out (countRoll), and the box eases its
	// width from the old number's to the new one's (9 → 10). The numbers are keyed by the roll, not by the count: a
	// count going back to a number that is still rolling out rolls in a new one, instead of bringing back the one
	// leaving, which is out of the flow by then. The transitions are local: a badge's first render doesn't play them.
	let box: HTMLSpanElement;
	let previous: number | undefined;
	let roll = $state.raw({ enter: 0, leave: 0 });
	let width = 0;

	// Before the DOM updates, while the box still has the old number's width.
	$effect.pre(() => {
		if (previous !== undefined && count !== previous) {
			width = box.getBoundingClientRect().width;
			roll = countRoll(previous, count);
		}
		previous = count;
	});

	// Whoever prefers reduced motion sees the number change at once.
	const duration = () => (prefersReducedMotion.current ? 0 : 200);

	function leave(node: HTMLElement) {
		// Out of the flow, so that the box's width is the new number's.
		node.classList.add("absolute");
		return fly(node, { y: `${roll.leave}%`, duration: duration() });
	}

	function enter(node: HTMLElement) {
		const ms = duration();
		const to = node.getBoundingClientRect().width;
		if (ms && to !== width) {
			box.animate([{ width: `${width}px` }, { width: `${to}px` }], { duration: ms, easing: "ease-out" });
		}
		return fly(node, { y: `${roll.enter}%`, duration: ms });
	}
</script>

<span bind:this={box} class="relative grid overflow-hidden tabular-nums">
	{#key roll}
		<span class="w-max" in:enter out:leave>{formatNumber(count)}</span>
	{/key}
</span>
