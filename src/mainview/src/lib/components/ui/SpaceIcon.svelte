<script lang="ts">
	import { monogram, monogramSize, spaceIconRadius } from "./recipes";

	// A Space's icon: a rounded square (its radius 27% of its size), never a circle, which is for people. Without a
	// picture it is the first letter of the Space's name, in Fraunces.
	let {
		src = undefined,
		name,
		size = 24,
		class: className = "",
	}: { src?: string | null; name: string; size?: number; class?: string } = $props();
</script>

<span
	class="bg-duvet-secondary-fill text-duvet-ink inline-grid shrink-0 place-items-center overflow-hidden font-serif leading-none font-medium {className}"
	style="width: {size}px; height: {size}px; border-radius: {spaceIconRadius(size)}px; font-size: {monogramSize(
		size,
	)}px;"
>
	{#if src}
		<img {src} alt="" class="block size-full object-cover" draggable="false" loading="lazy" />
	{:else}
		{monogram(name)}
	{/if}
</span>
