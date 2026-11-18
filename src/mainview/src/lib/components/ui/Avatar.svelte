<script lang="ts">
	import type { Snippet } from "svelte";
	import type { MemberOnSidebar } from "$lib/types";
	import { statusDotClass } from "$lib/status";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import { presenceSize } from "./recipes";

	// A person's picture, a circle (a bot's is a rounded square), with their presence at its bottom right when
	// `status` is given: a dot three tenths of the avatar wide, ringed in the color of what's behind it (`ring`, any
	// CSS color; the page's by default). Online is the live green, idle the warning color, do not disturb the danger
	// color with a bar across, offline a hollow ring; someone only on their phone gets the phone the app draws
	// (StatusDot). The picture is `src`, or the caller's own drawing as children (a face for someone without one).
	let {
		src = undefined,
		name = "",
		size = 32,
		bot = false,
		status = undefined,
		mobileOnly = false,
		ring = "var(--duvet-bg)",
		class: className = "",
		children = undefined,
	}: {
		src?: string | null;
		/** The picture's alternative text; empty when the name is written beside it. */
		name?: string;
		size?: number;
		bot?: boolean;
		status?: MemberOnSidebar["status"];
		mobileOnly?: boolean;
		ring?: string;
		class?: string;
		children?: Snippet;
	} = $props();

	const dot = $derived(presenceSize(size));
</script>

<span class="relative inline-block shrink-0 align-middle {className}" style="width: {size}px; height: {size}px;">
	<span class="bg-duvet-secondary-fill block size-full overflow-hidden {bot ? 'rounded-[28%]' : 'rounded-full'}">
		{#if children}
			{@render children()}
		{:else if src}
			<img {src} alt={name} class="block size-full object-cover" draggable="false" loading="lazy" />
		{/if}
	</span>
	{#if status && mobileOnly}
		<span class="absolute -right-px -bottom-px flex" style="width: {dot}px; color: {ring};">
			<StatusDot {status} mobileOnly class="w-full border-2" />
		</span>
	{:else if status === "offline"}
		<span
			class="absolute -right-px -bottom-px rounded-full"
			style="width: {dot}px; height: {dot}px; background: {ring}; box-shadow: 0 0 0 2px {ring}, inset 0 0 0 2px var(--duvet-ink2);"
		></span>
	{:else if status}
		<span
			class="absolute -right-px -bottom-px rounded-full {statusDotClass(status)}"
			style="width: {dot}px; height: {dot}px; box-shadow: 0 0 0 2px {ring};"
		>
			{#if status === "dnd"}
				<span class="absolute inset-x-[24%] top-[calc(50%-1px)] h-0.5 rounded-[1px]" style="background: {ring};"></span>
			{/if}
		</span>
	{/if}
</span>
