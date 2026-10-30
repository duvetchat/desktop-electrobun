<script lang="ts">
	import { onMount } from "svelte";
	import { play } from "$lib/stickers/fun";
	import type { Icon, Palette, Player } from "$lib/stickers/fun";
	import { duvetPalette } from "$lib/stickers/duvet";

	let {
		icon,
		palette = duvetPalette,
		loop = true,
		enter,
		offset,
		label = "",
		class: className = "",
	}: {
		icon: Icon;
		palette?: Partial<Palette>;
		/** False plays once when it first shows, then rests on the icon's still frame until replay(). */
		loop?: boolean;
		/** Seconds after it first shows to pop in. */
		enter?: number;
		/** Frames ahead of the page clock, so stickers side by side don't move in step. */
		offset?: number;
		/** Its accessible name; empty leaves it to screen readers as decoration. */
		label?: string;
		class?: string;
	} = $props();

	let canvas: HTMLCanvasElement;
	let player: Player | null = null;

	/** Plays its motion again from the start: a reaction to something the user did. */
	export function replay() {
		player?.replay();
	}

	onMount(() => {
		player = play(canvas, icon, { palette, loop, enter, offset });
		return () => player?.stop();
	});

	$effect(() => {
		player?.set({ icon, palette, loop, offset });
	});
</script>

<canvas
	bind:this={canvas}
	class="block aspect-square w-full {className}"
	role={label ? "img" : undefined}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : "true"}
></canvas>
