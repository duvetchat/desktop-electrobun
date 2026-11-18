<script lang="ts">
	import type { Snippet } from "svelte";
	import { DropdownMenu } from "bits-ui";
	import { MENU_PANEL } from "./recipes";

	// A menu from a button: glass, against the button (6 px), below if it fits, else above, kept 10 px from the
	// window's edges. The button is the `trigger` snippet, which spreads the props it gets on its element. Its items
	// are MenuItem, MenuSeparator and MenuSub.
	let {
		open = $bindable(false),
		onOpenChange = undefined,
		side = "bottom",
		align = "start",
		label = undefined,
		class: className = "",
		trigger,
		children,
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		side?: "top" | "bottom" | "left" | "right";
		align?: "start" | "center" | "end";
		/** The menu's name for a screen reader, when its button's isn't enough. */
		label?: string;
		class?: string;
		trigger: Snippet<[Record<string, unknown>]>;
		children: Snippet;
	} = $props();
</script>

<DropdownMenu.Root bind:open {onOpenChange}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{@render trigger(props)}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			{side}
			{align}
			sideOffset={6}
			collisionPadding={10}
			aria-label={label}
			class="{MENU_PANEL} origin-(--bits-floating-transform-origin) {className}"
		>
			{@render children()}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
