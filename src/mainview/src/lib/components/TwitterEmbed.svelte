<script lang="ts">
import { onMount } from "svelte";

const { url } = $props<{ url: string }>();

let metadata: any = $state(null);
let loading = $state(true);
let errorMessage = $state("");
const numberFormatter = new Intl.NumberFormat(
	typeof navigator !== "undefined" ? navigator.language : "en-US",
);

function formatCount(value: number | undefined | null) {
	return numberFormatter.format(value ?? 0);
}

onMount(() => {
	const controller = new AbortController();
	const timeoutId = window.setTimeout(() => controller.abort(), 8000);
	(async () => {
		try {
		// Extract the relevant path from the URl
		// e.g. https://fixupx.com/nocontextmemes/status/2028393391038267569?s=20
		// -> nocontextmemes/status/2028393391038267569
		const parsed = new URL(url);
		let path = parsed.pathname;
		if (path.startsWith("/")) path = path.slice(1);

		// Fetch metadata

		const res = await fetch(`https://api.vxtwitter.com/${path}`, {
			signal: controller.signal,
		});
		if (!res.ok) throw new Error("Failed to fetch metadata");
		const json = await res.json();

		if (json && json.tweetID) {
			metadata = json;
		} else {
			errorMessage = "Post preview unavailable";
		}
		} catch (err) {
			errorMessage =
				err instanceof DOMException && err.name === "AbortError"
					? "Post preview timed out"
					: "Post preview unavailable";
		} finally {
			window.clearTimeout(timeoutId);
			loading = false;
		}
	})();

	return () => {
		window.clearTimeout(timeoutId);
		controller.abort();
	};
});

function formatText(text: string | undefined | null) {
	if (!text) return "";
	// Remove trailing t.co links if they are the last thing in the text, as vxtwitter adds them
	return text.replace(/https:\/\/t\.co\/[a-zA-Z0-9]+$/, "").trim();
}

function setReferrerPolicy(node: HTMLElement) {
	node.setAttribute("referrerpolicy", "no-referrer");
}
</script>

{#if !loading && !errorMessage && metadata}
	<div class="mt-2 flex max-w-xl flex-col rounded-md border-l-4 border-stone-600 bg-zinc-900 p-4 transition-colors duration-150 hover:bg-zinc-800/90">
        <!-- Author Info -->
        <div class="flex items-center gap-2 mb-2">
            {#if metadata.user_profile_image_url}
                <img
                    src={metadata.user_profile_image_url}
                    alt={metadata.user_name}
                    class="w-5 h-5 rounded-full"
                />
            {/if}
			<a
                href={metadata.tweetURL}
                target="_blank"
                rel="noopener noreferrer"
				class="text-sm font-semibold text-zinc-200 transition-colors hover:text-white hover:underline"
                onclick={(e) => e.stopPropagation()}
            >
                {metadata.user_name}
            </a>
			<span class="text-xs text-zinc-400"
                >@{metadata.user_screen_name}</span
            >
            <span
				class="text-xs text-zinc-400 ml-auto flex items-center gap-1"
            >
                <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    class="w-4 h-4 fill-current"
                    ><g
                        ><path
                            d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 24.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                        ></path></g
                    ></svg
                >
            </span>
        </div>

        <!-- Tweet Text -->
        {#if metadata.text && formatText(metadata.text)}
            <div
				class="text-sm text-zinc-200 mb-2 wrap-break-word whitespace-pre-wrap"
            >
                {formatText(metadata.text)}
            </div>
        {/if}

        <!-- Media -->
        {#if metadata.hasMedia && metadata.media_extended && metadata.media_extended.length > 0}
            <div
				class="mt-2 flex flex-col gap-2 rounded-xl overflow-hidden border border-zinc-700 bg-black max-w-fit"
            >
				{#each metadata.media_extended as media}
					{#if media.type === "video" || media.type === "gif"}
						<video
                            src={media.url.replace(
                                "https://video.twimg.com",
                                "/tw-video",
                            )}
                            controls
                            class="max-h-100 min-h-50 min-w-50 w-full object-contain cursor-pointer relative z-50 pointer-events-auto bg-black rounded-md"
                            poster={media.thumbnail_url}
                            preload="metadata"
							playsinline
							onclick={(e) => e.stopPropagation()}
						>
							<track kind="captions" srclang="en" label="captions" />
						</video>
					{:else if media.type === "image"}
                        <img
                            src={media.url}
                            alt={media.altText || "Tweet image"}
                            class="max-h-100 w-auto object-contain"
                            loading="lazy"
                            referrerpolicy="no-referrer"
                        />
                    {/if}
                {/each}
            </div>
        {/if}

        <!-- Footer Stats -->
        <div
			class="flex items-center gap-4 mt-3 text-xs text-zinc-400 font-medium"
        >
            <div
                class="flex items-center gap-1.5 hover:text-red-500 transition-colors"
            >
                <svg
                    class="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    ><g
                        ><path
                            d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"
                        ></path></g
                    ></svg
                >
				<span>{formatCount(metadata.likes)}</span>
            </div>
            <div
                class="flex items-center gap-1.5 hover:text-stone-300 transition-colors"
            >
                <svg
                    class="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    ><g
                        ><path
                            d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"
                        ></path></g
                    ></svg
                >
				<span>{formatCount(metadata.retweets)}</span>
            </div>
            <div
                class="flex items-center gap-1.5 hover:text-blue-500 transition-colors"
            >
                <svg
                    class="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    ><g
                        ><path
                            d="M1.998 5.5c0-1.38 1.119-2.5 2.5-2.5h15c1.381 0 2.5 1.12 2.5 2.5v13c0 1.38-1.119 2.5-2.5 2.5h-15c-1.381 0-2.5-1.12-2.5-2.5v-13zm2.5-.5c-.276 0-.5.22-.5.5v13c0 .28.224.5.5.5h15c.276 0 .5-.22.5-.5v-13c0-.28-.224-.5-.5-.5h-15zM8.5 15h7v-2h-7v2zm0-4h7V9h-7v2z"
                        ></path></g
                    ></svg
                >
				<span>{formatCount(metadata.replies)}</span>
			</div>
		</div>
	</div>
{:else if !loading}
	<div class="mt-2 max-w-xl rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300">
		<p>{errorMessage || "Post preview unavailable"}. <a href={url} target="_blank" rel="noopener noreferrer" class="text-stone-300 hover:underline">Open post</a>.</p>
	</div>
{/if}
