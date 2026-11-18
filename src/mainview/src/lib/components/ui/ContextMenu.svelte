<script lang="ts">
	import type { Snippet } from "svelte";
	import { ContextMenu } from "bits-ui";
	import { MENU_PANEL } from "./recipes";

	// A menu on a right-click: the same glass panel and items as Menu (MenuItem, MenuSeparator, MenuSub), opened at
	// the pointer. What is right-clicked is the `target` snippet, which spreads the props it gets on its element.
	let {
		open = $bindable(false),
		onOpenChange = undefined,
		disabled = false,
		label = undefined,
		class: className = "",
		target,
		children,
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** Leaves the right-click to the system's own menu. */
		disabled?: boolean;
		label?: string;
		class?: string;
		target: Snippet<[Record<string, unknown>]>;
		children: Snippet;
	} = $props();
</script>

<ContextMenu.Root bind:open {onOpenChange}>
	<ContextMenu.Trigger {disabled}>
		{#snippet child({ props })}
			{@render target(props)}
		{/snippet}
	</ContextMenu.Trigger>
	<ContextMenu.Portal>
		<ContextMenu.Content
			collisionPadding={10}
			aria-label={label}
			class="{MENU_PANEL} origin-(--bits-floating-transform-origin) {className}"
		>
			{@render children()}
		</ContextMenu.Content>
	</ContextMenu.Portal>
</ContextMenu.Root>
