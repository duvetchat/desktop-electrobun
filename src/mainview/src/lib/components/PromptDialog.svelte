<script lang="ts">
	import { promptStore } from "$lib/stores/prompt.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { fieldClass } from "$lib/overlay-forms";

	const open = $derived(promptStore.pending !== null);
	let inputEl = $state<HTMLInputElement | null>(null);

	function submit() {
		promptStore.resolve(promptStore.value.trim() || null);
	}
</script>

<!-- Ready to type: a name there is to change is selected, so typing replaces it. -->
<Sheet
	bind:open={
		() => open,
		(next) => {
			if (!next) promptStore.resolve(null);
		}
	}
	title={promptStore.pending?.message ?? ""}
	closeLabel="Cancel"
	class="max-w-[400px]"
	onOpenAutoFocus={(e) => {
		e.preventDefault();
		inputEl?.focus();
		inputEl?.select();
	}}
>
	{#if promptStore.pending}
		<input
			bind:this={inputEl}
			type="text"
			class={fieldClass()}
			placeholder={promptStore.pending.placeholder}
			aria-label={promptStore.pending.message}
			bind:value={promptStore.value}
			onkeydown={(e) => {
				if (e.key !== "Enter") return;
				// Closing hands the focus back at once: the rest of this key would press what opened the dialog.
				e.preventDefault();
				submit();
			}}
		/>
	{/if}
	{#snippet foot()}
		<span></span>
		<Button variant="quiet" onclick={() => promptStore.resolve(null)}>Cancel</Button>
		<Button onclick={submit}>OK</Button>
	{/snippet}
</Sheet>
