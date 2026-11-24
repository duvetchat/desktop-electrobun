<script lang="ts">
	import { CircleAlert as AlertIcon, ExternalLink as ExternalLinkIcon, FileText as FileIcon } from "@lucide/svelte";
	import { SvelteSet } from "svelte/reactivity";
	import ComponentSelect from "$lib/components/ComponentSelect.svelte";
	import SpoilerCover from "$lib/components/SpoilerCover.svelte";
	import { webUrl } from "$lib/urls";
	import { FetchError, getApiError } from "$lib/api/api";
	import type { ComponentUse } from "$lib/api/interactions";
	import { getHostURL } from "$lib/common/common";
	import { t } from "$lib/i18n";
	import { renderEmoji } from "$lib/emoji";
	import { messageTextClass } from "$lib/message-styles";
	import { CUSTOM_EMOJI_CLASS } from "$lib/emoji-retry";
	import { emojiImageUrl, renderMarkdown, type CustomEmojiMap } from "$lib/markdown";
	import { roomNames } from "$lib/stores.svelte";
	import { formatFileSize } from "$lib/i18n/format";
	import {
		ButtonStyle,
		ComponentType,
		type Component,
		type ComponentEmoji,
		type ComponentMedia,
		type GalleryItem,
		type GatewaySpace,
		type MemberOnSidebar,
	} from "$lib/types";

	// A message's components as the chat draws them, for the message list and the message previews (pins,
	// search results), which pass compact for smaller media. Link buttons open their url. With onInteract
	// (the message list), the other buttons and the selects send an interaction and wait for the bot; the
	// previews send none. data-attachments marks the media and the controls, so a click on them can be
	// told from a click on the message.
	let {
		components,
		space = null,
		members = [],
		mentionMap = {},
		customEmojiMap = {},
		onPreview,
		onInteract,
		compact = false,
	}: {
		components: Component[];
		space?: GatewaySpace | null;
		members?: MemberOnSidebar[];
		mentionMap?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
		onPreview: (src: string, alt?: string) => void;
		onInteract?: (use: ComponentUse) => Promise<unknown>;
		compact?: boolean;
	} = $props();

	const host = getHostURL();
	const maxWidth = $derived(compact ? 320 : 550);
	const maxHeight = $derived(compact ? 240 : 350);
	// The spoilers a click revealed, by the component or gallery item they hide.
	const revealed = new SvelteSet<object>();
	// The components waiting on the bot's first response, by custom_id, and why the last interaction failed.
	const pending = new SvelteSet<string>();
	let failure = $state<{ text: string; detail: string } | null>(null);

	// Sends c's interaction (a select's with its values) and waits for the bot's first response, 3 seconds
	// at most: the API answers 504 past them.
	async function interact(c: Component, values?: string[]) {
		const id = c.custom_id;
		if (!onInteract || !id || pending.has(id)) return;
		pending.add(id);
		failure = null;
		try {
			await onInteract({ custom_id: id, component_type: c.type, values });
		} catch (err) {
			const text =
				err instanceof FetchError && err.response?.status === 504
					? t("chat_interaction_no_response")
					: t("chat_interaction_failed");
			failure = { text, detail: getApiError(err, text) };
		} finally {
			pending.delete(id);
		}
	}

	const selectTypes: number[] = [
		ComponentType.StringSelect,
		ComponentType.UserSelect,
		ComponentType.RoleSelect,
		ComponentType.MentionableSelect,
		ComponentType.RoomSelect,
	];

	const buttonColors: Record<number, string> = {
		// The colored ones keep white text in light too; the gray ones' text turns over with their gray.
		[ButtonStyle.Primary]: "bg-duvet-accent text-duvet-on-accent shadow-duvet-control hover:brightness-[1.06]",
		[ButtonStyle.Secondary]: "bg-duvet-secondary-fill text-duvet-accent-text hover:brightness-[1.06]",
		[ButtonStyle.Success]: "bg-duvet-alive text-duvet-on-alive shadow-duvet-control hover:brightness-[1.06]",
		[ButtonStyle.Danger]: "bg-duvet-danger text-duvet-on-danger shadow-duvet-control hover:brightness-[1.06]",
		[ButtonStyle.Link]: "bg-duvet-secondary-fill text-duvet-accent-text hover:brightness-[1.06]",
	};

	// Only http(s) urls become links and media, whatever a bot sends (the API checks them too).
	// A file sent with the message comes as a signed path on the API's host; any other media is a full url.
	const mediaSrc = (m: ComponentMedia) => (m.url.startsWith("/") ? host + m.url : (webUrl(m.url) ?? ""));
	const isVideo = (m: ComponentMedia) =>
		m.content_type ? m.content_type.startsWith("video/") : /\.(mp4|webm|mov)$/i.test(m.url.split("?")[0]!);
	const hex = (color: number) => "#" + color.toString(16).padStart(6, "0");

	// A lone gallery item fits in maxWidth × maxHeight like an attachment, when its size is known.
	function fit(m: ComponentMedia): { w: number; h: number } | null {
		if (!m.width || !m.height) return null;
		const scale = Math.min(maxWidth / m.width, maxHeight / m.height, 1);
		return { w: Math.round(m.width * scale), h: Math.round(m.height * scale) };
	}

	// A gallery's rows of up to three: the first row takes what's left over the threes, and four go two by two.
	function mosaicRows(count: number): number[] {
		if (count === 4) return [2, 2];
		const first = count % 3 || 3;
		return [first, ...Array<number>((count - first) / 3).fill(3)];
	}
