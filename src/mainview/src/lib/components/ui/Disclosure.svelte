<script lang="ts">
	import { tick, untrack, type Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { slide } from "svelte/transition";
	import { ChevronDown as ChevronDownIcon } from "@lucide/svelte";
	import { motionMs } from "$lib/motion";

	// Header + content, for every fold in the Spaces list: a Space, a category, and the quiet Spaces' row. The whole
	// header is the button; its arrow says where it is and turns as the fold opens. Controlled (open) or not
	// (defaultOpen); `forceOpen` is the seam an outside filter can use to override a fold without touching the state.
	const uid = $props.id();
	let {
		open: controlledOpen = undefined,
		defaultOpen = true,
		forceOpen = false,
		onOpenChange = undefined,
		chevron = "end",
		level = undefined,
		rowId = undefined,
		panelRole = "group",
		panelClass = "",
		class: className = "",
		header,
		children,
		actions = undefined,
		id = uid,
		tabindex = level === undefined ? 0 : -1,
		...rest
	}: Omit<HTMLButtonAttributes, "class" | "aria-expanded" | "aria-controls"> & {
		/** Open when given: the caller keeps the state. Omitted, the component keeps it. */
		open?: boolean;
		defaultOpen?: boolean;
		/** An outside filter's override: open whatever the state says, and don't fold on a click. */
		forceOpen?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** Where the arrow sits, and so which side reads as the parent's: the Space's end, a category's start. */
		chevron?: "start" | "end";
		/** The tree level; a button with one is a treeitem. Omitted, it's an ordinary disclosure. */
		level?: number;
		/** The row's stable name, for the tree's roving focus and for finding a channel again. */
		rowId?: string;
		panelRole?: "group" | "none";
		panelClass?: string;
		class?: string;
		header: Snippet;
		children?: Snippet;
		/** Controls that sit on the header's end without becoming part of its button (a Space's menu, say). */
		actions?: Snippet;
	} = $props();

	let uncontrolledOpen = $state(untrack(() => defaultOpen));
	const open = $derived(forceOpen || (controlledOpen ?? uncontrolledOpen));
	const panelId = $derived(`${id}-panel`);
	let button: HTMLButtonElement | null = $state(null);
	// Where the column was when this row folded, so unfolding it again doesn't snap the list to another place.
	let scrollWhenClosed: number | null = null;

	/** The column's scroller, whose position a fold must not throw away when its content leaves the page. */
	function scrollParentOf(node: HTMLElement | null): HTMLElement | null {
		let parent = node?.parentElement ?? null;
		while (parent) {
			const overflow = getComputedStyle(parent).overflowY;
			if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) return parent;
			parent = parent.parentElement;
		}
		return null;
	}

	function toggle() {
		if (forceOpen) return;
		const scroller = scrollParentOf(button);
		const top = scroller?.scrollTop;
		const closing = open;
		if (closing && top !== undefined) scrollWhenClosed = top;
		const restore = !closing && scrollWhenClosed !== null ? scrollWhenClosed : top;
		if (!closing) scrollWhenClosed = null;
		const next = !open;
		if (controlledOpen === undefined) uncontrolledOpen = next;
		onOpenChange?.(next);
		if (scroller && restore !== undefined) void tick().then(() => (scroller.scrollTop = restore));
	}
</script>

<div class="relative">
	<!-- The actions ride on the header row alone: the panel is a sibling, so an open tree doesn't stretch them over it. -->
	<div class="relative flex items-center">
		<button
			{...rest}
			bind:this={button}
			{id}
			type="button"
			{tabindex}
			role={level === undefined ? undefined : "treeitem"}
			aria-level={level}
			aria-expanded={open}
			aria-controls={panelId}
			data-tree-id={rowId}
			class={className}
			onclick={toggle}
		>
			{#if chevron === "start"}
				<ChevronDownIcon
					class="size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none {open
						? ''
						: '-rotate-90'}"
					aria-hidden="true"
				/>
			{/if}
			{@render header()}
			{#if chevron === "end"}
				<ChevronDownIcon
					class="size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none {open
						? ''
						: '-rotate-90'}"
					aria-hidden="true"
				/>
			{/if}
		</button>
		{#if actions}
			<div class="absolute inset-y-0 right-0 z-10 flex items-center">{@render actions()}</div>
		{/if}
	</div>
	{#if open}
		<div id={panelId} role={panelRole} class={panelClass} transition:slide={{ duration: motionMs(160) }}>
			{@render children?.()}
		</div>
	{/if}
</div>
