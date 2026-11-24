<script lang="ts">
	import { Copy } from "@lucide/svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import { fieldClass } from "$lib/components/ui/recipes";
	import { TEXT_PREVIEW_LIMIT, readTextPreview } from "$lib/text-preview";
	import { t, type MessageKey } from "$lib/i18n";
	import { formatNumber } from "$lib/i18n/format";

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
	// What went wrong, as its message: drawn in the language of the moment.
	let error = $state<MessageKey | null>(null);
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
			error = "media_text_preview_failed";
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

	// How much of the file shows, in the size's words of the language of the moment: 1 MB.
	const limit = $derived(
		TEXT_PREVIEW_LIMIT % 1_000_000 === 0
			? t("format_size_mb", { size: formatNumber(TEXT_PREVIEW_LIMIT / 1_000_000, { useGrouping: false }) })
			: t("format_size_kb", { size: formatNumber(TEXT_PREVIEW_LIMIT / 1000, { useGrouping: false }) }),
	);
</script>

<Sheet bind:open title={filename} description={t("media_text_preview_description")}>
	{#if loading}
		<p class="text-duvet-ink2 py-6 text-center text-[13px]">{t("media_text_preview_loading")}</p>
	{:else if error}
		<p class="text-duvet-danger py-6 text-center text-[13px]" role="alert">{t(error)}</p>
	{:else}
		<div class="flex items-center justify-end gap-2">
			{#if copied}
				<span class="text-duvet-alive-text text-xs font-medium" role="status" aria-live="polite"
					>{t("media_text_preview_copied")}</span
				>
			{/if}
			<IconButton label={t("media_text_preview_copy_label")} title={t("media_text_preview_copy")} onclick={copy}>
				<Copy size={16} />
			</IconButton>
		</div>
		<textarea
			readonly
			spellcheck="false"
			aria-label={t("media_text_preview_contents", { filename })}
			value={text}
			class="{fieldClass('area')} h-[min(60vh,520px)] font-mono"
		></textarea>
	{/if}
	{#if truncated}<p class="text-duvet-ink2 text-xs">{t("media_text_preview_truncated", { size: limit })}</p>{/if}
</Sheet>
