<script lang="ts">
	import { Play as PlayIcon } from "@lucide/svelte";
	import MessageComponents from "$lib/components/MessageComponents.svelte";
	import { EmbedType, type Embed, type EmbedMedia } from "$lib/types";
	import { getHostURL } from "$lib/common/common";
	import { renderMarkdown } from "$lib/markdown";
	import { roomNames } from "$lib/stores.svelte";
	import { formatShortDateTime } from "$lib/utils/time";
	import { playerFrame, webEmbed } from "$lib/urls";
	import { getElectrobunRpc, isElectrobunWindow } from "$lib/electrobun-rpc";

	let { embed, onImageClick }: { embed: Embed; onImageClick?: (src: string) => void } = $props();

	// An embed's URLs come from a page or from whoever sent the message: the card takes only its http(s) ones
	// (webEmbed), as another scheme, javascript: above all, would run in the app from a link or a frame.
	const card = $derived(webEmbed(embed));

	// The app's host and the API's, whose pages a card never frames (frameSandbox).
	const ownHosts = [location.hostname];
	try {
		ownHosts.push(new URL(getHostURL()).hostname);
	} catch {}

	// The player page whose play button was clicked, framed from then on (playerFrame), and the image the button
	// shows until then.
	let playing = $state<string | null>(null);
	const poster = $derived(card.image?.url ?? card.thumbnail?.url);

	// In the packaged app, Electrobun's preload (with its RPC key) runs in frames too, so a page that isn't one of
	// the players the API frames itself opens in the browser instead of in a frame.
	function play(url: string) {
		if (isElectrobunWindow()) {
			void getElectrobunRpc().then((rpc) => rpc?.send.openExternal({ url }));
			return;
		}
		playing = url;
	}

	// The footer's line: its text and the embed's date, as "FxTwitter • 10/21/26, 3:02 AM".
	const footerText = $derived(
		[card.footer?.text, card.timestamp ? formatShortDateTime(card.timestamp) : ""].filter(Boolean).join(" • "),
	);

	// Videos the API fetches for the app: kktiktok.com's go only to a preview's bot.
	const PROXY_HOSTS = new Set(["video.twimg.com", "kktiktok.com"]);

	function proxyVideoUrl(url: string): string {
		try {
			if (PROXY_HOSTS.has(new URL(url).hostname)) {
				return `${getHostURL()}/api/proxy/video?url=${encodeURIComponent(url)}`;
			}
		} catch {}
		return url;
	}

	function intToHex(n: number): string {
		return "#" + (n >>> 0).toString(16).padStart(6, "0");
	}

	function embedBorderStyle(embed: Embed): string {
		const c = embed.color;
		if (!c || c.color_from == null) return "border-color: var(--color-zinc-700)";
		const from = intToHex(c.color_from);
		if (c.color_to == null) return `border-color: ${from}`;
		const to = intToHex(c.color_to);
		if (c.color_via != null) {
			const via = intToHex(c.color_via);
			return `border-image: linear-gradient(180deg, ${from}, ${via}, ${to}) 1`;
		}
		return `border-image: linear-gradient(180deg, ${from}, ${to}) 1`;
	}

	function isTikTokEmbed(embed: Embed): boolean {
		return embed.provider === "TikTok" && !!embed.video?.url;
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
			const p = url.split("?")[0].toLowerCase();
			return p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".mov");
		}
	}
</script>

