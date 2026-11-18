<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { iconButtonClass, type ControlSize } from "./recipes";

	// A button that is only an icon, so it always says what it does: `label` is its name for a screen reader.
	// `active` is the picked look (a filter that's on, a panel that's open); `badge` puts the accent's dot on its
	// corner. What a Tooltip, a Menu or a Popover hands its opener is spread on it with the rest.
	let {
		label,
		size = "md",
		active = false,
		badge = false,
		type = "button",
		class: className = "",
		children,
		...rest
	}: Omit<HTMLButtonAttributes, "class" | "aria-label"> & {
		label: string;
		size?: ControlSize;
		active?: boolean;
		badge?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<button {...rest} {type} aria-label={label} class="{iconButtonClass(size, active)} {className}">
	{@render children?.()}
	{#if badge}
		<span class="bg-duvet-accent absolute top-0.5 right-0.5 size-[7px] rounded-full" aria-hidden="true"></span>
	{/if}
</button>
