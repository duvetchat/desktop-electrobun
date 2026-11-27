<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { Check, X } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";

	// A message's own text, edited where it is (#357): a text box on the message's place, with Save and Discard
	// beside it. Esc discards; Ctrl or ⌘ with Enter saves, as the message box's own edit did. A save whose answer is
	// words was refused: the box stays, with what was typed, and says them (T-M1).
	let {
		content,
		onSave,
		onCancel,
	}: {
		content: string;
		onSave: (text: string) => void | string | Promise<void | string>;
		onCancel: () => void;
	} = $props();

	let text = $state(untrack(() => content));
	let refused = $state<string | null>(null);
	let area: HTMLTextAreaElement | null = $state(null);

	function grow() {
		if (!area) return;
		area.style.height = "auto";
		area.style.height = `${area.scrollHeight}px`;
	}

	async function save() {
		const said = await onSave(text);
		refused = typeof said === "string" ? said : null;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
		} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void save();
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
		aria-label="Edit message"
		oninput={grow}
		onkeydown={onKeydown}
		class="font-content text-duvet-ink block max-h-[45vh] min-h-14 w-full resize-none bg-transparent px-1 py-1 text-[16px] leading-[1.45] wrap-anywhere outline-none"
	></textarea>
	{#if refused}
		<p role="alert" class="text-duvet-danger px-1 text-[12px]">{refused}</p>
	{/if}
	<div class="flex items-center gap-1">
		<span class="text-duvet-ink2 min-w-0 flex-1 truncate px-1 text-[11px]"> Esc to cancel · Ctrl/⌘ Enter to save </span>
		<IconButton label="Discard edit" title="Discard" size="sm" onclick={onCancel}>
			<X size={15} />
		</IconButton>
		<Button size="sm" onclick={() => void save()}>
			<Check size={14} />
			Save
		</Button>
	</div>
</div>
