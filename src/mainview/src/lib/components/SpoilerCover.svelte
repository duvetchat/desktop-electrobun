<script lang="ts">
	// The cover over a spoiler, a message component's or a file's, until a click reveals it. It covers its
	// nearest positioned ancestor, and its click goes no further: it doesn't also open what it hid, or the
	// message.
	let { onReveal }: { onReveal: () => void } = $props();
</script>

<button
	type="button"
	class="absolute inset-0 flex items-center justify-center bg-zinc-900/30 transition-colors hover:bg-zinc-900/20"
	onclick={(e) => {
		e.stopPropagation();
		onReveal();
	}}
>
	<span class="text-fixed-white rounded-full bg-black/70 px-3 py-1 text-xs font-bold tracking-wide">SPOILER</span>
</button>
