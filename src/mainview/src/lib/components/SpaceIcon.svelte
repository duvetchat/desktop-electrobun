<script lang="ts">
	let {
		src = undefined,
		name,
		size = 40,
		class: className = "",
	}: {
		src?: string | null | undefined;
		name: string;
		size?: number;
		class?: string;
	} = $props();

	const MAX_RETRIES = 3;
	const RETRY_DELAY = 2000;

	let imgLoaded = $state(false);
	let imgError = $state(false);
	let retryCount = $state(0);

	let lastSrc: string | null | undefined;
	$effect(() => {
		if (src !== lastSrc) {
			lastSrc = src;
			imgLoaded = false;
			imgError = !src;
			retryCount = 0;
		}
	});

	function handleError() {
		if (retryCount < MAX_RETRIES) {
			retryCount++;
			setTimeout(() => {
				imgError = false;
			}, RETRY_DELAY * retryCount);
		} else {
			imgError = true;
		}
	}

	function initials(n: string): string {
		return n
			.split(/\s+/)
			.map((w) => w[0])
			.join("")
			.slice(0, 2)
			.toUpperCase();
	}

	const showImg = $derived(!!src && !imgError);
</script>

<div style="width: {size}px; height: {size}px;" class="relative shrink-0 overflow-hidden rounded-xl {className}">
	{#if showImg}
		<img
			{src}
			alt={name}
			class="h-full w-full object-cover"
			style="opacity: {imgLoaded ? 1 : 0}; position: absolute; inset: 0;"
			onload={() => (imgLoaded = true)}
			onerror={handleError}
			draggable="false"
		/>
	{/if}
	{#if !showImg || !imgLoaded}
		<div
			class="flex h-full w-full items-center justify-center bg-linear-to-br from-stone-500 to-stone-700 font-bold text-white select-none"
			style="font-size: {size * 0.35}px;"
		>
			{initials(name)}
		</div>
	{/if}
</div>