</script>

<div class="flex max-w-150 min-w-0 flex-col gap-2">
	{#each components as component}
		{@render node(component)}
	{/each}
	{#if failure}
		<p role="alert" class="text-duvet-danger flex items-center gap-1.5 text-sm" title={failure.detail}>
			<AlertIcon class="size-4 shrink-0" />
			{failure.text}
		</p>
	{/if}
</div>

{#snippet node(c: Component)}
	{#if c.type === ComponentType.Container}
		{@const hidden = !!c.spoiler && !revealed.has(c)}
		<div
			class="bg-duvet-card shadow-duvet-raised relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl px-3.5 py-3"
		>
			{#if c.accent_color != null}
				<!-- Its accent colour, as a bar down its left edge, inside its round corners -->
				<span class="absolute inset-y-0 left-0 w-[3px]" style="background: {hex(c.accent_color)}" aria-hidden="true"
				></span>
			{/if}
			<div class="flex min-w-0 flex-col gap-2 {hidden ? 'pointer-events-none blur-lg select-none' : ''}" inert={hidden}>
				{#each c.components ?? [] as child}
					{@render node(child)}
				{/each}
			</div>
			{#if hidden}
				<SpoilerCover onReveal={() => revealed.add(c)} />
			{/if}
		</div>
	{:else if c.type === ComponentType.ActionRow}
		<div data-attachments class="flex flex-wrap gap-2">
			{#each c.components ?? [] as child}
				{@render node(child)}
			{/each}
		</div>
	{:else if c.type === ComponentType.Section}
		<div class="flex min-w-0 gap-4">
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				{#each c.components ?? [] as child}
					{@render node(child)}
				{/each}
			</div>
			{#if c.accessory?.type === ComponentType.Thumbnail}
				{@render thumbnail(c.accessory)}
			{:else if c.accessory}
				<div data-attachments class="shrink-0 self-center">
					{@render node(c.accessory)}
				</div>
			{/if}
		</div>
	{:else if c.type === ComponentType.TextDisplay}
		<div class="font-content min-w-0 text-[15px] leading-[1.4] wrap-break-word select-text {messageTextClass()}">
			{@html renderMarkdown(c.content ?? "", false, mentionMap, customEmojiMap, $roomNames, {})}
		</div>
	{:else if c.type === ComponentType.Thumbnail}
		{@render thumbnail(c)}
	{:else if c.type === ComponentType.MediaGallery}
		{@render gallery(c.items ?? [])}
	{:else if c.type === ComponentType.File && c.file}
		{@const hidden = !!c.spoiler && !revealed.has(c)}
		<div data-attachments class="relative w-[300px] max-w-full overflow-hidden rounded-2xl">
			<a
				href={mediaSrc(c.file)}
				target="_blank"
				rel="noopener noreferrer"
				class="group bg-duvet-secondary-fill text-duvet-ink flex items-center gap-2.5 rounded-2xl p-2.5 no-underline {hidden
					? 'blur-md'
					: ''}"
			>
				<FileIcon class="text-duvet-accent-text size-6 shrink-0" />
				<span class="flex min-w-0 flex-col">
					<span class="text-duvet-ink truncate text-[13.5px] font-semibold group-hover:underline"
						>{c.name ?? t("chat_file_unnamed")}</span
					>
					{#if c.size != null}
						<span class="text-duvet-ink2 text-xs">{formatFileSize(c.size)}</span>
					{/if}
				</span>
			</a>
			{#if hidden}
				<SpoilerCover onReveal={() => revealed.add(c)} />
			{/if}
		</div>
	{:else if c.type === ComponentType.Separator}
		<div role="separator" class={c.spacing === 2 ? "py-2" : ""}>
			{#if c.divider !== false}
				<div class="bg-duvet-line h-px w-full"></div>
			{/if}
		</div>
	{:else if c.type === ComponentType.Button}
		{@render button(c)}
	{:else if selectTypes.includes(c.type)}
		<ComponentSelect
			component={c}
			{space}
			{members}
			{emoji}
			waiting={!!c.custom_id && pending.has(c.custom_id)}
			onSubmit={onInteract ? (values) => interact(c, values) : undefined}
		/>
	{/if}
{/snippet}

{#snippet button(c: Component)}
	{@const cls = `inline-flex h-[34px] max-w-full min-w-15 items-center justify-center gap-1.5 rounded-[11px] px-3.5 text-[13px] font-medium no-underline transition-[filter,background-color] disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none ${buttonColors[c.style ?? ButtonStyle.Secondary] ?? buttonColors[ButtonStyle.Secondary]}`}
	{@const href = webUrl(c.url)}
	{#if c.style === ButtonStyle.Link && href && !c.disabled}
		<a {href} target="_blank" rel="noopener noreferrer" class={cls}>
			{@render emoji(c.emoji)}
			{#if c.label}<span class="truncate">{c.label}</span>{/if}
			<ExternalLinkIcon class="size-3.5 shrink-0 opacity-80" />
		</a>
	{:else}
		{@const waiting = !!c.custom_id && pending.has(c.custom_id)}
		<button
			type="button"
			class="relative {cls}"
			disabled={c.disabled}
			aria-busy={waiting}
			onclick={onInteract && c.style !== ButtonStyle.Link ? () => interact(c) : undefined}
		>
			<span class="inline-flex min-w-0 items-center gap-1.5 {waiting ? 'invisible' : ''}">
				{@render emoji(c.emoji)}
				{#if c.label}<span class="truncate">{c.label}</span>{/if}
				{#if c.style === ButtonStyle.Link}
					<ExternalLinkIcon class="size-3.5 shrink-0 opacity-80" />
				{/if}
			</span>
			{#if waiting}
				<!-- Waiting on the bot, as the typing indicator's dots -->
				<span class="absolute inset-0 flex items-center justify-center gap-1" aria-hidden="true">
					<span class="animate-typing-bounce block size-1.5 rounded-full bg-current"></span>
					<span class="animate-typing-bounce block size-1.5 rounded-full bg-current [animation-delay:0.2s]"></span>
					<span class="animate-typing-bounce block size-1.5 rounded-full bg-current [animation-delay:0.4s]"></span>
				</span>
			{/if}
		</button>
	{/if}
{/snippet}

{#snippet emoji(e: ComponentEmoji | undefined)}
	{#if e?.id}
		{@const custom = customEmojiMap[e.id]}
		{@const elsewhere = custom ? null : emojiImageUrl(e.id)}
		{#if custom}
			<img
				src="{host}/attachments/{custom.attachment_id}"
				alt=":{custom.name}:"
				title=":{custom.name}:"
				class="size-5 shrink-0 object-contain"
				draggable="false"
			/>
		{:else if elsewhere}
			<!-- A custom emoji of a Space the user isn't in: its image from the API, named as the bot named it. -->
			<img
				src={elsewhere}
				alt=":{e.name ?? t('chat_emoji_unknown')}:"
				title=":{e.name ?? t('chat_emoji_unknown')}:"
				data-emoji-unnamed={e.name === undefined ? "" : undefined}
				class="size-5 shrink-0 object-contain {CUSTOM_EMOJI_CLASS}"
				draggable="false"
			/>
		{/if}
	{:else if e?.name}
		<span class="shrink-0">{@html renderEmoji(e.name)}</span>
	{/if}
{/snippet}

{#snippet thumbnail(c: Component)}
	{#if c.media}
		{@const media = c.media}
		{@const hidden = !!c.spoiler && !revealed.has(c)}
		<div
			data-attachments
			class="relative shrink-0 self-start overflow-hidden rounded-xl {compact ? 'size-16' : 'size-21'}"
		>
			<button
				type="button"
				class="block size-full cursor-zoom-in"
				aria-label={c.description ? undefined : t("chat_open_image")}
				onclick={() => onPreview(mediaSrc(media), c.description)}
			>
				<img
					src={mediaSrc(media)}
					alt={c.description ?? ""}
					title={c.description}
					class="size-full object-cover {hidden ? 'blur-xl' : ''}"
					loading="lazy"
				/>
			</button>
			{#if hidden}
				<SpoilerCover onReveal={() => revealed.add(c)} />
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet gallery(items: GalleryItem[])}
	{#if items.length === 1}
		<div data-attachments class="flex">
			{@render galleryItem(items[0]!, true)}
		</div>
	{:else if items.length === 3}
		<div data-attachments class="grid aspect-3/2 w-full grid-cols-3 grid-rows-2 gap-1" style="max-width: {maxWidth}px;">
			<div class="col-span-2 row-span-2">{@render galleryItem(items[0]!)}</div>
			{@render galleryItem(items[1]!)}
			{@render galleryItem(items[2]!)}
		</div>
	{:else if items.length > 1}
		{@const rows = mosaicRows(items.length)}
		<div data-attachments class="flex w-full flex-col gap-1" style="max-width: {maxWidth}px;">
			{#each rows as size, r}
				{@const start = rows.slice(0, r).reduce((a, b) => a + b, 0)}
				<div class="flex gap-1">
					{#each items.slice(start, start + size) as item}
						<div class="min-w-0 flex-1 {size === 1 ? 'aspect-video' : 'aspect-square'}">
							{@render galleryItem(item)}
						</div>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

<!-- A gallery item: alone, at its size scaled into maxWidth × maxHeight (or within it, when unknown); in a
     mosaic, filling its cell. -->
{#snippet galleryItem(item: GalleryItem, alone = false)}
	{@const hidden = !!item.spoiler && !revealed.has(item)}
	{@const src = mediaSrc(item.media)}
	{@const size = alone ? fit(item.media) : null}
	{@const bounds = alone && !size ? `max-width: min(${maxWidth}px, 100%); max-height: ${maxHeight}px;` : ""}
	<div
		class="relative overflow-hidden rounded-xl {alone ? '' : 'size-full'}"
		style={size ? `width: ${size.w}px; aspect-ratio: ${size.w} / ${size.h}; max-width: 100%;` : ""}
	>
		{#if isVideo(item.media)}
			<!-- A video of another host (the API's proxy of it) is asked for only when it's played, as that host sees
			     each request; a file the message carries (a path) loads as before. -->
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				{src}
				preload={item.media.url.startsWith("/") ? undefined : "none"}
				controls
				class="bg-black {alone ? 'object-contain' : 'object-cover'} {size || !alone ? 'size-full' : ''} {hidden
					? 'blur-xl'
					: ''}"
				style={bounds}
			></video>
		{:else}
			<button
				type="button"
				class="block cursor-zoom-in {size || !alone ? 'size-full' : ''}"
				aria-label={item.description ? undefined : t("chat_open_image")}
				onclick={() => onPreview(src, item.description)}
			>
				<img
					{src}
					alt={item.description ?? ""}
					title={item.description}
					class="{alone ? 'object-contain' : 'object-cover'} {size || !alone ? 'size-full' : ''} {hidden
						? 'blur-xl'
						: ''}"
					style={bounds}
					loading="lazy"
				/>
			</button>
		{/if}
		{#if hidden}
			<SpoilerCover onReveal={() => revealed.add(item)} />
		{/if}
	</div>
{/snippet}
