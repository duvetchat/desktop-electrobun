<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { Check, X } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import { t } from "$lib/i18n";

	// A message's own text, edited where it is (#357): a text box on the message's place, with Save and Discard
	// beside it. Esc discards; Ctrl or ⌘ with Enter saves, as the message box's own edit did.
	let {
		content,
		onSave,
		onCancel,
	}: {
		content: string;
		onSave: (text: string) => void;
		onCancel: () => void;
	} = $props();

	let text = $state(untrack(() => content));
	let area: HTMLTextAreaElement | null = $state(null);

	function grow() {
		if (!area) return;
		area.style.height = "auto";
		area.style.height = `${area.scrollHeight}px`;
	}

	function save() {
		onSave(text);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
		} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			save();
		}
	}

	onMount(async () => {
		await tick();
		grow();
		area?.focus();
		area?.setSelectionRange(area.value.length, area.value.length);
	});
</script>

<div
	class="bg-duvet-card shadow-duvet-raised ring-duvet-accent/35 flex w-full max-w-[760px] flex-col gap-1 rounded-2xl p-2 ring-1"
>
	<textarea
		bind:this={area}
		bind:value={text}
		rows="1"
		placeholder={t("chat_edit_placeholder")}
		aria-label={t("chat_edit_message")}
		oninput={grow}
		onkeydown={onKeydown}
		class="font-content text-duvet-ink block max-h-[45vh] min-h-14 w-full resize-none bg-transparent px-1 py-1 text-[16px] leading-[1.45] wrap-anywhere outline-none"
	></textarea>
	<div class="flex items-center gap-1">
		<span class="text-duvet-ink2 min-w-0 flex-1 truncate px-1 text-[11px]">{t("chat_edit_keys")}</span>
		<IconButton label={t("chat_edit_cancel")} title={t("chat_edit_discard")} size="sm" onclick={onCancel}>
			<X size={15} />
		</IconButton>
		<Button size="sm" onclick={save}>
			<Check size={14} />
			{t("chat_edit_save")}
		</Button>
	</div>
</div>
