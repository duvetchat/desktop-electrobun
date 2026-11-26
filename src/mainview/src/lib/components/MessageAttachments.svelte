<script lang="ts">
	import { SvelteSet } from "svelte/reactivity";
	import { Download as DownloadIcon, FileText as FileIcon, Trash2 as TrashIcon } from "@lucide/svelte";
	import AudioFilePlayer from "$lib/components/AudioFilePlayer.svelte";
	import SealedFile from "$lib/components/e2e/SealedFile.svelte";
	import SpoilerCover from "$lib/components/SpoilerCover.svelte";
	import VoiceNotePlayer from "$lib/components/VoiceNotePlayer.svelte";
	import { getHostURL } from "$lib/common/common";
	import { displayName, isSpoiler } from "$lib/spoilers";
	import { MessageType, type Message } from "$lib/types";
	import {
		MESSAGE_CARD,
		MESSAGE_CARD_ACTION,
		MESSAGE_MEDIA,
		MESSAGE_MEDIA_PENDING,
		MESSAGE_MEDIA_SUNK,
		MESSAGE_PLACEHOLDER,
	} from "$lib/message-styles";
	import { allUp, cancelUpload, fileShare, messageUploadNote, messageUploads } from "$lib/uploads";

	// A message's voice note, sticker or files as the chat shows them, for the message list and the message
	// previews (pins, search results). Images and videos fit in maxWidth × maxHeight; a click on an image or
	// a sticker calls onPreview. Two pictures or more show as one grid of tiles, each cropped to its tile (a
	// click shows it whole); one alone keeps its own shape. data-attachments marks all of it, so a click on a
	// file can be told from a click on its message. A spoiler file (lib/spoilers) is blurred under a cover
	// until a click reveals it, for as long as this view shows the message, and its name shows without the
	// prefix. A conversation's file (its `sealed`) is drawn by SealedFile alone, from what this device decrypted of it.
	let {
		message,
		channelName,
		onPreview,
		maxWidth = 360,
		maxHeight = 380,
		preview = false,
	}: {
		message: Message;
		channelName: string;
		onPreview: (src: string, alt?: string) => void;
		maxWidth?: number;
		maxHeight?: number;
		/** A message preview's (pins, search results, a thread's messages), which SealedFile draws its files for. */
		preview?: boolean;
	} = $props();

	const attachmentHost = getHostURL();
	// The spoiler files a click revealed, by attachment ID.
	const revealed = new SvelteSet<string>();
	// How far the message's files are while this window sends it (lib/uploads), which every list showing it reads.
	const upload = $derived(message.nonce ? $messageUploads[message.nonce] : undefined);
	const sizes = $derived(message.attachments?.map((a) => a.size_bytes) ?? []);

	// The pictures that tile: those that are up and still there, when there are two or more.
	const tiled = $derived.by(() => {
		const pictures = (message.attachments ?? []).filter(
			(a) => a.content_type.startsWith("image/") && !a.pending && !a.deleted_at,
		);
		return pictures.length >= 2 ? pictures : [];
	});

	// A file's kind, as its card says it after its size: its name's extension.
	function fileKind(name: string): string {
		const dot = name.lastIndexOf(".");
		return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : "";
	}

	// A picture or a video that fails to load is asked for again every second, ten times, then says so.
	function loadAgain(e: Event) {
		const media = e.currentTarget as HTMLImageElement | HTMLVideoElement;
		const retries = parseInt(media.dataset.retries ?? "0");
		if (retries < 10) {
			media.dataset.retries = String(retries + 1);
			setTimeout(() => {
				const base = media.src.replace(/[&?]r=\d+/, "");
				media.src = base + (base.includes("?") ? "&" : "?") + "r=" + Date.now();
			}, 1000);
		} else {
			const parent = media.parentElement!;
			parent.querySelector(".media-skeleton")?.remove();
			media.remove();
			parent.innerHTML = `<div class="flex flex-col items-center justify-center w-full h-full bg-duvet-secondary-fill gap-1"><span class="text-2xl">💩</span><span class="text-xs text-duvet-ink2">Failed to load</span></div>`;
		}
	}

	function loaded(e: Event) {
		(e.currentTarget as HTMLElement).parentElement?.querySelector(".media-skeleton")?.remove();
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<div data-attachments class="contents">
	{#if message.type === MessageType.Voice}
		<!-- Voice note -->
		{@const voiceAtt = message.attachments?.find((a) => a.content_type.startsWith("audio/"))}
		{#if voiceAtt?.pending}
			<div
				class="bg-duvet-card shadow-duvet-raised flex w-[300px] max-w-full items-center gap-2.5 rounded-[18px] py-[7px] pr-2.5 pl-[7px]"
			>
				<div class="bg-duvet-secondary-fill size-[34px] shrink-0 animate-pulse rounded-full"></div>
				<div class="flex flex-1 flex-col gap-1.5">
					<div class="bg-duvet-secondary-fill h-5 animate-pulse rounded"></div>
					<span class="text-duvet-ink2 text-[11px]">Sending…</span>
				</div>
			</div>
		{:else if voiceAtt?.sealed}
			<SealedFile {preview} att={voiceAtt} kind="voice" authorName={message.author_name ?? "Unknown"} {channelName} />
		{:else if voiceAtt && !voiceAtt.deleted_at}
			<VoiceNotePlayer
				src="{attachmentHost}{voiceAtt.url ?? `/attachments/${voiceAtt.id}`}"
				attachmentId={voiceAtt.id}
				authorName={message.author_name ?? "Unknown"}
				{channelName}
			/>
		{:else}
			<div
				class="border-duvet-line text-duvet-ink2 flex h-12 items-center gap-2 rounded-[18px] border border-dashed px-4"
			>
				<TrashIcon size={16} class="shrink-0 opacity-60" />
				<span class="text-xs italic">Voice note deleted</span>
			</div>
		{/if}
	{:else if message.sticker_attachment_id}
		<button
			type="button"
			class="size-[136px] cursor-zoom-in"
			onclick={() => onPreview(`${attachmentHost}/attachments/${message.sticker_attachment_id}`)}
		>
			<img
				src="{attachmentHost}/attachments/{message.sticker_attachment_id}"
				alt="Sticker"
				class="size-[136px] object-contain"
				loading="lazy"
				onerror={(e) => {
					const img = e.currentTarget as HTMLImageElement;
					const parent = img.parentElement!;
					img.remove();
					parent.onclick = null;
					parent.style.cursor = "default";
					parent.innerHTML = `<div class="flex flex-col items-center justify-center w-full h-full rounded-card border border-dashed border-duvet-line gap-1"><span class="text-2xl">💩</span><span class="text-xs text-duvet-ink2">Sticker deleted</span></div>`;
				}}
			/>
		</button>
	{:else if message.attachments && message.attachments.length > 0}
		<div class="flex max-w-full flex-col gap-1">
			{#if tiled.length > 0}
				<!-- Two side by side; three as one large and two small; more in two columns of squares -->
				<div
					class="{MESSAGE_MEDIA} grid max-w-full gap-[3px] {tiled.length === 2
						? 'aspect-[2/1.15] grid-cols-2'
						: tiled.length === 3
							? 'aspect-[3/2.1] grid-cols-[2fr_1fr] grid-rows-2'
							: 'grid-cols-2'}"
					style="width: {Math.min(360, maxWidth)}px;"
				>
					{#each tiled as att, i (att.id)}
						{@const name = displayName(att.filename)}
						{@const hidden = isSpoiler(att.filename) && !revealed.has(att.id)}
						<div
							class="bg-duvet-sunk relative min-h-0 overflow-hidden {tiled.length === 3 && i === 0
								? 'row-span-2'
								: ''} {tiled.length > 3 ? 'aspect-square' : ''}"
						>
							{@render picture(att, name, hidden, "object-cover")}
							{#if hidden}
								<SpoilerCover onReveal={() => revealed.add(att.id)} />
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			{#each message.attachments as att, i}
				{@const name = displayName(att.filename)}
				{@const hidden = isSpoiler(att.filename) && !revealed.has(att.id)}
				{#if tiled.includes(att)}
					<!-- In the grid above -->
				{:else if att.pending}
					{@const share = upload ? fileShare(sizes, i, upload.sent, upload.total) : null}
					{@const pulse = share === null ? "animate-pulse" : ""}
					<!-- While its upload is followed, its share of it shows as a bar along its bottom, which takes the pulse's place -->
					{#if att.content_type.startsWith("image/")}
						<div class="{MESSAGE_MEDIA_PENDING} flex h-40 w-64 max-w-full items-center justify-center {pulse}">
							<span class="text-duvet-ink2 px-3 text-center text-xs">Uploading {name}…</span>
							{@render fileBar(share)}
						</div>
					{:else if att.content_type.startsWith("video/")}
						<div class="{MESSAGE_MEDIA_PENDING} flex h-44 w-80 max-w-full items-center justify-center {pulse}">
							<span class="text-duvet-ink2 px-3 text-center text-xs">Uploading {name}…</span>
							{@render fileBar(share)}
						</div>
					{:else}
						<div class="{MESSAGE_CARD} relative inline-flex w-[300px] max-w-full items-center gap-2 px-3 py-3 {pulse}">
							<span class="text-duvet-ink2 min-w-0 truncate text-xs">Uploading {name}…</span>
							<span class="text-duvet-ink2 shrink-0 text-xs opacity-60">{formatFileSize(att.size_bytes)}</span>
							{@render fileBar(share)}
						</div>
					{/if}
				{:else if att.deleted_at}
					{@const dw = Math.min(att.width ?? 200, maxWidth)}
					{@const dh = Math.min(att.height ?? 48, maxHeight)}
					<div
						class="{MESSAGE_PLACEHOLDER} flex flex-col items-center justify-center gap-1"
						style="width: {dw}px; height: {dh}px; max-width: 100%;"
					>
						<TrashIcon size={18} class="opacity-60" />
						<span class="text-xs">Attachment deleted</span>
					</div>
				{:else if att.content_type.startsWith("image/")}
					{@const rawW = att.width ?? maxWidth}
					{@const rawH = att.height ?? maxHeight}
					{@const imgScale = Math.min(maxWidth / rawW, maxHeight / rawH, 1)}
					{@const iw = Math.round(rawW * imgScale)}
					{@const ih = Math.round(rawH * imgScale)}
					<div class={MESSAGE_MEDIA_SUNK} style="width: {iw}px; height: {ih}px; max-width: 100%;">
						{@render picture(att, name, hidden, "object-contain")}
						{#if hidden}
							<SpoilerCover onReveal={() => revealed.add(att.id)} />
						{/if}
					</div>
				{:else if att.content_type.startsWith("video/")}
					{@const rawVW = att.width ?? maxWidth}
					{@const rawVH = att.height ?? maxHeight}
					{@const vidScale = Math.min(maxWidth / rawVW, maxHeight / rawVH, 1)}
					{@const vw = Math.round(rawVW * vidScale)}
					{@const vh = Math.round(rawVH * vidScale)}
					<div class={MESSAGE_MEDIA_SUNK} style="width: {vw}px; height: {vh}px; max-width: 100%;">
						{#if att.sealed}
							<div class="size-full {hidden ? 'blur-xl' : ''}" inert={hidden}>
								<SealedFile {preview} {att} kind="video" {hidden} />
							</div>
						{:else}
							<div
								class="media-skeleton bg-duvet-secondary-fill absolute inset-0 flex animate-pulse items-center justify-center"
							>
								<span class="text-duvet-ink2 text-xs">Loading video…</span>
							</div>
							<!-- svelte-ignore a11y_media_has_caption -->
							<video
								src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
								controls
								class="relative h-full w-full {hidden ? 'blur-xl' : ''}"
								inert={hidden}
								onloadeddata={loaded}
								onerror={loadAgain}
							></video>
						{/if}
						{#if hidden}
							<SpoilerCover onReveal={() => revealed.add(att.id)} />
						{/if}
					</div>
				{:else if att.content_type.startsWith("audio/")}
					<!-- As wide as the player. It clips only while hidden: the volume slider pops out above it. -->
					<div class="rounded-card relative max-w-87.5 {hidden ? 'overflow-hidden' : ''}">
						<div class={hidden ? "blur-md" : ""} inert={hidden}>
							{#if att.sealed}
								<SealedFile {preview} {att} kind="audio" authorName={message.author_name ?? "Unknown"} {channelName} />
							{:else}
								<AudioFilePlayer
									src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
									attachmentId={att.id}
									filename={name}
									sizeBytes={att.size_bytes}
									authorName={message.author_name ?? "Unknown"}
									{channelName}
								/>
							{/if}
						</div>
						{#if hidden}
							<SpoilerCover onReveal={() => revealed.add(att.id)} />
						{/if}
					</div>
				{:else}
					{@const kind = fileKind(name)}
					<div class="rounded-card relative w-[300px] max-w-full overflow-hidden">
						{#if att.sealed}
							<div class={hidden ? "blur-md" : ""} inert={hidden}>
								<SealedFile {preview} {att} kind="file" />
							</div>
						{:else}
							<a
								href="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
								target="_blank"
								rel="noopener noreferrer"
								class="{MESSAGE_CARD_ACTION} text-duvet-ink flex items-center gap-2.5 p-2.5 no-underline {hidden
									? 'blur-md'
									: ''}"
								inert={hidden}
							>
								<span
									class="bg-duvet-secondary-fill text-duvet-accent-text rounded-row grid size-10 shrink-0 place-items-center"
								>
									<FileIcon size={20} />
								</span>
								<span class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="truncate text-[13.5px] leading-tight font-semibold">{name}</span>
									<span class="text-duvet-ink2 text-[11.5px] leading-tight"
										>{formatFileSize(att.size_bytes)}{kind ? ` · ${kind}` : ""}</span
									>
								</span>
								<DownloadIcon size={16} class="text-duvet-ink2 mr-1 shrink-0" />
							</a>
						{/if}
						{#if hidden}
							<SpoilerCover onReveal={() => revealed.add(att.id)} />
						{/if}
					</div>
				{/if}
			{/each}
			{#if upload && message.attachments.some((a) => a.pending)}
				<p class="text-duvet-ink2 flex items-center gap-2 px-1 text-xs">
					<span class="tabular-nums">{messageUploadNote(sizes, upload.sent, upload.total)}</span>
					{#if !allUp(upload.sent, upload.total)}
						<!-- Only while its bytes go up: once they're all up, the API may post the message whatever happens here. It
						     takes the pointer the message being sent doesn't. -->
						<button
							type="button"
							class="text-duvet-ink pointer-events-auto cursor-pointer hover:underline"
							aria-label="Cancel upload"
							onclick={() => cancelUpload(message.nonce!)}>Cancel</button
						>
					{/if}
				</p>
			{/if}
		</div>
	{/if}
</div>

<!-- A picture in its box, which a click shows whole: pulsing until it loads, blurred while it's a spoiler -->
{#snippet picture(att: NonNullable<Message["attachments"]>[number], name: string, hidden: boolean, fit: string)}
	{#if att.sealed}
		<div class="size-full {hidden ? 'blur-xl' : ''}" inert={hidden}>
			<SealedFile {preview} {att} kind="image" {fit} onPreview={(src) => onPreview(src, name)} />
		</div>
	{:else}
		{@render network(att, name, hidden, fit)}
	{/if}
{/snippet}

<!-- A picture of a room's message, at the API's URL -->
{#snippet network(att: NonNullable<Message["attachments"]>[number], name: string, hidden: boolean, fit: string)}
	<button
		type="button"
		class="group/tile relative block size-full cursor-zoom-in overflow-hidden"
		inert={hidden}
		onclick={() => onPreview(`${attachmentHost}${att.url ?? `/attachments/${att.id}`}`, name)}
	>
		<div class="media-skeleton bg-duvet-secondary-fill absolute inset-0 animate-pulse"></div>
		<img
			src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
			alt={name}
			class="relative size-full text-transparent transition-transform duration-[350ms] group-hover/tile:scale-[1.03] motion-reduce:transition-none {fit} {hidden
				? 'blur-xl'
				: ''}"
			loading="lazy"
			onload={loaded}
			onerror={loadAgain}
		/>
	</button>
{/snippet}

{#snippet fileBar(share: number | null)}
	{#if share !== null}
		<span class="bg-duvet-ink/10 absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full" aria-hidden="true">
			<span class="bg-duvet-accent block h-full rounded-full" style="width: {share * 100}%"></span>
		</span>
	{/if}
{/snippet}