{#if card.components?.length}
	<!-- The linked page's own card, drawn as a message's components: layout, text, media and link buttons -->
	<div class="w-full max-w-108">
		<MessageComponents components={card.components} onPreview={(src) => onImageClick?.(src)} />
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
		<video
			src={proxyVideoUrl(card.video.url)}
			muted={card.type === EmbedType.Gifv}
			playsinline
			controls
			class="mt-1 max-h-87.5 max-w-137.5 self-start rounded"
		></video>
	{:else if card.image}
		<button
			type="button"
			class="mt-1 block max-w-137.5 cursor-zoom-in self-start rounded"
			onclick={() => onImageClick?.(card.image!.url)}
		>
			<img src={card.image.url} alt="" class="max-h-87.5 max-w-137.5 rounded" loading="lazy" />
		</button>
	{/if}
{:else if isTikTokEmbed(card)}
	<div
		class="mt-1 flex w-[320px] flex-col overflow-hidden rounded-md border-l-4 bg-zinc-800/60"
		style="border-color: #fe2c55;"
	>
		<div class="px-3 py-2.5 select-text">
			{#if card.provider}
				<span class="text-xxs font-semibold text-zinc-400">{card.provider}</span>
			{/if}
			{#if card.title}
				{#if card.url}
					<a
						href={card.url}
						target="_blank"
						rel="noopener noreferrer"
						class="line-clamp-2 text-sm font-semibold text-stone-300 hover:underline">{card.title}</a
					>
				{:else}
					<span class="line-clamp-2 text-sm font-semibold text-zinc-100">{card.title}</span>
				{/if}
			{/if}
		</div>
		{#if card.video}
			{@render player(card.video.url, card.title ?? "TikTok", "aspect-9/16", "autoplay; encrypted-media")}
		{/if}
	</div>
{:else if card.title || card.description || card.video || card.image}
	<div
		class="mt-1 flex max-w-sm flex-col overflow-hidden rounded-md border-l-4 bg-zinc-800/60"
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
									class="truncate text-xs text-zinc-400 hover:underline">{card.author.name}</a
								>
							{:else}
								<span class="truncate text-xs text-zinc-400">{card.author.name}</span>
							{/if}
						</div>
					{/if}

					{#if card.title}
						{#if card.url}
							<a
								href={card.url}
								target="_blank"
								rel="noopener noreferrer"
								class="line-clamp-2 text-sm font-semibold text-stone-300 hover:underline">{card.title}</a
							>
						{:else}
							<span class="line-clamp-2 text-sm font-semibold text-zinc-100">{card.title}</span>
						{/if}
					{/if}

					{#if card.description}
						<p class="line-clamp-3 text-xs wrap-break-word text-zinc-400">
							{@html renderMarkdown(card.description, false, undefined, undefined, $roomNames)}
						</p>
					{/if}

					{#if card.fields && card.fields.length > 0}
						<div class="mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
							{#each card.fields as field}
								<div class="flex min-w-0 flex-col {field.inline ? '' : 'w-full'}">
									<span class="text-xxs font-semibold tracking-wide text-zinc-400 uppercase">{field.name}</span>
									<span class="text-xs text-zinc-300"
										>{@html renderMarkdown(field.value, false, undefined, undefined, $roomNames)}</span
									>
								</div>
							{/each}
						</div>
					{/if}

					{#if footerText}
						<span class="text-xxs mt-0.5 text-zinc-500">{footerText}</span>
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
					src={proxyVideoUrl(card.video.url)}
					poster={card.image?.url ?? card.thumbnail?.url ?? ""}
					muted
					playsinline
					controls
					class="max-h-72 w-full max-w-full"
				></video>
			{:else}
				{@render player(
					card.video.url,
					card.title ?? "",
					"aspect-video",
					"autoplay; encrypted-media; picture-in-picture",
				)}
			{/if}
		{:else if card.image}
			<button type="button" class="block w-full cursor-zoom-in" onclick={() => onImageClick?.(card.image!.url)}>
				<img src={card.image.url} alt="" class="max-h-64 w-full max-w-full object-cover" loading="lazy" />
			</button>
		{/if}
	</div>
{/if}

<!-- A player page, framed with playerFrame's sandbox: the players the API frames itself at once, any other page only
     once its play button is clicked, over the embed's image while it waits. -->
{#snippet player(url: string, title: string, aspect: string, allow: string)}
	{@const frame = playerFrame(url, ownHosts)}
	{#if frame}
		<div class="relative w-full {aspect}">
			{#if frame.clickToPlay && playing !== url}
				<button
					type="button"
					class="group absolute inset-0 flex items-center justify-center bg-zinc-900"
					aria-label={title ? `Play ${title}` : "Play"}
					onclick={() => play(url)}
				>
					{#if poster}
						<img src={poster} alt="" class="absolute inset-0 size-full object-cover" loading="lazy" />
					{/if}
					<span
						class="text-fixed-white relative flex size-14 items-center justify-center rounded-full bg-black/60 transition-colors group-hover:bg-black/80"
					>
						<PlayIcon class="size-6 translate-x-0.5" fill="currentColor" stroke="none" />
					</span>
				</button>
			{:else}
				<iframe src={url} {title} class="h-full w-full" {allow} allowfullscreen sandbox={frame.sandbox}></iframe>
			{/if}
		</div>
	{/if}
{/snippet}
