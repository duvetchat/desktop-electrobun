<script lang="ts">
    import { computeRoomPermissions, Permission } from "$lib/permissions";
    import { onDestroy, onMount } from "svelte";
    import { updateMessage, deleteMessage } from "$lib/api/messages";
    import { currentUser } from "$lib/stores.svelte";
    import { renderEmoji, isOnlyEmojis, countEmojis } from "$lib/emoji";

    import type { MemberOnSidebar, GatewaySpace, Message } from "$lib/types";

    import InstagramEmbed from "$lib/components/InstagramEmbed.svelte";
    import YoutubeEmbed from "$lib/components/YoutubeEmbed.svelte";
    import TwitterEmbed from "$lib/components/TwitterEmbed.svelte";
    import UrlEmbed from "$lib/components/UrlEmbed.svelte";
    import InviteEmbed from "$lib/components/InviteEmbed.svelte";
    import UserAvatar from "$lib/components/UserAvatar.svelte";
    import ChatInput from "$lib/components/ChatInput.svelte";

    let {
        messages,
        members = [],
        channelId = "",
        space = null,
        isInitialLoading = false,
        isLoadingMore = false,
        hasMoreMessages = true,
        onLoadMore = () => {},
        onRetry = () => {},
        onDismiss = () => {},
        onSaveEdit = undefined,
        onDeleteMsg = undefined,
        failedNonces = new Set<string>(),
        editingMessageId = $bindable<string | null>(null),
        editContent = $bindable(""),
    }: {
        messages: Message[];
        members?: MemberOnSidebar[];
        channelId?: string;
        space?: GatewaySpace | null;
        isInitialLoading?: boolean;
        isLoadingMore?: boolean;
        hasMoreMessages?: boolean;
        onLoadMore?: () => Promise<void> | void;
        onRetry?: (message: Message) => void;
        onDismiss?: (nonce: string) => void;
        onSaveEdit?: (messageId: string, content: string) => Promise<void> | void;
        onDeleteMsg?: (messageId: string) => Promise<void> | void;
        failedNonces?: Set<string>;
        editingMessageId?: string | null;
        editContent?: string;
    } = $props();

    // ── State ──────────────────────────────────────────────────────────────────
    let scrollEl: HTMLElement;
    let deletingMessageId = $state<string | null>(null);
    let now = $state(Date.now());
    let intervalId: number;
    const locale =
        typeof navigator !== "undefined" ? navigator.language : "en-US";
    const dateFormatter = new Intl.DateTimeFormat(locale, {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
    const relativeFormatter = new Intl.RelativeTimeFormat(locale, {
        numeric: "auto",
    });

    // ── Load-more on scroll ───────────────────────────────────────────────────
    // Uses getBoundingClientRect() — works with flex-col-reverse + negative
    // scrollTop (WebView2 confirmed). Completely direction-agnostic.
    function handleScroll() {
        if (!scrollEl || isLoadingMore || !hasMoreMessages) {
            return;
        }
        const sentinel = scrollEl.querySelector("[data-sentinel]");
        if (!sentinel) {
            return;
        }
        const scrollRect = scrollEl.getBoundingClientRect();
        const sentinelRect = sentinel.getBoundingClientRect();
        const visible =
            sentinelRect.top < scrollRect.bottom &&
            sentinelRect.bottom > scrollRect.top;
        if (visible) {
            void onLoadMore();
        }
    }

    function topObserverAction(_node: HTMLElement) {
        return { destroy() {} };
    }

    onMount(() => {
        intervalId = window.setInterval(() => {
            now = Date.now();
        }, 30_000);
    });

    onDestroy(() => {
        if (typeof window === "undefined") return;
        if (intervalId) {
            window.clearInterval(intervalId);
        }
    });

    // ── Sorting ────────────────────────────────────────────────────────────────
    const sortedMessages = $derived(
        messages
            .map((m, i) => ({ m, i }))
            .sort((a, b) => {
                const aPending = a.m.id === a.m.nonce;
                const bPending = b.m.id === b.m.nonce;
                if (aPending !== bPending) {
                    return aPending ? -1 : 1;
                }
                if (aPending && bPending) {
                    return b.i - a.i;
                }
                return (
                    new Date(b.m.created_at).getTime() -
                    new Date(a.m.created_at).getTime()
                );
            })
            .map(({ m }) => m),
    );

    const authorColors = $derived(buildAuthorColorMap(members));

    // ── Formatting ─────────────────────────────────────────────────────────────
    function isSameCalendarDay(a: string, b: string): boolean {
        const da = new Date(a);
        const db = new Date(b);
        return (
            da.getFullYear() === db.getFullYear() &&
            da.getMonth() === db.getMonth() &&
            da.getDate() === db.getDate()
        );
    }

    function formatDateSeparator(dateStr: string): string {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (isSameCalendarDay(dateStr, today.toISOString())) {
            return "Today";
        }
        if (isSameCalendarDay(dateStr, yesterday.toISOString())) {
            return "Yesterday";
        }
        return dateFormatter.format(date);
    }

    function formatTimestamp(dateStr: string, _now: number) {
        const then = new Date(dateStr).getTime();
        if (Number.isNaN(then)) {
            return "just now";
        }
        const seconds = Math.round((then - _now) / 1000);
        if (Math.abs(seconds) < 45) {
            return "just now";
        }
        const minutes = Math.round(seconds / 60);
        if (Math.abs(minutes) < 60) {
            return relativeFormatter.format(minutes, "minute");
        }
        const hours = Math.round(minutes / 60);
        if (Math.abs(hours) < 24) {
            return relativeFormatter.format(hours, "hour");
        }
        const days = Math.round(hours / 24);
        if (Math.abs(days) < 7) {
            return relativeFormatter.format(days, "day");
        }
        return relativeFormatter.format(Math.round(days / 7), "week");
    }

    function intToHex(n: undefined | number | null): string {
        if (n == null) {
            return "";
        }
        return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
    }

    function getMemberColorStyle(member: MemberOnSidebar): string {
        const highest = [...member.roles]
            .filter((r) => r.color_from != null)
            .sort((a, b) => b.position - a.position)
            .at(0);
        if (!highest) {
            return "color: var(--color-zinc-100)";
        }
        const from = intToHex(highest.color_from);
        if (highest.color_to == null) {
            return `color: ${from}`;
        }
        const to = intToHex(highest.color_to);
        const via =
            highest.color_via != null ? `, ${intToHex(highest.color_via)}` : "";
        return `background: linear-gradient(90deg, ${from}${via}, ${to}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;`;
    }

    function buildAuthorColorMap(members: MemberOnSidebar[]) {
        return members.reduce<Record<string, string>>((map, member) => {
            map[member.username] = getMemberColorStyle(member);
            return map;
        }, {});
    }

    // ── URL processing ─────────────────────────────────────────────────────────
    const urlRegex = /(https?:\/\/[^\s]+)/g;

    function processMessageContent(content: string) {
        const urls = content.match(urlRegex) || [];
        const images: string[] = [];
        const otherLinks: string[] = [];
        const youtubeVideos: string[] = [];
        const twitterLinks: string[] = [];
        const instagramLinks: string[] = [];
        const inviteCodes: string[] = [];

        urls.forEach((url) => {
            try {
                const parsed = new URL(url);
                const inviteMatch = /^\/invite\/([^/]+)$/.exec(parsed.pathname);
                if (inviteMatch) {
                    inviteCodes.push(inviteMatch[1]);
                    return;
                }
                let youtubeId = null;
                if (
                    parsed.hostname.includes("youtube.com") &&
                    parsed.pathname === "/watch"
                ) {
                    youtubeId = parsed.searchParams.get("v");
                } else if (parsed.hostname === "youtu.be") {
                    youtubeId = parsed.pathname.slice(1);
                }

                if (youtubeId) {
                    youtubeVideos.push(youtubeId);
                } else if (
                    /^(www\.)?(twitter\.com|x\.com|fixupx\.com|fxtwitter\.com|vxtwitter\.com)$/i.exec(
                        parsed.hostname,
                    ) &&
                    parsed.pathname.includes("/status/")
                ) {
                    twitterLinks.push(url);
                } else if (
                    /^(www\.)?(instagram|kkinstagram|vxinstagram)\.com$/i.exec(
                        parsed.hostname,
                    ) &&
                    (parsed.pathname.includes("/p/") ||
                        parsed.pathname.includes("/reel/"))
                ) {
                    instagramLinks.push(url);
                } else if (
                    /\.(jpeg|jpg|gif|png|webp)$/i.exec(parsed.pathname) ||
                    parsed.hostname.includes("tenor.com") ||
                    parsed.hostname.includes("giphy.com")
                ) {
                    images.push(url);
                } else {
                    otherLinks.push(url);
                }
            } catch {
                // Invalid URL, ignore
            }
        });

        return {
            text: content,
            images,
            otherLinks,
            youtubeVideos,
            twitterLinks,
            instagramLinks,
            inviteCodes,
        };
    }

    function parseTextSegments(text: string) {
        const segments: { type: "text" | "link"; content: string }[] = [];
        let lastIndex = 0;
        urlRegex.lastIndex = 0;
        let match;
        while ((match = urlRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                segments.push({
                    type: "text",
                    content: text.slice(lastIndex, match.index),
                });
            }
            segments.push({ type: "link", content: match.at(0) ?? "" });
            lastIndex = urlRegex.lastIndex;
        }
        if (lastIndex < text.length) {
            segments.push({ type: "text", content: text.slice(lastIndex) });
        }
        return segments;
    }

    // ── Message actions ────────────────────────────────────────────────────────
    function startEdit(message: Message) {
        editingMessageId = message.id;
        editContent = message.content;
    }

    function cancelEdit() {
        editingMessageId = null;
        editContent = "";
    }

    function saveEdit(messageId: string, content: string) {
        const original = messages.find((m) => m.id === messageId)?.content;
        const trimmed = content.trim();
        if (trimmed && trimmed !== original) {
            if (onSaveEdit) {
                Promise.resolve(onSaveEdit(messageId, trimmed)).catch(console.error);
            } else {
                updateMessage(messageId, trimmed, channelId).catch(console.error);
            }
        }
        cancelEdit();
    }

    function handleCopy(e: ClipboardEvent) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const fragment = selection.getRangeAt(0).cloneContents();
        function extractText(node: Node): string {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
            if (node.nodeName === "IMG") return (node as HTMLImageElement).alt ?? "";
            return Array.from(node.childNodes).map(extractText).join("");
        }
        const text = extractText(fragment);
        e.clipboardData?.setData("text/plain", text);
        e.preventDefault();
    }

    async function handleDelete(messageId: string) {
        deletingMessageId = messageId;
        try {
            if (onDeleteMsg) {
                await onDeleteMsg(messageId);
            } else {
                await deleteMessage(messageId, channelId);
            }
        } catch (e) {
            console.error(e);
        } finally {
            deletingMessageId = null;
        }
    }

    function currentUserCanManageMessages(): boolean {
        if (!$currentUser || !space) {
            return false;
        }
        if ($currentUser.id === space.owner_id) {
            return true;
        }
        const room = space.rooms.find((r) => r.id === channelId);
        if (!room) {
            return false;
        }
        try {
            const perms = computeRoomPermissions(space, room);
            return (
                (perms & Permission.ManageMessages) ===
                Permission.ManageMessages
            );
        } catch {
            return false;
        }
    }
</script>

<div
    bind:this={scrollEl}
    class="flex flex-1 flex-col-reverse overflow-x-clip overflow-y-auto px-4 py-2"
    onscroll={handleScroll}
    oncopy={handleCopy}
>
    {#if isInitialLoading}
        <div class="flex flex-col-reverse gap-4 pb-2">
            {#each { length: 6 } as _, i}
                {@const wide = i % 3 === 0}
                <div class="flex items-start gap-3 px-4 -mx-4 mt-4">
                    <div
                        class="size-10 shrink-0 rounded-full bg-zinc-700 animate-pulse"
                    ></div>
                    <div class="flex flex-col gap-2 flex-1">
                        <div
                            class="h-3 w-24 rounded bg-zinc-700 animate-pulse"
                        ></div>
                        <div
                            class="h-3 {wide
                                ? 'w-4/5'
                                : 'w-2/5'} rounded bg-zinc-700 animate-pulse"
                        ></div>
                        {#if wide}
                            <div
                                class="h-3 w-3/5 rounded bg-zinc-700 animate-pulse"
                            ></div>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {:else if messages.length === 0}
        <div class="text-zinc-400 italic text-center py-4 mb-5">
            No messages yet. Send the first message.
        </div>
    {:else}
        {#each sortedMessages as message, i (message.id)}
            {@const chronoPrev = sortedMessages.at(i + 1)}
            {@const isConsecutive =
                chronoPrev &&
                chronoPrev.author_name === message.author_name &&
                new Date(message.created_at).getTime() -
                    new Date(chronoPrev.created_at).getTime() <=
                    5 * 60 * 1_000}
            {@const showHeader = !isConsecutive}
            {@const isLast = i === 0}
            {@const isDifferentDay =
                !chronoPrev ||
                !isSameCalendarDay(message.created_at, chronoPrev.created_at)}
            {@const isPending = message.id === message.nonce}
            {@const isFailed =
                isPending && failedNonces.has(message.nonce ?? "")}
            {@const emojiOnly =
                isOnlyEmojis(message.content) &&
                countEmojis(message.content) <= 5 &&
                processMessageContent(message.content).images.length === 0 &&
                processMessageContent(message.content).youtubeVideos.length ===
                    0}

            <div
                class="group relative flex items-start rounded-md px-3 {isLast
                    ? 'mb-3'
                    : 'mb-1'} {showHeader ? 'mt-4' : 'mt-0'} {isFailed
                    ? 'bg-red-500/10 hover:bg-red-500/15'
                    : 'hover:bg-zinc-800/55'} -mx-3"
                style={isFailed
                    ? ""
                    : isPending
                      ? "opacity: 0.5; pointer-events: none;"
                      : ""}
            >
                {#if showHeader}
                    <UserAvatar
                        src={message.author_avatar_url}
                        name={message.author_name}
                        size={40}
                        class="mr-3 mt-0.5 shrink-0"
                    />
                {:else}
                    <div class="w-10 mr-3 text-right shrink-0">
                        <span
                            class="text-xxs text-zinc-500 opacity-0 group-hover:opacity-100 select-none whitespace-nowrap leading-5"
                        >
                            {new Date(message.created_at).toLocaleTimeString(
                                locale,
                                { hour: "2-digit", minute: "2-digit" },
                            )}
                        </span>
                    </div>
                {/if}

                <div class="flex flex-col flex-1 min-w-0">
                    {#if showHeader}
                        <div class="flex items-center mb-0.5">
                            <span
                                class="font-semibold mr-2 hover:underline cursor-pointer"
                                style={authorColors[message.author_name] ||
                                    "color: var(--color-zinc-100)"}
                            >
                                {message.author_name}
                            </span>
                            <span class="text-xs text-zinc-400 font-medium"
                                >{formatTimestamp(
                                    message.created_at,
                                    now,
                                )}</span
                            >
                        </div>
                    {/if}

                    {#if editingMessageId === message.id}
                        <div class="w-full relative flex flex-col gap-1">
                            <ChatInput
                                initialValue={editContent}
                                onValueChange={(text) => { editContent = text; }}
                                onSubmit={(text) => saveEdit(message.id, text)}
                                onCancel={cancelEdit}
                                showActions={false}
                                autofocus
                            />
                            <div class="text-xxs text-zinc-400">
                                escape to <button
                                    type="button"
                                    class="text-stone-300 cursor-pointer hover:underline"
                                    onclick={cancelEdit}>cancel</button
                                >
                                • enter to
                                <button
                                    type="button"
                                    class="text-stone-300 cursor-pointer hover:underline"
                                    onclick={() => saveEdit(message.id, editContent)}>save</button
                                >
                            </div>
                        </div>
                    {:else}
                        {@const processed = processMessageContent(
                            message.content,
                        )}
                        <div
                            role="textbox"
                            aria-readonly="true"
                            tabindex="-1"
                            class="{isFailed
                                ? 'text-red-400'
                                : 'text-zinc-200'} {emojiOnly
                                ? ''
                                : showHeader
                                  ? ''
                                  : 'leading-5'} whitespace-pre-wrap wrap-break-word pr-12 select-text cursor-text text-left"
                            style={emojiOnly ? 'line-height: 3rem' : ''}
                            onclick={(e) => {
                                if (
                                    e.detail === 3 &&
                                    $currentUser &&
                                    message.author_id === $currentUser.id
                                ) {
                                    startEdit(message);
                                }
                            }}
                            onkeydown={(e) => {
                                if (
                                    e.key === "Enter" &&
                                    $currentUser &&
                                    message.author_id === $currentUser.id
                                ) {
                                    startEdit(message);
                                }
                            }}
                        >
                            {#each parseTextSegments(processed.text) as segment}
                                {#if segment.type === "link"}
                                    <a
                                        href={segment.content}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="text-stone-300 hover:underline"
                                        onclick={(e) => {
                                            e.stopPropagation();
                                        }}>{segment.content}</a
                                    >
                                {:else}
                                    {@html renderEmoji(
                                        segment.content,
                                        emojiOnly,
                                    )}
                                {/if}
                            {/each}
                            {#if message.updated_at !== message.created_at}
                                <span class="text-xxs text-zinc-500 ml-1"
                                    >(edited {formatTimestamp(
                                        message.updated_at,
                                        now,
                                    )})</span
                                >
                            {/if}
                        </div>
                        {#if processed.images.length > 0}
                            <div class="mt-1 flex flex-col gap-1">
                                {#each processed.images as imgUrl}
                                    <img
                                        src={imgUrl}
                                        alt="attachment"
                                        class="max-w-100 max-h-100 w-auto h-auto rounded-md object-contain"
                                        loading="lazy"
                                    />
                                {/each}
                            </div>
                        {/if}
                        {#if processed.youtubeVideos.length > 0}
                            <div class="flex flex-col gap-2">
                                {#each processed.youtubeVideos.slice(0, 2) as videoId}
                                    <YoutubeEmbed {videoId} />
                                {/each}
                            </div>
                        {/if}
                        {#if processed.twitterLinks.length > 0}
                            <div class="flex flex-col gap-2 mt-2">
                                {#each processed.twitterLinks.slice(0, 2) as link}
                                    <TwitterEmbed url={link} />
                                {/each}
                            </div>
                        {/if}
                        {#if processed.instagramLinks.length > 0}
                            <div class="flex flex-col gap-2 mt-2">
                                {#each processed.instagramLinks as link}
                                    <InstagramEmbed url={link} />
                                {/each}
                            </div>
                        {/if}
                        {#if processed.inviteCodes.length > 0}
                            <div class="flex flex-col gap-2">
                                {#each processed.inviteCodes as code}
                                    <InviteEmbed {code} />
                                {/each}
                            </div>
                        {/if}
                        {#if processed.otherLinks.length > 0}
                            <div class="flex flex-col gap-2 mt-2">
                                {#each processed.otherLinks.slice(0, 3) as link}
                                    <UrlEmbed url={link} />
                                {/each}
                            </div>
                        {/if}
                    {/if}
                </div>

                <!-- Action toolbar -->
                {#if isFailed}
                    <div
                        class="absolute right-4 -top-3 flex bg-zinc-700 border border-zinc-800 rounded shadow-sm overflow-hidden z-10"
                    >
                        <button
                            class="px-2 py-1.5 text-xs text-stone-300 hover:bg-zinc-600 transition-colors"
                            onclick={() => onRetry(message)}>Retry</button
                        >
                        <div class="w-px bg-zinc-800"></div>
                        <button
                            class="px-2 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-600 transition-colors"
                            onclick={() => onDismiss(message.nonce!)}
                            >Dismiss</button
                        >
                    </div>
                {:else if $currentUser && message.author_id === $currentUser.id && editingMessageId !== message.id}
                    <div
                        class="absolute right-2 -top-3 z-10 hidden overflow-hidden rounded border border-zinc-800 bg-zinc-700 shadow-sm transition-opacity group-hover:flex"
                    >
                        <button
                            class="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-600 transition-colors"
                            onclick={() => {
                                startEdit(message);
                            }}
                            title="Edit message"
                            aria-label="Edit message"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><path
                                    d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
                                /><path d="m15 5 4 4" /></svg
                            >
                        </button>
                        <div class="w-px bg-zinc-800"></div>
                        <button
                            class="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            onclick={() => handleDelete(message.id)}
                            disabled={deletingMessageId === message.id}
                            title="Delete message"
                            aria-label="Delete message"
                        >
                            {#if deletingMessageId === message.id}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="animate-spin"
                                    ><path
                                        d="M21 12a9 9 0 1 1-6.219-8.56"
                                    /></svg
                                >
                            {:else}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    ><path d="M3 6h18" /><path
                                        d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
                                    /><path
                                        d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
                                    /><line
                                        x1="10"
                                        x2="10"
                                        y1="11"
                                        y2="17"
                                    /><line
                                        x1="14"
                                        x2="14"
                                        y1="11"
                                        y2="17"
                                    /></svg
                                >
                            {/if}
                        </button>
                    </div>
                {:else if $currentUser && message.author_id !== $currentUser.id && currentUserCanManageMessages() && editingMessageId !== message.id}
                    <div
                        class="absolute right-2 -top-3 z-10 hidden overflow-hidden rounded border border-zinc-800 bg-zinc-700 shadow-sm transition-opacity group-hover:flex"
                    >
                        <button
                            class="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            onclick={() => handleDelete(message.id)}
                            disabled={deletingMessageId === message.id}
                            title="Delete message"
                            aria-label="Delete message"
                        >
                            {#if deletingMessageId === message.id}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="animate-spin"
                                    ><path
                                        d="M21 12a9 9 0 1 1-6.219-8.56"
                                    /></svg
                                >
                            {:else}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    ><path d="M3 6h18" /><path
                                        d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
                                    /><path
                                        d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
                                    /><line
                                        x1="10"
                                        x2="10"
                                        y1="11"
                                        y2="17"
                                    /><line
                                        x1="14"
                                        x2="14"
                                        y1="11"
                                        y2="17"
                                    /></svg
                                >
                            {/if}
                        </button>
                    </div>
                {/if}
            </div>

            {#if isDifferentDay}
                <div class="flex items-center gap-3 px-2 my-3 select-none">
                    <div class="flex-1 h-px bg-zinc-700"></div>
                    <span
                        class="text-xs text-zinc-500 font-medium whitespace-nowrap"
                    >
                        {formatDateSeparator(message.created_at)}
                    </span>
                    <div class="flex-1 h-px bg-zinc-700"></div>
                </div>
            {/if}
        {/each}

        {#if hasMoreMessages}
            <div
                data-sentinel
                use:topObserverAction
                class="w-full flex justify-center py-4"
            >
                {#if isLoadingMore}
                    <svg
                        class="animate-spin h-5 w-5 text-zinc-400"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            class="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            stroke-width="4"
                        ></circle>
                        <path
                            class="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                    </svg>
                {/if}
            </div>
        {/if}
    {/if}
</div>
