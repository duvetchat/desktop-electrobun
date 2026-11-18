<script lang="ts">
	import type { Snippet } from "svelte";

	// For tests: bits-ui's portal draws nothing on the server, where the tests render. This stands in for it and draws
	// what it holds where it is, so a test can read an overlay's panel.
	let { children = undefined }: { children?: Snippet } = $props();
</script>

{@render children?.()}
