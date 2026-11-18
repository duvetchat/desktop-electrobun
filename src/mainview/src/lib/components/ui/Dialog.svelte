<script lang="ts">
	import type { Snippet } from "svelte";
	import { AlertDialog } from "bits-ui";
	import { GLASS_STRONG } from "./recipes";

	// A dialog: a question that needs an answer before anything else (delete this, leave that). The sheet's glass, in
	// a narrower panel, without a close button: a press outside doesn't answer it, Esc is its Cancel. `actions` holds
	// its buttons, the one that cancels first.
	let {
		open = $bindable(false),
		onOpenChange = undefined,
		title,
		class: className = "",
		children,
		actions,
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		title: string;
		class?: string;
		/** What will happen, in a sentence or two. */
		children?: Snippet;
		actions: Snippet;
	} = $props();
</script>

<AlertDialog.Root bind:open {onOpenChange}>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="bg-duvet-scrim animate-scrim-in fixed inset-0 z-[900]" />
		<AlertDialog.Content
			class="{GLASS_STRONG} animate-sheet-in text-duvet-ink fixed top-1/2 left-1/2 z-[900] flex max-h-[84%] w-[min(400px,calc(100%-48px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-3xl p-4 outline-none {className}"
		>
			<AlertDialog.Title class="font-serif-lg text-[21px] leading-[1.2] font-normal tracking-[-0.01em]">
				{title}
			</AlertDialog.Title>
			{#if children}
				<AlertDialog.Description class="text-duvet-ink2 font-content text-[13.5px] leading-[1.4]">
					{@render children()}
				</AlertDialog.Description>
			{/if}
			<div class="mt-2 flex items-center justify-end gap-2">
				{@render actions()}
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
