<script lang="ts">
	import { promptStore, say } from "$lib/stores/prompt.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { fieldClass } from "$lib/overlay-forms";
	import { t } from "$lib/i18n";

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
	title={say(promptStore.pending?.message) ?? ""}
	closeLabel={t("dialog_cancel")}
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
			placeholder={say(promptStore.pending.placeholder)}
			aria-label={say(promptStore.pending.message)}
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
		<Button variant="quiet" onclick={() => promptStore.resolve(null)}>{t("dialog_cancel")}</Button>
		<Button onclick={submit}>{t("dialog_ok")}</Button>
	{/snippet}
</Sheet>
