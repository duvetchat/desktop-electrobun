<script lang="ts">
	import type { Snippet } from "svelte";
	import { Check, TriangleAlert, X } from "@lucide/svelte";

	// How a link from an email, or an invite, turned out: a 64 px tile (mobile's mail tile: a raised card, radius 16)
	// holding a spinner, a tick, a cross or a warning, then what happened and where to go next.
	let {
		state,
		title = undefined,
		text = undefined,
		children = undefined,
	}: {
		state: "loading" | "success" | "error" | "warning";
		title?: string;
		/** Under the title; for `loading`, the one line beside the spinner. */
		text?: string;
		/** The way on: a button or a link. */
		children?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center text-center" data-auth-result={state} aria-busy={state === "loading"}>
	<div
		class="bg-duvet-card shadow-duvet-raised grid size-16 place-items-center rounded-2xl {state === 'success'
			? 'text-duvet-alive'
			: state === 'error'
				? 'text-duvet-danger'
				: state === 'warning'
					? 'text-duvet-warn'
					: 'text-duvet-ink2'}"
	>
		{#if state === "loading"}
			<span
				class="border-duvet-line border-t-duvet-accent-text size-7 animate-spin rounded-full border-[3px]"
				aria-hidden="true"
			></span>
		{:else if state === "success"}
			<Check size={28} aria-hidden="true" />
		{:else if state === "error"}
			<X size={28} aria-hidden="true" />
		{:else}
			<TriangleAlert size={28} aria-hidden="true" />
		{/if}
	</div>
	{#if title}
		<h1 class="text-duvet-ink mt-5 text-[26px] leading-[1.15] font-bold tracking-[-0.02em]">{title}</h1>
	{/if}
	{#if text}
		<p
			class="text-duvet-ink2 font-content max-w-full text-[14px] leading-[1.4] wrap-break-word {title
				? 'mt-2'
				: 'mt-5'}"
			role={state === "loading" ? "status" : undefined}
		>
			{text}
		</p>
	{/if}
	{#if children}
		<div class="mt-6 flex w-full flex-col gap-2">{@render children()}</div>
	{/if}
</div>
