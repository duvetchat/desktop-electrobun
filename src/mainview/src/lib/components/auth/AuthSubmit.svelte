<script lang="ts">
	import type { Snippet } from "svelte";
	import Button from "$lib/components/ui/Button.svelte";

	// A form's one primary action on the sign-in pages: the primary button, as wide as the column and 40 tall, with a
	// spinner beside its words while the form is being sent. With an href it is a link that looks the same.
	let {
		busy = false,
		disabled = false,
		href = undefined,
		variant = "primary",
		type = "submit",
		onclick = undefined,
		class: className = "",
		children,
	}: {
		busy?: boolean;
		disabled?: boolean;
		href?: string;
		variant?: "primary" | "secondary" | "quiet";
		/** Outside a form, with `onclick`, it is a plain button. */
		type?: "submit" | "button";
		onclick?: () => void;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<Button
	type={onclick ? "button" : type}
	{onclick}
	{href}
	{variant}
	disabled={disabled || busy}
	aria-busy={busy}
	class="h-10! w-full rounded-xl! text-[14px]! font-semibold! no-underline! {className}"
>
	{#if busy}
		<span
			class="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current motion-reduce:animate-none"
			aria-hidden="true"
		></span>
	{/if}
	{@render children()}
</Button>
