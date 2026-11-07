<script lang="ts">
	import { SvelteSet } from "svelte/reactivity";
	import AudioFilePlayer from "$lib/components/AudioFilePlayer.svelte";
	import SpoilerCover from "$lib/components/SpoilerCover.svelte";
	import VoiceNotePlayer from "$lib/components/VoiceNotePlayer.svelte";
	import { getHostURL } from "$lib/common/common";
	import { displayName, isSpoiler } from "$lib/spoilers";
	import { MessageType, type Message } from "$lib/types";
	import { allUp, cancelUpload, fileShare, messageUploadNote, messageUploads } from "$lib/uploads";

	// A message's voice note, sticker or files as the chat shows them, for the message list and the message
	// previews (pins, search results). Images and videos fit in maxWidth × maxHeight; a click on an image or
	// a sticker calls onPreview. data-attachments marks all of it, so a click on a file can be told from a
	// click on its message. A spoiler file (lib/spoilers) is blurred under a cover until a click reveals it,
	// for as long as this view shows the message, and its name shows without the prefix.
	let {
		message,
		channelName,
		onPreview,
		maxWidth = 550,
		maxHeight = 350,
	}: {
		message: Message;
		channelName: string;
		onPreview: (src: string, alt?: string) => void;
		maxWidth?: number;
		maxHeight?: number;
	} = $props();

	const attachmentHost = getHostURL();
	// The spoiler files a click revealed, by attachment ID.
	const revealed = new SvelteSet<string>();
	// How far the message's files are while this window sends it (lib/uploads), which every list showing it reads.
	const upload = $derived(message.nonce ? $messageUploads[message.nonce] : undefined);
	const sizes = $derived(message.attachments?.map((a) => a.size_bytes) ?? []);

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
				class="flex max-w-64 min-w-48 items-center gap-2.5 rounded-2xl px-3.5 py-1"
				style="background: color-mix(in oklab, var(--color-night-22) 80%, transparent); border: 1px solid color-mix(in oklab, var(--color-night-30) 60%, transparent);"
			>
				<div class="size-9 shrink-0 animate-pulse rounded-full bg-zinc-700"></div>
				<div class="flex flex-1 flex-col gap-1.5">
					<div class="h-7 animate-pulse rounded bg-zinc-700/40"></div>
					<span class="text-[11px] text-zinc-500">Sending...</span>
				</div>
			</div>
		{:else if voiceAtt && !voiceAtt.deleted_at}
			<VoiceNotePlayer
				src="{attachmentHost}{voiceAtt.url ?? `/attachments/${voiceAtt.id}`}"
				attachmentId={voiceAtt.id}
				authorName={message.author_name ?? "Unknown"}
				{channelName}
			/>
		{:else}
			<div
				class="flex h-12 items-center gap-2 rounded-2xl border border-dashed border-zinc-700/50 px-4"
				style="background: color-mix(in oklab, var(--color-night-20) 50%, transparent);"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-zinc-600"
					><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path
						d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
					/></svg
				>
				<span class="text-xs text-zinc-500 italic">Voice note deleted</span>
			</div>
		{/if}
	{:else if message.sticker_attachment_id}
		<button
			type="button"
			class="mt-1 h-40 w-40 cursor-zoom-in"
			onclick={() => onPreview(`${attachmentHost}/attachments/${message.sticker_attachment_id}`)}
		>
			<img
				src="{attachmentHost}/attachments/{message.sticker_attachment_id}"
				alt="Sticker"
				class="h-40 w-40 object-contain"
				loading="lazy"
				onerror={(e) => {
					const img = e.currentTarget as HTMLImageElement;
					const parent = img.parentElement!;
					img.remove();
					parent.onclick = null;
					parent.style.cursor = "default";
					parent.innerHTML = `<div class="flex flex-col items-center justify-center w-40 h-40 rounded-md border border-dashed border-zinc-700 bg-zinc-800/30 gap-1"><span class="text-2xl">💩</span><span class="text-xs text-zinc-500">Sticker deleted</span></div>`;
				}}
			/>
		</button>
	{:else if message.attachments && message.attachments.length > 0}
		<div class="mt-1 flex flex-col gap-1">
			{#each message.attachments as att, i}
				{@const name = displayName(att.filename)}
				{@const hidden = isSpoiler(att.filename) && !revealed.has(att.id)}
				{#if att.pending}
					{@const share = upload ? fileShare(sizes, i, upload.sent, upload.total) : null}
					{@const pulse = share === null ? "animate-pulse" : ""}
					<!-- While its upload is followed, its share of it shows as a bar along its bottom, which takes the pulse's place -->
					{#if att.content_type.startsWith("image/")}
						<div class="relative flex h-40 w-64 items-center justify-center rounded-md bg-zinc-700/40 {pulse}">
							<span class="text-xs text-zinc-500">Uploading {name}...</span>
							{@render fileBar(share)}
						</div>
					{:else if att.content_type.startsWith("video/")}
						<div class="relative flex h-44 w-80 items-center justify-center rounded-md bg-zinc-700/40 {pulse}">
							<span class="text-xs text-zinc-500">Uploading {name}...</span>
							{@render fileBar(share)}
						</div>
					{:else}
						<div class="relative inline-flex max-w-xs items-center gap-2 rounded-md bg-zinc-800/60 px-3 py-2 {pulse}">
							<span class="text-xs text-zinc-500">Uploading {name}...</span>
							<span class="shrink-0 text-xs text-zinc-600">{formatFileSize(att.size_bytes)}</span>
							{@render fileBar(share)}
						</div>
					{/if}
				{:else if att.deleted_at}
					{@const dw = Math.min(att.width ?? 200, maxWidth)}
					{@const dh = Math.min(att.height ?? 48, maxHeight)}
					<div
						class="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-zinc-700 bg-zinc-800/30"
						style="width: {dw}px; height: {dh}px; max-width: 100%;"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="text-zinc-600"
							><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path
								d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
							/><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg
						>
						<span class="text-xs text-zinc-500">Attachment deleted</span>
					</div>
				{:else if att.content_type.startsWith("image/")}
					{@const rawW = att.width ?? maxWidth}
					{@const rawH = att.height ?? maxHeight}
					{@const imgScale = Math.min(maxWidth / rawW, maxHeight / rawH, 1)}
					{@const iw = Math.round(rawW * imgScale)}
					{@const ih = Math.round(rawH * imgScale)}
					<div class="relative overflow-hidden rounded-md" style="width: {iw}px; height: {ih}px; max-width: 100%;">
						<button
							type="button"
							class="relative block size-full cursor-zoom-in"
							inert={hidden}
							onclick={() => onPreview(`${attachmentHost}${att.url ?? `/attachments/${att.id}`}`, name)}
						>
							<div class="img-skeleton absolute inset-0 animate-pulse bg-zinc-700/40"></div>
							<img
								src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
								alt={name}
								class="relative h-full w-full rounded-md object-contain text-transparent {hidden ? 'blur-xl' : ''}"
								loading="lazy"
								onload={(e) => {
									(e.currentTarget as HTMLElement).parentElement?.querySelector(".img-skeleton")?.remove();
								}}
								onerror={(e) => {
									const img = e.currentTarget as HTMLImageElement;
									const retries = parseInt(img.dataset.retries ?? "0");
									if (retries < 10) {
										img.dataset.retries = String(retries + 1);
										setTimeout(() => {
											const base = img.src.replace(/[&?]r=\d+/, "");
											img.src = base + (base.includes("?") ? "&" : "?") + "r=" + Date.now();
										}, 1000);
									} else {
										const parent = img.parentElement!;
										parent.querySelector(".img-skeleton")?.remove();
										img.remove();
										parent.innerHTML = `<div class="flex flex-col items-center justify-center w-full h-full bg-zinc-800/60 rounded-md gap-1"><span class="text-2xl">💩</span><span class="text-xs text-zinc-500">Failed to load</span></div>`;
									}
								}}
							/>
						</button>
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
					<div class="relative overflow-hidden rounded-md" style="width: {vw}px; height: {vh}px; max-width: 100%;">
						<div class="video-skeleton absolute inset-0 flex animate-pulse items-center justify-center bg-zinc-700/40">
							<span class="text-xs text-zinc-500">Loading video...</span>
						</div>
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
							controls
							class="relative h-full w-full rounded-md {hidden ? 'blur-xl' : ''}"
							inert={hidden}
							onloadeddata={(e) => {
								const el = e.currentTarget as HTMLVideoElement;
								el.parentElement?.querySelector(".video-skeleton")?.remove();
							}}
							onerror={(e) => {
								const vid = e.currentTarget as HTMLVideoElement;
								const retries = parseInt(vid.dataset.retries ?? "0");
								if (retries < 10) {
									vid.dataset.retries = String(retries + 1);
									setTimeout(() => {
										const base = vid.src.replace(/[&?]r=\d+/, "");
										vid.src = base + (base.includes("?") ? "&" : "?") + "r=" + Date.now();
									}, 1000);
								} else {
									const parent = vid.parentElement!;
									parent.querySelector(".video-skeleton")?.remove();
									vid.remove();
									parent.innerHTML = `<div class="flex flex-col items-center justify-center w-full h-full bg-zinc-800/60 rounded-md gap-1"><span class="text-2xl">💩</span><span class="text-xs text-zinc-500">Failed to load</span></div>`;
								}
							}}
						></video>
						{#if hidden}
							<SpoilerCover onReveal={() => revealed.add(att.id)} />
						{/if}
					</div>
				{:else if att.content_type.startsWith("audio/")}
					<!-- As wide as the player. It clips only while hidden: the volume slider pops out above it. -->
					<div class="relative max-w-87.5 rounded-lg {hidden ? 'overflow-hidden' : ''}">
						<div class={hidden ? "blur-md" : ""} inert={hidden}>
							<AudioFilePlayer
								src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
								attachmentId={att.id}
								filename={name}
								sizeBytes={att.size_bytes}
								authorName={message.author_name ?? "Unknown"}
								{channelName}
							/>
						</div>
						{#if hidden}
							<SpoilerCover onReveal={() => revealed.add(att.id)} />
						{/if}
					</div>
				{:else}
					<div class="relative mt-1 max-w-xs overflow-hidden rounded-md">
						<a
							href="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-2 rounded-md bg-zinc-800/60 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700/60 {hidden
								? 'blur-md'
								: ''}"
							inert={hidden}
						>
							<span class="truncate">{name}</span>
							<span class="shrink-0 text-xs text-zinc-500">{formatFileSize(att.size_bytes)}</span>
						</a>
						{#if hidden}
							<SpoilerCover onReveal={() => revealed.add(att.id)} />
						{/if}
					</div>
				{/if}
			{/each}
			{#if upload && message.attachments.some((a) => a.pending)}
				<p class="flex items-center gap-2 text-xs text-zinc-400">
					<span class="tabular-nums">{messageUploadNote(sizes, upload.sent, upload.total)}</span>
					{#if !allUp(upload.sent, upload.total)}
						<!-- Only while its bytes go up: once they're all up, the API may post the message whatever happens here. It
						     takes the pointer the message being sent doesn't. -->
						<button
							type="button"
							class="pointer-events-auto cursor-pointer text-stone-300 hover:underline"
							aria-label="Cancel upload"
							onclick={() => cancelUpload(message.nonce!)}>Cancel</button
						>
					{/if}
				</p>
			{/if}
		</div>
	{/if}
</div>

{#snippet fileBar(share: number | null)}
	{#if share !== null}
		<span class="absolute inset-x-2 bottom-1 h-1 overflow-hidden rounded-full bg-zinc-600/40" aria-hidden="true">
			<span class="block h-full rounded-full bg-zinc-300" style="width: {share * 100}%"></span>
		</span>
	{/if}
{/snippet}
