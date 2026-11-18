<script lang="ts">
	import type { Snippet } from "svelte";
	import { Toggle } from "bits-ui";
	import { pillClass } from "./recipes";

	// A pill: a small chip that can be picked (a filter, a tag). With `pressed` bound or `onPressedChange` it is a
	// toggle button; with `static` it is only a label, drawn picked or not.
	let {
		pressed = $bindable(false),
		onPressedChange = undefined,
		static: isStatic = false,
		disabled = false,
		class: className = "",
		children,
	}: {
		pressed?: boolean;
		onPressedChange?: (pressed: boolean) => void;
		static?: boolean;
		disabled?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

{#if isStatic}
	<span class="{pillClass(pressed)} {className}">{@render children()}</span>
{:else}
	<Toggle.Root bind:pressed {onPressedChange} {disabled} class="{pillClass(pressed)} disabled:opacity-45 {className}">
		{@render children()}
	</Toggle.Root>
{/if}
