<script lang="ts">
	import { AlertDialog } from "bits-ui";
	import { promptStore } from "$lib/stores/prompt.svelte";

	const open = $derived(promptStore.pending !== null);
	let inputEl = $state<HTMLInputElement | null>(null);

	function submit() {
		promptStore.resolve(promptStore.value.trim() || null);
	}
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(v) => {
		if (!v) promptStore.resolve(null);
	}}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fixed inset-0 z-9998 bg-black/60 backdrop-blur-sm" />
		<!-- Ready to type: a name there is to change is selected, so typing replaces it. -->
		<AlertDialog.Content
			class="fixed inset-0 z-9999 flex items-center justify-center p-4"
			onOpenAutoFocus={(e) => {
				e.preventDefault();
				inputEl?.focus();
				inputEl?.select();
			}}
		>
			<div class="rounded-card border-duvet-line bg-duvet-bg shadow-duvet-float w-full max-w-sm border p-5">
				{#if promptStore.pending}
					<AlertDialog.Title class="text-duvet-ink mb-3 text-sm font-semibold"
						>{promptStore.pending.message}</AlertDialog.Title
					>
					<input
						bind:this={inputEl}
						type="text"
						class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent mb-4 h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
						placeholder={promptStore.pending.placeholder}
						bind:value={promptStore.value}
						onkeydown={(e) => {
							if (e.key !== "Enter") return;
							// Closing hands the focus back at once: the rest of this key would press what opened the dialog.
							e.preventDefault();
							submit();
						}}
					/>
					<div class="flex justify-end gap-2">
						<AlertDialog.Cancel
							class="text-duvet-ink hover:bg-duvet-card rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
						>
							Cancel
						</AlertDialog.Cancel>
						<AlertDialog.Action
							class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-4 py-1.5 text-sm font-bold transition-colors hover:brightness-110"
							onclick={submit}
						>
							OK
						</AlertDialog.Action>
					</div>
				{/if}
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
