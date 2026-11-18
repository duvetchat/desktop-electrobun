<script lang="ts">
	import EmbedPlayer from "$lib/components/EmbedPlayer.svelte";
	import MessageComponents from "$lib/components/MessageComponents.svelte";
	import { EmbedType, type Embed, type EmbedMedia } from "$lib/types";
	import { getHostURL } from "$lib/common/common";
	import { renderMarkdown } from "$lib/markdown";
	import { roomNames } from "$lib/stores.svelte";
	import { formatShortDateTime } from "$lib/utils/time";
	import { webEmbed } from "$lib/urls";

	// compact: the smaller sizes of a message's preview (pins, search results, a thread), whose media fit in 320 × 240.
	let {
		embed,
		onImageClick,
		compact = false,
	}: { embed: Embed; onImageClick?: (src: string) => void; compact?: boolean } = $props();

	// An embed's URLs come from a page or from whoever sent the message: the card takes only its http(s) ones
	// (webEmbed), as another scheme, javascript: above all, would run in the app from a link or a frame.
	const card = $derived(webEmbed(embed));

	// The app's host and the API's, whose pages a card never frames (frameSandbox).
	const ownHosts = [location.hostname];
	try {
		ownHosts.push(new URL(getHostURL()).hostname);
	} catch {}

	// How large a lone image or video shows, and a lone image's button.
	const mediaFit = $derived(compact ? "max-h-60 max-w-80" : "max-h-87.5 max-w-137.5");
	const mediaWidth = $derived(compact ? "max-w-80" : "max-w-137.5");

	// The image a player shows until it's played (EmbedPlayer).
	const poster = $derived(card.image?.url ?? card.thumbnail?.url);

	// The footer's line: its text and the embed's date, as "FxTwitter • 10/21/26, 3:02 AM".
	const footerText = $derived(
		[card.footer?.text, card.timestamp ? formatShortDateTime(card.timestamp) : ""].filter(Boolean).join(" • "),
	);

	function intToHex(n: number): string {
		return "#" + (n >>> 0).toString(16).padStart(6, "0");
	}

	function embedBorderStyle(cardEmbed: Embed): string {
		const c = cardEmbed.color;
		if (!c || c.color_from == null) return "border-color: color-mix(in oklab, var(--duvet-ink) 20%, transparent)";
		const from = intToHex(c.color_from);
		if (c.color_to == null) return `border-color: ${from}`;
		const to = intToHex(c.color_to);
		if (c.color_via != null) {
			const via = intToHex(c.color_via);
			return `border-image: linear-gradient(180deg, ${from}, ${via}, ${to}) 1`;
		}
		return `border-image: linear-gradient(180deg, ${from}, ${to}) 1`;
	}

	function isTikTokEmbed(cardEmbed: Embed): boolean {
		return cardEmbed.provider === "TikTok" && !!cardEmbed.video?.url;
	}

	// A video plays as a file when its page says it is one (its content_type), or, for embeds without
	// one, when its URL looks like one; anything else is a player page, framed.
	function isDirectVideo(video: EmbedMedia): boolean {
		if (video.content_type) return video.content_type.startsWith("video/");
		const url = video.url;
		try {
			const parsed = new URL(url);
			const p = parsed.pathname.toLowerCase();
			if (p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".mov")) return true;
			// TikTok CDN URLs carry mime_type=video_mp4 in query params
			const mime = parsed.searchParams.get("mime_type");
			return mime === "video_mp4" || mime === "video_webm";
		} catch {
			const p = url.split("?")[0]!.toLowerCase();
			return p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".mov");
		}
	}
</script>

