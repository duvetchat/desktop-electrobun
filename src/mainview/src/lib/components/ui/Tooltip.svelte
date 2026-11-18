<script lang="ts">
	import type { Snippet } from "svelte";
	import { Tooltip } from "bits-ui";

	// A tooltip: what a control does, after 520 ms of rest on it, and its shortcut if it has one (`keys`, already
	// written for this system: "⌘K" or "Ctrl K"). It sits below, centred, 6 px away, and flips when there's no room.
	// The control is the `trigger` snippet, which spreads the props it gets on its element.
	let {
		text,
		keys = undefined,
		side = "bottom",
		trigger,
	}: {
		text: string;
		keys?: string;
		side?: "top" | "bottom" | "left" | "right";
		trigger: Snippet<[Record<string, unknown>]>;
	} = $props();
</script>

<Tooltip.Provider delayDuration={520} disableHoverableContent>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render trigger(props)}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				{side}
				sideOffset={6}
				collisionPadding={10}
				class="bg-duvet-tip-bg text-duvet-tip-ink shadow-duvet-float animate-tip-in pointer-events-none z-[3000] flex max-w-80 items-center gap-2 rounded-lg px-2 py-[5px] text-xs leading-[1.2] font-medium whitespace-nowrap"
			>
				<span class="truncate">{text}</span>
				{#if keys}<span class="text-duvet-tip-dim">{keys}</span>{/if}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
