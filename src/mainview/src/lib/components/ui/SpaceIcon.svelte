<script lang="ts">
	import { monogram, monogramSize, spaceIconRadius } from "./recipes";

	// A Space's icon: a rounded square (its radius 27% of its size), never a circle, which is for people. Without a
	// picture it is the first letter of the Space's name, in Fraunces. A picture that fails to load is tried again up to
	// three times, a little later each time, with the letter in its place meanwhile and for good after the last.
	let {
		src = undefined,
		name,
		size = 24,
		class: className = "",
	}: { src?: string | null; name: string; size?: number; class?: string } = $props();

	const MAX_RETRIES = 3;
	const RETRY_DELAY = 2000;
	let failed = $state(false);
	let retries = 0;
	let lastSrc: string | null | undefined;
	$effect(() => {
		if (src !== lastSrc) {
			lastSrc = src;
			failed = false;
			retries = 0;
		}
	});

	function handleError() {
		const tried = src;
		failed = true;
		if (retries >= MAX_RETRIES) return;
		retries++;
		// Asked for again by drawing it again, unless the Space got another picture meanwhile.
		setTimeout(() => {
			if (src === tried) failed = false;
		}, RETRY_DELAY * retries);
	}
</script>

<span
	class="bg-duvet-secondary-fill text-duvet-ink inline-grid shrink-0 place-items-center overflow-hidden font-serif leading-none font-medium {className}"
	style="width: {size}px; height: {size}px; border-radius: {spaceIconRadius(size)}px; font-size: {monogramSize(
		size,
	)}px;"
>
	{#if src && !failed}
		<img {src} alt="" class="block size-full object-cover" draggable="false" loading="lazy" onerror={handleError} />
	{:else}
		{monogram(name)}
	{/if}
</span>
