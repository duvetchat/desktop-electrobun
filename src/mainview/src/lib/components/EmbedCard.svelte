<script lang="ts">
	import { EmbedType, type Embed } from "$lib/types";
	import { getHostURL } from "$lib/common/common";

	let { embed, onImageClick }: { embed: Embed; onImageClick?: (src: string) => void } = $props();

	const PROXY_HOSTS = new Set(["video.twimg.com"]);

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
		if (!c || c.color_from == null) return "border-color: rgb(63 63 70)";
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

	function isDirectVideo(url: string): boolean {
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

{#if embed.type === EmbedType.Sticker && embed.image}
	<button type="button" class="mt-1 block cursor-zoom-in" onclick={() => onImageClick?.(embed.image!.url)}>
		<img
			src={embed.image.url}
			alt={embed.title ?? "Sticker"}
			class="h-[160px] w-[160px] object-contain"
			loading="lazy"
			title={embed.title ?? ""}
		/>
	</button>
{:else if embed.type === EmbedType.Gifv || embed.type === EmbedType.Image || (!embed.title && !embed.description && !embed.author && !embed.footer && !embed.fields?.length && (embed.image || embed.video))}
	{#if embed.video}
		<video src={proxyVideoUrl(embed.video.url)} muted playsinline controls class="mt-1 max-w-[550px] max-h-[350px] self-start rounded"
		></video>
	{:else if embed.image}
		<button
			type="button"
			class="mt-1 block max-w-[550px] cursor-zoom-in self-start rounded"
			onclick={() => onImageClick?.(embed.image!.url)}
		>
			<img src={embed.image.url} alt="" class="max-w-[550px] max-h-[350px] rounded" loading="lazy" />
		</button>
	{/if}
{:else if isTikTokEmbed(embed)}
	<div class="mt-1 flex w-[320px] flex-col overflow-hidden rounded-md border-l-4 bg-zinc-800/60" style="border-color: #fe2c55;">
		<div class="px-3 py-2.5">
			{#if embed.provider}
				<span class="text-xxs font-semibold text-zinc-400">{embed.provider}</span>
			{/if}
			{#if embed.title}
				{#if embed.url}
					<a href={embed.url} target="_blank" rel="noopener noreferrer" class="line-clamp-2 text-sm font-semibold text-stone-300 hover:underline">{embed.title}</a>
				{:else}
					<span class="line-clamp-2 text-sm font-semibold text-zinc-100">{embed.title}</span>
				{/if}
			{/if}
		</div>
		<div class="aspect-[9/16] w-full">
			<iframe
				src={embed.video?.url}
				title={embed.title ?? "TikTok"}
				class="h-full w-full"
				allow="autoplay; encrypted-media"
				allowfullscreen
				sandbox="allow-scripts allow-same-origin allow-popups"
			></iframe>
		</div>
	</div>
{:else if embed.title || embed.description || embed.video || embed.image}
	<div
		class="mt-1 flex max-w-sm flex-col overflow-hidden rounded-md border-l-4 bg-zinc-800/60"
		style={embedBorderStyle(embed)}
	>
		{#if embed.author || embed.title || embed.description || embed.fields?.length || embed.footer || embed.thumbnail}
			<div class="flex gap-3 px-3 py-2.5">
				<div class="flex min-w-0 flex-1 flex-col gap-1">
					{#if embed.author}
						<div class="flex items-center gap-1.5">
							{#if embed.author.icon_url}
								<img src={embed.author.icon_url} alt="" class="h-4 w-4 rounded-full" />
							{/if}
							{#if embed.author.url}
								<a
									href={embed.author.url}
									target="_blank"
									rel="noopener noreferrer"
									class="truncate text-xs text-zinc-400 hover:underline">{embed.author.name}</a
								>
							{:else}
								<span class="truncate text-xs text-zinc-400">{embed.author.name}</span>
							{/if}
						</div>
					{/if}

					{#if embed.title}
						{#if embed.url}
							<a
								href={embed.url}
								target="_blank"
								rel="noopener noreferrer"
								class="line-clamp-2 text-sm font-semibold text-stone-300 hover:underline">{embed.title}</a
							>
						{:else}
							<span class="line-clamp-2 text-sm font-semibold text-zinc-100">{embed.title}</span>
						{/if}
					{/if}

					{#if embed.description}
						<p class="line-clamp-3 text-xs wrap-break-word whitespace-pre-line text-zinc-400">{embed.description}</p>
					{/if}

					{#if embed.fields && embed.fields.length > 0}
						<div class="mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
							{#each embed.fields as field}
								<div class="flex min-w-0 flex-col {field.inline ? '' : 'w-full'}">
									<span class="text-xxs font-semibold tracking-wide text-zinc-400 uppercase">{field.name}</span>
									<span class="text-xs text-zinc-300">{field.value}</span>
								</div>
							{/each}
						</div>
					{/if}

					{#if embed.footer}
						<span class="text-xxs mt-0.5 text-zinc-500">{embed.footer.text}</span>
					{/if}
				</div>

				{#if embed.thumbnail}
					<img
						src={embed.thumbnail.url}
						alt=""
						class="h-16 w-16 shrink-0 self-start rounded object-cover"
						loading="lazy"
					/>
				{/if}
			</div>
		{/if}

		{#if embed.video}
			{#if isDirectVideo(embed.video.url)}
				<video
					src={proxyVideoUrl(embed.video.url)}
					poster={embed.image?.url ?? embed.thumbnail?.url ?? ""}
					autoplay
					muted
					playsinline
					controls
					class="max-h-72 w-full max-w-full"
				></video>
			{:else}
				<div class="aspect-video w-full">
					<iframe
						src={embed.video.url}
						title={embed.title ?? ""}
						class="h-full w-full"
						allow="autoplay; encrypted-media; picture-in-picture"
						allowfullscreen
					></iframe>
				</div>
			{/if}
		{:else if embed.image}
			<button type="button" class="block w-full cursor-zoom-in" onclick={() => onImageClick?.(embed.image!.url)}>
				<img src={embed.image.url} alt="" class="max-h-64 w-full max-w-full object-cover" loading="lazy" />
			</button>
		{/if}
	</div>
{/if}
