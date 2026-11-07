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
			<div class="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
				{#if promptStore.pending}
					<AlertDialog.Title class="mb-3 text-sm font-semibold text-white"
						>{promptStore.pending.message}</AlertDialog.Title
					>
					<input
						bind:this={inputEl}
						type="text"
						class="mb-4 h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
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
							class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
						>
							Cancel
						</AlertDialog.Cancel>
						<AlertDialog.Action
							class="bg-fill-600 text-fixed-white hover:bg-fill-500 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors"
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
