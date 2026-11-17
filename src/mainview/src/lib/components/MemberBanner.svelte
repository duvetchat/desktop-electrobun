<script lang="ts">
	// A member's banner, faintly behind their row, which is relative, with what it shows above it relative too. It fades
	// in from the row's middle to its right edge, and the text at the row's left stays on the row's own color.
	let { src, offline = false }: { src: string | null; offline?: boolean } = $props();

	const MAX_TRIES = 3;
	const RETRY_DELAY = 2000;

	// Each banner's failures, by its URL, as a row of a list can come to show another member. One that fails hides, and
	// is asked for again after a wait, longer each time, until it has failed MAX_TRIES times.
	let failures = $state<Record<string, { tries: number; waiting: boolean }>>({});
	const failure = $derived(src ? failures[src] : undefined);

	function retryLater(url: string) {
		const tries = (failures[url]?.tries ?? 0) + 1;
		failures[url] = { tries, waiting: true };
		if (tries < MAX_TRIES) setTimeout(() => (failures[url].waiting = false), RETRY_DELAY * tries);
	}
</script>

{#if src && !failure?.waiting}
	<img
		src="{src}{failure ? `?r=${failure.tries}` : ''}"
		alt=""
		class="pointer-events-none absolute inset-0 h-full w-full [mask-image:linear-gradient(to_right,transparent_40%,black_90%)] object-cover object-right {offline
			? 'opacity-15'
			: 'opacity-25'}"
		onerror={() => retryLater(src)}
		draggable="false"
		loading="lazy"
	/>
{/if}
