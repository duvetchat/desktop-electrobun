<script lang="ts">
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import { fieldClass } from "$lib/components/ui/recipes";
	import { TEXT_PREVIEW_LIMIT, readTextPreview } from "$lib/text-preview";

	// A text file of the Attachments list, read in a dialog: the reader can select and copy it, and change nothing.
	// It is read when the dialog opens, and only its first TEXT_PREVIEW_LIMIT characters are shown.
	let {
		open = $bindable(false),
		filename,
		src,
	}: {
		open?: boolean;
		filename: string;
		/** The file's address. */
		src: string;
	} = $props();

	let text = $state("");
	// Until the file is read, the dialog says so: an empty box first would look like an empty file.
	let loading = $state(true);
	let error = $state<string | null>(null);
	let truncated = $state(false);
	// A read asked for twice: the one that finishes last is the one that counts.
	let read = 0;

	async function load() {
		const mine = ++read;
		text = "";
		error = null;
		truncated = false;
		loading = true;
		try {
			const preview = await readTextPreview(src);
			if (mine !== read) return;
			text = preview.text;
			truncated = preview.truncated;
		} catch (err) {
			if (mine !== read) return;
			if (import.meta.env.DEV) console.error("[TextFilePreview] The file wasn't read:", err);
			error = "Couldn't read this file.";
		} finally {
			if (mine === read) loading = false;
		}
	}

	$effect(() => {
		if (!open) {
			// Closed: whatever was on its way isn't shown when it arrives.
			read++;
			return;
		}
		void load();
	});

	const limit =
		TEXT_PREVIEW_LIMIT % 1_000_000 === 0 ? `${TEXT_PREVIEW_LIMIT / 1_000_000} MB` : `${TEXT_PREVIEW_LIMIT / 1000} KB`;
</script>

<Sheet bind:open title={filename} description="Read-only preview.">
	{#if loading}
		<p class="text-duvet-ink2 py-6 text-center text-[13px]">Loading…</p>
	{:else if error}
		<p class="text-duvet-danger py-6 text-center text-[13px]" role="alert">{error}</p>
	{:else}
		<textarea
			readonly
			spellcheck="false"
			aria-label="Contents of {filename}"
			value={text}
			class="{fieldClass('area')} h-[min(60vh,520px)] font-mono"
		></textarea>
	{/if}
	{#if truncated}<p class="text-duvet-ink2 text-xs">Only the first {limit} of the file is shown.</p>{/if}
</Sheet>
