<script lang="ts">
	import { FileText as FileIcon, Download as DownloadIcon, Play as PlayIcon, ShieldAlert } from "@lucide/svelte";
	import AudioFilePlayer from "$lib/components/AudioFilePlayer.svelte";
	import VoiceNotePlayer from "$lib/components/VoiceNotePlayer.svelte";
	import { base64Bytes } from "$lib/activity-thumbnail";
	import { sniffType } from "$lib/e2e/conventions";
	import { decryptedFiles, saveFile } from "$lib/e2e/decrypted-files.svelte";
	import { drawnBy } from "$lib/e2e/engine/files";
	import { t } from "$lib/i18n";
	import { formatFileSize } from "$lib/i18n/format";
	import { MESSAGE_CARD, MESSAGE_CARD_ACTION } from "$lib/message-styles";
	import type { Attachment } from "$lib/types";

	// A conversation's file as a message draws it (PLAN-E2E-CLIENTES.md, «Adjuntos»): its thumbnail first, the file
	// downloaded from its signed URL and opened by this device's core (lib/e2e/decrypted-files.svelte.ts), then drawn in
	// the element its own bytes are for: a picture, a video once it's all here, a voice note or an audio file in today's
	// players. Anything else, a file whose sender calls it what it isn't among them, is saved as bytes: nothing decrypted
	// ever opens, in a tab, a frame or a window (Review Focus 6). A picture, an audio file and a voice note come by
	// themselves as they near the screen; a video and a file to save on a click. A picture or a video is drawn inside
	// its message's box.
	let {
		att,
		kind,
		fit = "object-contain",
		onPreview = () => {},
		authorName = "",
		channelName = "",
		hidden = false,
	}: {
		att: Attachment;
		kind: "image" | "video" | "audio" | "voice" | "file";
		fit?: string;
		onPreview?: (src: string, alt?: string) => void;
		authorName?: string;
		channelName?: string;
		/** Under a spoiler's cover, still blurred. */
		hidden?: boolean;
	} = $props();

	const file = $derived(att.sealed!);
	const messageId = $derived(att.message_id ?? "");
	const opened = $derived(decryptedFiles.state(file));
	const ready = $derived(opened?.status === "ready" ? opened : null);
	// The element its bytes are for: a file to save is saved whatever they are.
	const drawn = $derived(ready && kind !== "file" ? drawnBy(ready.type) : "download");
	const auto = $derived(kind === "image" || kind === "audio" || kind === "voice");
	const percent = $derived(opened?.status === "loading" ? Math.floor(opened.progress * 100) : 0);
	const failure = $derived(
		opened?.status === "failed"
			? t(
					opened.reason === "hash"
						? "e2e_file_altered"
						: opened.reason === "download"
							? "e2e_file_download_failed"
							: "e2e_file_unavailable",
				)
			: null,
	);
	// A download that failed, which a click asks for again: only what its bytes are is final.
	const again = $derived(opened?.status === "failed" && opened.reason === "download");
	// What a screen reader hears of its card: what shows on it.
	const cardLabel = $derived(
		failure
			? t("e2e_file_named", { name: file.name, status: failure })
			: opened?.status === "loading"
				? t("e2e_file_named", { name: file.name, status: t("e2e_file_progress", { percent }) })
				: t("e2e_file_save_named", { name: file.name }),
	);
	// A video its browser couldn't play, or a picture it couldn't draw, is offered to save.
	let unplayable = $state(false);
	let undrawable = $state(false);
	// A video plays by itself only after the click that asked for it, never as it mounts again or under a spoiler.
	let asked = $state(false);

	// Opened by itself only as it nears the screen: a loaded page mounts every row, and four files come down at once.
	let near = $state(false);
	let waiting = $state<HTMLElement | null>(null);
	$effect(() => {
		const element = waiting;
		if (!element || near) return;
		if (typeof IntersectionObserver === "undefined") {
			near = true;
			return;
		}
		const watch = new IntersectionObserver((seen) => (near ||= seen.some((entry) => entry.isIntersecting)), {
			rootMargin: "600px 0px",
		});
		watch.observe(element);
		return () => watch.disconnect();
	});
	$effect(() => {
		if (auto && near) void decryptedFiles.open(file, messageId, { auto: true });
	});

	// Its thumbnail, while the file isn't drawn: the one inside its message, a URL of its own while this shows, or a file
	// of its own, opened as any file is; only a JPEG or a PNG by its bytes.
	let inside = $state<string | null>(null);
	// Its text, not the file, which the list makes again with each change: one URL while the same thumbnail shows.
	const insideText = $derived(file.thumbnail);
	$effect(() => {
		const bytes = insideText ? base64Bytes(insideText) : null;
		const type = bytes ? sniffType(bytes) : null;
		if (!bytes || (type !== "image/jpeg" && type !== "image/png")) return;
		const url = URL.createObjectURL(new Blob([bytes], { type }));
		inside = url;
		return () => {
			URL.revokeObjectURL(url);
			inside = null;
		};
	});
	const ref = $derived(file.thumbnail_ref ? { ...file.thumbnail_ref, url: file.thumbnailUrl ?? null } : null);
	const refState = $derived(ref ? decryptedFiles.state(ref) : undefined);
	$effect(() => {
		if (ref && near) void decryptedFiles.open(ref, messageId, { auto: true });
	});
	const thumbnail = $derived(
		inside ?? (refState?.status === "ready" && drawnBy(refState.type) === "image" ? refState.url : null),
	);

	// A click asks for it whatever it is: a video to play, a file to save, a picture let go of for room, a download that
	// failed.
	async function fetchFile() {
		asked = true;
		const done = await decryptedFiles.open(file, messageId);
		if (kind === "file" && done.status === "ready") saveFile(done.blob, file.name);
	}

	function save() {
		if (ready) saveFile(ready.blob, file.name);
	}
