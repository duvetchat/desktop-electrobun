<script lang="ts">
    import { EmbedType, type Embed } from "$lib/types";
    import { getHostURL } from "$lib/common/common";

    let { embed }: { embed: Embed } = $props();

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

{#if embed.type === EmbedType.Gifv || embed.type === EmbedType.Image || (!embed.title && !embed.description && !embed.author && !embed.footer && !embed.fields?.length && (embed.image || embed.video))}
    {#if embed.video}
        <video src={proxyVideoUrl(embed.video.url)} loop muted playsinline controls
               class="mt-1 max-w-xs rounded self-start"></video>
    {:else if embed.image}
        <img src={embed.image.url} alt=""
             class="mt-1 max-w-xs rounded self-start" loading="lazy" />
    {/if}
{:else if embed.title || embed.description || embed.video || embed.image}
    <div
        class="mt-1 flex flex-col max-w-sm rounded-md border-l-4 bg-zinc-800/60 overflow-hidden"
        style="{embedBorderStyle(embed)}"
    >
        {#if embed.author || embed.title || embed.description || embed.fields?.length || embed.footer || embed.thumbnail}
            <div class="px-3 py-2.5 flex gap-3">
                <div class="flex flex-col gap-1 flex-1 min-w-0">
                    {#if embed.author}
                        <div class="flex items-center gap-1.5">
                            {#if embed.author.icon_url}
                                <img src={embed.author.icon_url} alt="" class="w-4 h-4 rounded-full" />
                            {/if}
                            {#if embed.author.url}
                                <a href={embed.author.url} target="_blank" rel="noopener noreferrer"
                                   class="text-xs text-zinc-400 hover:underline truncate">{embed.author.name}</a>
                            {:else}
                                <span class="text-xs text-zinc-400 truncate">{embed.author.name}</span>
                            {/if}
                        </div>
                    {/if}

                    {#if embed.title}
                        {#if embed.url}
                            <a href={embed.url} target="_blank" rel="noopener noreferrer"
                               class="text-sm font-semibold text-stone-300 hover:underline line-clamp-2">{embed.title}</a>
                        {:else}
                            <span class="text-sm font-semibold text-zinc-100 line-clamp-2">{embed.title}</span>
                        {/if}
                    {/if}

                    {#if embed.description}
                        <p class="text-xs text-zinc-400 line-clamp-3 wrap-break-word whitespace-pre-line">{embed.description}</p>
                    {/if}

                    {#if embed.fields && embed.fields.length > 0}
                        <div class="flex flex-wrap gap-x-4 gap-y-1 mt-0.5">
                            {#each embed.fields as field}
                                <div class="flex flex-col min-w-0 {field.inline ? '' : 'w-full'}">
                                    <span class="text-xxs font-semibold text-zinc-400 uppercase tracking-wide">{field.name}</span>
                                    <span class="text-xs text-zinc-300">{field.value}</span>
                                </div>
                            {/each}
                        </div>
                    {/if}

                    {#if embed.footer}
                        <span class="text-xxs text-zinc-500 mt-0.5">{embed.footer.text}</span>
                    {/if}
                </div>

                {#if embed.thumbnail}
                    <img src={embed.thumbnail.url} alt=""
                         class="w-16 h-16 rounded object-cover shrink-0 self-start" loading="lazy" />
                {/if}
            </div>
        {/if}

        {#if embed.video}
            {#if isDirectVideo(embed.video.url)}
                <video
                    src={proxyVideoUrl(embed.video.url)}
                    poster={embed.image?.url ?? embed.thumbnail?.url ?? ""}
                    autoplay
                    loop
                    muted
                    playsinline
                    controls
                    class="max-w-full max-h-72 w-full"
                ></video>
            {:else}
                <div class="aspect-video w-full">
                    <iframe
                        src={embed.video.url}
                        title={embed.title ?? ""}
                        class="w-full h-full"
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowfullscreen
                    ></iframe>
                </div>
            {/if}
        {:else if embed.image}
            {#if embed.url}
                <a href={embed.url} target="_blank" rel="noopener noreferrer" class="block">
                    <img src={embed.image.url} alt=""
                         class="max-w-full max-h-64 object-cover w-full" loading="lazy" />
                </a>
            {:else}
                <img src={embed.image.url} alt=""
                     class="max-w-full max-h-64 object-cover w-full" loading="lazy" />
            {/if}
        {/if}
    </div>
{/if}
