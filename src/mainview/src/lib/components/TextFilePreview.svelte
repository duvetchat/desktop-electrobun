<script lang="ts">
	import { Copy } from "@lucide/svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
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
	// How long "Copied!" stays beside its button.
	const COPIED_MS = 1500;
	// The copy's "Copied!" beside its button, for COPIED_MS.
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	function copy() {
		void navigator.clipboard.writeText(text);
		copied = true;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied = false;
			copyTimer = null;
		}, COPIED_MS);
	}

	async function load() {
		const mine = ++read;
		text = "";
		error = null;
		truncated = false;
		copied = false;
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
			copied = false;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = null;
			return;
		}
		void load();
	});

	$effect(() => () => {
		if (copyTimer) clearTimeout(copyTimer);
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
		<div class="flex items-center justify-end gap-2">
			{#if copied}
				<span class="text-duvet-alive-text text-xs font-medium" role="status" aria-live="polite">Copied!</span>
			{/if}
			<IconButton label="Copy the text" title="Copy" onclick={copy}>
				<Copy size={16} />
			</IconButton>
		</div>
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
