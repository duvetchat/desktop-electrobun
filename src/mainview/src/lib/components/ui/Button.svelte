<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { buttonClass, type ButtonVariant, type ControlSize } from "./recipes";

	// A button with words on it: primary (one per surface), secondary, danger, or quiet. With an href it is a link.
	// It is never a form's submit unless its type says so. What a Tooltip, a Menu or a Popover hands its opener is
	// spread on it with the rest.
	let {
		variant = "primary",
		size = "md",
		href = undefined,
		type = "button",
		disabled = false,
		class: className = "",
		children,
		...rest
	}: Omit<HTMLAttributes<HTMLElement>, "class"> & {
		variant?: ButtonVariant;
		size?: ControlSize;
		href?: string;
		type?: "button" | "submit" | "reset";
		disabled?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element
	this={href ? "a" : "button"}
	{...rest}
	type={href ? undefined : type}
	href={href && !disabled ? href : undefined}
	disabled={href ? undefined : disabled}
	aria-disabled={href ? disabled : undefined}
	role={href && disabled ? "link" : undefined}
	class="{buttonClass(variant, size)} {className}"
>
	{@render children?.()}
</svelte:element>