{#if card.components?.length}
	<!-- The linked page's own card, drawn as a message's components: layout, text, media and link buttons -->
	<div class="w-full max-w-108">
		<MessageComponents components={card.components} onPreview={(src) => onImageClick?.(src)} {compact} />
	</div>
{:else if card.type === EmbedType.Sticker && card.image}
	<button type="button" class="mt-1 block cursor-zoom-in" onclick={() => onImageClick?.(card.image!.url)}>
		<img
			src={card.image.url}
			alt={card.title ?? "Sticker"}
			class="h-40 w-40 object-contain"
			loading="lazy"
			title={card.title ?? ""}
		/>
	</button>
{:else if !isTikTokEmbed(card) && (card.type === EmbedType.Gifv || card.type === EmbedType.Image || (!card.title && !card.description && !card.author && !footerText && !card.fields?.length && (card.image || card.video)))}
	{#if card.video}
		<!-- preload none: the video is asked for only when it's played, as its host sees each request -->
		<video
			src={card.video.url}
			poster={card.thumbnail?.url ?? card.image?.url}
			preload="none"
			muted={card.type === EmbedType.Gifv}
			playsinline
			controls
			class="mt-1 self-start rounded {mediaFit}"
		></video>
	{:else if card.image}
		<button
			type="button"
			class="mt-1 block cursor-zoom-in self-start rounded {mediaWidth}"
			onclick={() => onImageClick?.(card.image!.url)}
		>
			<img src={card.image.url} alt="" class="rounded {mediaFit}" loading="lazy" />
		</button>
	{/if}
{:else if isTikTokEmbed(card)}
	<div
		class="bg-duvet-card/60 mt-1 flex w-[320px] flex-col overflow-hidden rounded-md border-l-4"
		style="border-color: #fe2c55;"
	>
		<div class="px-3 py-2.5 select-text">
			{#if card.provider}
				<span class="text-xxs text-duvet-ink2 font-semibold">{card.provider}</span>
			{/if}
			{#if card.title}
				{#if card.url}
					<a
						href={card.url}
						target="_blank"
						rel="noopener noreferrer"
						class="text-duvet-ink line-clamp-2 text-sm font-semibold hover:underline">{card.title}</a
					>
				{:else}
					<span class="text-duvet-ink line-clamp-2 text-sm font-semibold">{card.title}</span>
				{/if}
			{/if}
		</div>
		{#if card.video}
			<EmbedPlayer
				url={card.video.url}
				title={card.title ?? "TikTok"}
				aspect="aspect-9/16"
				allow="autoplay; encrypted-media"
				{poster}
				{ownHosts}
			/>
		{/if}
	</div>
{:else if card.title || card.description || card.video || card.image}
	<div
		class="bg-duvet-card/60 mt-1 flex max-w-sm flex-col overflow-hidden rounded-md border-l-4"
		style={embedBorderStyle(card)}
	>
		{#if card.author || card.title || card.description || card.fields?.length || footerText || card.thumbnail}
			<div class="flex gap-3 px-3 py-2.5">
				<div class="flex min-w-0 flex-1 flex-col gap-1 select-text">
					{#if card.author}
						<div class="flex items-center gap-1.5">
							{#if card.author.icon_url}
								<img src={card.author.icon_url} alt="" class="h-4 w-4 rounded-full" />
							{/if}
							{#if card.author.url}
								<a
									href={card.author.url}
									target="_blank"
									rel="noopener noreferrer"
									class="text-duvet-ink2 truncate text-xs hover:underline">{card.author.name}</a
								>
							{:else}
								<span class="text-duvet-ink2 truncate text-xs">{card.author.name}</span>
							{/if}
						</div>
					{/if}

					{#if card.title}
						{#if card.url}
							<a
								href={card.url}
								target="_blank"
								rel="noopener noreferrer"
								class="text-duvet-ink line-clamp-2 text-sm font-semibold hover:underline">{card.title}</a
							>
						{:else}
							<span class="text-duvet-ink line-clamp-2 text-sm font-semibold">{card.title}</span>
						{/if}
					{/if}

					{#if card.description}
						<p class="text-duvet-ink2 line-clamp-3 text-xs wrap-break-word">
							{@html renderMarkdown(card.description, false, undefined, undefined, $roomNames)}
						</p>
					{/if}

					{#if card.fields && card.fields.length > 0}
						<div class="mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
							{#each card.fields as field}
								<div class="flex min-w-0 flex-col {field.inline ? '' : 'w-full'}">
									<span class="text-duvet-ink2 text-xs font-bold">{field.name}</span>
									<span class="text-duvet-ink text-xs"
										>{@html renderMarkdown(field.value, false, undefined, undefined, $roomNames)}</span
									>
								</div>
							{/each}
						</div>
					{/if}

					{#if footerText}
						<span class="text-xxs text-duvet-ink2 mt-0.5">{footerText}</span>
					{/if}
				</div>

				{#if card.thumbnail}
					<img
						src={card.thumbnail.url}
						alt=""
						class="h-16 w-16 shrink-0 self-start rounded object-cover"
						loading="lazy"
					/>
				{/if}
			</div>
		{/if}

		{#if card.video}
			{#if isDirectVideo(card.video)}
				<video
					src={card.video.url}
					poster={card.image?.url ?? card.thumbnail?.url ?? ""}
					preload="none"
					muted
					playsinline
					controls
					class="max-h-72 w-full max-w-full"
				></video>
			{:else}
				<EmbedPlayer
					url={card.video.url}
					title={card.title ?? ""}
					aspect="aspect-video"
					allow="autoplay; encrypted-media; picture-in-picture"
					{poster}
					{ownHosts}
				/>
			{/if}
		{:else if card.image}
			<button type="button" class="block w-full cursor-zoom-in" onclick={() => onImageClick?.(card.image!.url)}>
				<img src={card.image.url} alt="" class="max-h-64 w-full max-w-full object-cover" loading="lazy" />
			</button>
		{/if}
	</div>
{/if}
