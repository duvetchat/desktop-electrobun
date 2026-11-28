<script lang="ts">
	import { onDestroy } from "svelte";
	import { t } from "$lib/i18n";

	let { start }: { start: number } = $props();

	let now = $state(Date.now());
	const interval = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(interval));

	const elapsed = $derived(() => {
		const s = Math.max(0, Math.floor((now - start) / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = s % 60;
		const time =
			h > 0
				? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
				: `${m}:${String(sec).padStart(2, "0")}`;
		return t("call_activity_elapsed", { time });
	});
</script>

<span class="text-duvet-ink2 text-xs">{elapsed()}</span>
