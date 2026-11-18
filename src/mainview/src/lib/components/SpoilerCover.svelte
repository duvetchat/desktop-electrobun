<script lang="ts">
	// The cover over a spoiler, a message component's or a file's, until a click reveals it. It covers its
	// nearest positioned ancestor, and its click goes no further: it doesn't also open what it hid, or the
	// message.
	let { onReveal }: { onReveal: () => void } = $props();
</script>

<button
	type="button"
	class="bg-duvet-media-scrim/40 hover:bg-duvet-media-scrim/30 absolute inset-0 flex items-center justify-center rounded-[inherit] transition-colors motion-reduce:transition-none"
	onclick={(e) => {
		e.stopPropagation();
		onReveal();
	}}
>
	<span
		class="bg-duvet-media-scrim text-duvet-media-ink rounded-lg px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] backdrop-blur-md"
		>SPOILER</span
	>
</button>
