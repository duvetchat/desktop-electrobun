<script lang="ts">
	let {
		src = undefined,
		height = "8rem",
		class: className = "",
	}: {
		src?: string | null | undefined;
		height?: string;
		class?: string;
	} = $props();

	const MAX_RETRIES = 3;
	const RETRY_DELAY = 2000;

	let imgError = $state(false);
	let retryCount = $state(0);

	let lastSrc: string | null | undefined;
	$effect(() => {
		if (src !== lastSrc) {
			lastSrc = src;
			imgError = false;
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
</script>

{#if src && !imgError}
	<div class="w-full overflow-hidden {className}" style="height: {height};">
		<img {src} alt="banner" class="h-full w-full object-cover" onerror={handleError} draggable="false" />
	</div>
{/if}
