<script lang="ts">
	import AudioFilePlayer from "$lib/components/AudioFilePlayer.svelte";
	import VoiceNotePlayer from "$lib/components/VoiceNotePlayer.svelte";
	import { getHostURL } from "$lib/common/common";
	import { MessageType, type Message } from "$lib/types";

	// A message's voice note, sticker or files as the chat shows them, for the message list and the message
	// previews (pins, search results). Images and videos fit in maxWidth × maxHeight; a click on an image or
	// a sticker calls onPreview. data-attachments marks all of it, so a click on a file can be told from a
	// click on its message.
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
				style="background: oklch(0.22 0.01 80 / 0.8); border: 1px solid oklch(0.30 0.01 80 / 0.6);"
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
				style="background: oklch(0.20 0.008 80 / 0.5);"
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
			{#each message.attachments as att}
				{#if att.pending}
					{#if att.content_type.startsWith("image/")}
						<div class="flex h-40 w-64 animate-pulse items-center justify-center rounded-md bg-zinc-700/40">
							<span class="text-xs text-zinc-500">Uploading {att.filename}...</span>
						</div>
					{:else if att.content_type.startsWith("video/")}
						<div class="flex h-44 w-80 animate-pulse items-center justify-center rounded-md bg-zinc-700/40">
							<span class="text-xs text-zinc-500">Uploading {att.filename}...</span>
						</div>
					{:else}
						<div class="inline-flex max-w-xs animate-pulse items-center gap-2 rounded-md bg-zinc-800/60 px-3 py-2">
							<span class="text-xs text-zinc-500">Uploading {att.filename}...</span>
							<span class="shrink-0 text-xs text-zinc-600">{formatFileSize(att.size_bytes)}</span>
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
					<button
						type="button"
						class="relative block cursor-zoom-in overflow-hidden rounded-md"
						style="width: {iw}px; height: {ih}px; max-width: 100%;"
						onclick={() => onPreview(`${attachmentHost}${att.url ?? `/attachments/${att.id}`}`, att.filename)}
					>
						<div class="img-skeleton absolute inset-0 animate-pulse bg-zinc-700/40"></div>
						<img
							src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
							alt={att.filename}
							class="relative h-full w-full rounded-md object-contain text-transparent"
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
							class="relative h-full w-full rounded-md"
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
					</div>
				{:else if att.content_type.startsWith("audio/")}
					<AudioFilePlayer
						src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
						attachmentId={att.id}
						filename={att.filename}
						sizeBytes={att.size_bytes}
						authorName={message.author_name ?? "Unknown"}
						{channelName}
					/>
				{:else}
					<a
						href="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
						target="_blank"
						rel="noopener noreferrer"
						class="mt-1 inline-flex max-w-xs items-center gap-2 rounded-md bg-zinc-800/60 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700/60"
					>
						<span class="truncate">{att.filename}</span>
						<span class="shrink-0 text-xs text-zinc-500">{formatFileSize(att.size_bytes)}</span>
					</a>
				{/if}
			{/each}
		</div>
	{/if}
</div>
