<script lang="ts">
	import { onDestroy } from "svelte";

	let { start }: { start: number } = $props();

	let now = $state(Date.now());
	const interval = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(interval));

	const elapsed = $derived(() => {
		const s = Math.max(0, Math.floor((now - start) / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = s % 60;
		if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")} elapsed`;
		return `${m}:${String(sec).padStart(2, "0")} elapsed`;
	});
</script>

<span class="text-xs text-zinc-500">{elapsed()}</span>