</script>

{#if drawn === "image" && ready && !undrawable}
	<button
		type="button"
		class="group/tile relative block size-full cursor-zoom-in overflow-hidden"
		onclick={() => onPreview(ready.url, file.name)}
	>
		<img
			src={ready.url}
			alt={file.name}
			data-decrypted
			class="relative size-full transition-transform duration-[350ms] group-hover/tile:scale-[1.03] motion-reduce:transition-none {fit}"
			onerror={() => (undrawable = true)}
		/>
	</button>
{:else if drawn === "video" && ready && !unplayable}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		src={ready.url}
		data-decrypted
		controls
		autoplay={asked && !hidden}
		class="relative size-full"
		onerror={() => (unplayable = true)}
	></video>
{:else if drawn === "audio" && ready && kind === "voice"}
	<VoiceNotePlayer src={ready.url} blob={ready.blob} attachmentId={file.id} {authorName} {channelName} />
{:else if drawn === "audio" && ready}
	<AudioFilePlayer
		src={ready.url}
		blob={ready.blob}
		attachmentId={file.id}
		filename={file.name}
		sizeBytes={file.size}
		{authorName}
		{channelName}
	/>
{:else if kind === "image" || kind === "video"}
	<!-- Inside its box: its thumbnail, and how far it is, what to press, or why it isn't shown -->
	<div class="relative size-full" bind:this={waiting}>
		{#if thumbnail}
			<img src={thumbnail} alt="" class="absolute inset-0 size-full object-cover blur-[2px]" />
		{:else}
			<div class="bg-duvet-secondary-fill absolute inset-0 {opened?.status === 'loading' ? 'animate-pulse' : ''}"></div>
		{/if}
		<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
			{#if failure}
				<span class="bg-duvet-media-scrim text-duvet-media-ink flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs">
					<ShieldAlert size={14} class="shrink-0" />{failure}
				</span>
				{#if again}
					<button
						type="button"
						class="bg-duvet-media-scrim text-duvet-media-ink grid size-11 place-items-center rounded-full"
						onclick={fetchFile}
						aria-label={kind === "video" ? t("e2e_file_play") : t("e2e_file_show")}
					>
						<PlayIcon size={18} fill={kind === "video" ? "currentColor" : "none"} />
					</button>
				{/if}
			{:else if ready}
				<button
					type="button"
					class="bg-duvet-media-scrim text-duvet-media-ink flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
					onclick={save}
					aria-label={t("e2e_file_save_named", { name: file.name })}
				>
					<DownloadIcon size={14} class="shrink-0" />{t("e2e_file_save")}
				</button>
			{:else if opened?.status === "loading"}
				<span class="bg-duvet-media-scrim text-duvet-media-ink rounded-lg px-2 py-1 text-xs tabular-nums">
					{t("e2e_file_progress", { percent })}
				</span>
				<span class="bg-duvet-ink/10 absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full" aria-hidden="true">
					<span class="bg-duvet-accent block h-full rounded-full" style="width: {percent}%"></span>
				</span>
			{:else}
				<button
					type="button"
					class="bg-duvet-media-scrim text-duvet-media-ink grid size-11 place-items-center rounded-full"
					onclick={fetchFile}
					aria-label={kind === "video" ? t("e2e_file_play") : t("e2e_file_show")}
				>
					<PlayIcon size={18} fill={kind === "video" ? "currentColor" : "none"} />
				</button>
			{/if}
		</div>
	</div>
{:else}
	<!-- A file to save, a voice note or an audio file on its way, or one whose bytes aren't what it says -->
	<button
		type="button"
		class="{ready || kind === 'file'
			? MESSAGE_CARD_ACTION
			: MESSAGE_CARD} text-duvet-ink relative flex w-[300px] max-w-full items-center gap-2.5 p-2.5 text-left"
		onclick={ready ? save : fetchFile}
		disabled={opened?.status === "loading" || (!!failure && !again)}
		aria-label={cardLabel}
		bind:this={waiting}
	>
		<span class="bg-duvet-secondary-fill text-duvet-accent-text rounded-row grid size-10 shrink-0 place-items-center">
			{#if failure}<ShieldAlert size={20} />{:else}<FileIcon size={20} />{/if}
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="truncate text-[13.5px] leading-tight font-semibold">{file.name}</span>
			<span class="text-duvet-ink2 text-[11.5px] leading-tight tabular-nums">
				{failure ?? (opened?.status === "loading" ? t("e2e_file_progress", { percent }) : formatFileSize(file.size))}
			</span>
		</span>
		{#if !failure}<DownloadIcon size={16} class="text-duvet-ink2 mr-1 shrink-0" />{/if}
		{#if opened?.status === "loading"}
			<span class="bg-duvet-ink/10 absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full" aria-hidden="true">
				<span class="bg-duvet-accent block h-full rounded-full" style="width: {percent}%"></span>
			</span>
		{/if}
	</button>
{/if}
