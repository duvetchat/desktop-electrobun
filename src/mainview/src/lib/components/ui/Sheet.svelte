<script lang="ts">
	import type { Snippet } from "svelte";
	import { Dialog } from "bits-ui";
	import { X } from "@lucide/svelte";
	import { GLASS_STRONG, iconButtonClass } from "./recipes";

	// A sheet: a glass panel in the middle of the window, over a scrim, for a task with a few fields (a new chat, an
	// invite, a new room). A press on the scrim or Esc closes it. Its title is in Fraunces; `foot` holds its buttons,
	// the first pushed to the left. `lead` sits before the title (whose form it is). A sheet whose fields would be
	// lost says so: `interactOutsideBehavior="ignore"` keeps it open under a press on the scrim, and a busy one
	// ignores Esc too. `onOpenAutoFocus` puts the focus where the task starts, instead of on the close button.
	let {
		open = $bindable(false),
		onOpenChange = undefined,
		title,
		description = undefined,
		closeLabel = "Close",
		class: className = "",
		interactOutsideBehavior = "close",
		escapeKeydownBehavior = "close",
		onOpenAutoFocus = undefined,
		onCloseAutoFocus = undefined,
		lead = undefined,
		children,
		foot = undefined,
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		title: string;
		description?: string;
		closeLabel?: string;
		class?: string;
		interactOutsideBehavior?: "close" | "ignore";
		escapeKeydownBehavior?: "close" | "ignore";
		onOpenAutoFocus?: (event: Event) => void;
		onCloseAutoFocus?: (event: Event) => void;
		lead?: Snippet;
		children: Snippet;
		foot?: Snippet;
	} = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay class="bg-duvet-scrim animate-scrim-in fixed inset-0 z-[900]" />
		<Dialog.Content
			{interactOutsideBehavior}
			{escapeKeydownBehavior}
			{onOpenAutoFocus}
			{onCloseAutoFocus}
			class="{GLASS_STRONG} animate-sheet-in text-duvet-ink fixed top-1/2 left-1/2 z-[900] flex max-h-[84%] w-[min(520px,calc(100%-48px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-3xl p-4 outline-none {className}"
		>
			<div class="flex items-center gap-2">
				{@render lead?.()}
				<Dialog.Title class="font-serif-lg min-w-0 flex-1 text-[21px] leading-[1.2] font-normal tracking-[-0.01em]">
					{title}
				</Dialog.Title>
				<Dialog.Close aria-label={closeLabel} class={iconButtonClass()}>
					<X size={16} />
				</Dialog.Close>
			</div>
			{#if description}
				<Dialog.Description class="text-duvet-ink2 -mt-1.5 text-[13px]">{description}</Dialog.Description>
			{/if}
			{@render children()}
			{#if foot}
				<div class="mt-1 flex items-center gap-2 [&>:first-child]:mr-auto">
					{@render foot()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
