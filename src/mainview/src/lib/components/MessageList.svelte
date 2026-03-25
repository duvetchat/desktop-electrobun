<script lang="ts">
    import { computeRoomPermissions, Permission } from "$lib/permissions";
    import { onDestroy, onMount, tick } from "svelte";
    import { updateMessage, deleteMessage, getMessageThread } from "$lib/api/messages";
    import { Dialog } from "bits-ui";
    import { currentUser, jumpToMessageRequest, gatewaySpaces, pageVisible } from "$lib/stores.svelte";
    import { renderEmoji, isOnlyEmojis, countEmojis } from "$lib/emoji";
    import { renderMarkdown } from "$lib/markdown";

    import { gatewayMessageToMessage } from "$lib/types";
    import { MessageType, type MemberOnSidebar, type GatewaySpace, type Message } from "$lib/types";
    import { getHostURL } from "$lib/common/common";

    import InviteEmbed from "$lib/components/InviteEmbed.svelte";
    import MessageLinkEmbed from "$lib/components/MessageLinkEmbed.svelte";
    import EmbedCard from "$lib/components/EmbedCard.svelte";
    import VoiceNotePlayer from "$lib/components/VoiceNotePlayer.svelte";
    import UserAvatar from "$lib/components/UserAvatar.svelte";
    import ChatInput from "$lib/components/ChatInput.svelte";
    import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";

    let {
        messages,
        members = [],
        channelId = "",
        spaceId = "",
        space = null,
        isInitialLoading = false,
        isLoadingMore = false,
        isLoadingMoreBelow = false,
        hasMoreMessages = true,
        hasMoreMessagesBelow = false,
        highlightedMessageId = null,
        unreadAfterMessageId = null,
        onLoadMore = () => {},
        onLoadMoreBelow = () => {},
        onRetry = () => {},
        onDismiss = () => {},
        onReply = undefined,
        onSaveEdit = undefined,
        onDeleteMsg = undefined,
        failedNonces = new Set<string>(),
        editingMessageId = $bindable<string | null>(null),
        editContent = $bindable(""),
        isAtBottom = $bindable(true),
        onUnreadMark = undefined,
    }: {
        messages: Message[];
        members?: MemberOnSidebar[];
        channelId?: string;
        spaceId?: string;
        space?: GatewaySpace | null;
        isInitialLoading?: boolean;
        isLoadingMore?: boolean;
        isLoadingMoreBelow?: boolean;
        hasMoreMessages?: boolean;
        hasMoreMessagesBelow?: boolean;
        highlightedMessageId?: string | null;
        unreadAfterMessageId?: string | null;
        onLoadMore?: () => Promise<void> | void;
        onLoadMoreBelow?: () => Promise<void> | void;
        onRetry?: (message: Message) => void;
        onDismiss?: (nonce: string) => void;
        onReply?: (message: Message) => void;
        onSaveEdit?: (messageId: string, content: string) => Promise<void> | void;
        onDeleteMsg?: (messageId: string) => Promise<void> | void;
        failedNonces?: Set<string>;
        editingMessageId?: string | null;
        editContent?: string;
        isAtBottom?: boolean;
        onUnreadMark?: (messageId: string) => void;
    } = $props();

    // ── State ──────────────────────────────────────────────────────────────────
    let scrollEl: HTMLElement;
    let prevMessageCount = 0;
    // Non-reactive snapshot — updated by handleScroll, read by the new-message
    // effect BEFORE the DOM mutation triggers a synchronous scroll event that
    // would flip isAtBottom to false in flex-col-reverse.
    let wasAtBottom = true;
    // Newest confirmed message ID the user has seen (updated only while at bottom & visible).
    let lastSeenMsgId = "";
    let deletingMessageId = $state<string | null>(null);
    let activePopoverMsgId = $state<string | null>(null);
    let threadModalOpen = $state(false);
    let threadLoading = $state(false);
    let threadError = $state("");
    let threadMessages = $state<Message[]>([]);
    let threadRootMessage = $state<Message | null>(null);
    let now = $state(Date.now());
    let intervalId: number;
    const attachmentHost = getHostURL();

    function formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

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
    // Blocked until the scroll-position sync effect runs after initial render.
    // Without this, the skeleton→messages DOM swap fires a synchronous scroll
    // event that sets isAtBottom=true before scroll-to-unread can run.
    let scrollUnlocked = false;

    function handleScroll() {
        if (!scrollEl) return;

        // In flex-col-reverse, scrollTop=0 means the user is at the visual bottom (newest messages).
        if (scrollUnlocked) {
            const val = scrollEl.scrollTop >= -50;
            if (val !== isAtBottom) console.log("[scroll] isAtBottom:", val, "scrollTop:", scrollEl.scrollTop);
            isAtBottom = val;
            wasAtBottom = val;
        }

        const scrollRect = scrollEl.getBoundingClientRect();

        if (!isLoadingMore && hasMoreMessages) {
            const sentinelTop = scrollEl.querySelector("[data-sentinel-top]");
            if (sentinelTop) {
                const r = sentinelTop.getBoundingClientRect();
                if (r.top < scrollRect.bottom && r.bottom > scrollRect.top) {
                    void onLoadMore();
                }
            }
        }

        if (!isLoadingMoreBelow && hasMoreMessagesBelow) {
            const sentinelBottom = scrollEl.querySelector("[data-sentinel-bottom]");
            if (sentinelBottom) {
                const r = sentinelBottom.getBoundingClientRect();
                if (r.top < scrollRect.bottom && r.bottom > scrollRect.top) {
                    void onLoadMoreBelow();
                }
            }
        }
    }

    function topObserverAction(_node: HTMLElement) {
        return { destroy() {} };
    }

    // ── Scroll to highlighted message ─────────────────────────────────────────
    // tick() espera el parche del DOM de Svelte, pero el browser necesita
    // terminar el layout (especialmente con flex-col-reverse + muchos mensajes).
    // Dos requestAnimationFrame aseguran que el layout esté completo antes de scrollear.
    $effect(() => {
        const id = highlightedMessageId;
        if (!id) return;
        void tick().then(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const el = scrollEl?.querySelector(`[data-message-id="${id}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: "instant", block: "center" });
                    }
                });
            });
        });
    });

    function handleCodeCopy(e: MouseEvent) {
        const btn = (e.target as HTMLElement).closest(".msg-code-copy") as HTMLButtonElement | null;
        if (!btn) return;
        const code = btn.dataset.code;
        if (!code) return;
        navigator.clipboard.writeText(code).then(() => {
            btn.classList.add("copied");
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
            setTimeout(() => {
                btn.classList.remove("copied");
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
            }, 1500);
        });
    }

    onMount(() => {
        intervalId = window.setInterval(() => {
            now = Date.now();
        }, 30_000);
        document.addEventListener("click", handleCodeCopy);
    });

    onDestroy(() => {
        if (typeof window === "undefined") return;
        if (intervalId) {
            window.clearInterval(intervalId);
        }
        document.removeEventListener("click", handleCodeCopy);
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
    const mentionMap = $derived(
        members.reduce<Record<string, string>>((map, m) => {
            map[m.id] = m.username || m.raw_username;
            return map;
        }, {}),
    );

    // ── Unread divider ─────────────────────────────────────────────────────────
    // UUID v7 is lexicographically sortable, so string comparison gives chronological order.
    // unreadDividerIdx = first index in sortedMessages where the message id <= unreadAfterMessageId
    // (i.e. that message is read). All messages before that index are unread.
    const unreadDividerIdx = $derived.by(() => {
        if (!unreadAfterMessageId) return null;
        for (let i = 0; i < sortedMessages.length; i++) {
            if (sortedMessages[i].id <= unreadAfterMessageId) {
                console.log("[divider]", { unreadAfterMessageId, idx: i, count: i, msgId: sortedMessages[i].id, total: sortedMessages.length });
                return i;
            }
        }
        console.log("[divider] all unread", { unreadAfterMessageId, total: sortedMessages.length });
        return sortedMessages.length; // all loaded messages are unread
    });
    const unreadCount = $derived(unreadDividerIdx ?? 0);

    // Track which unread-after IDs we've already scrolled to (survives channel switches)
    const scrolledUnreadIds = new Set<string>();

    // Scroll to the unread divider on first render of unread messages.
    // Reading isInitialLoading ensures re-run when skeleton → messages.
    $effect(() => {
        const id = unreadAfterMessageId;
        const idx = unreadDividerIdx;
        const loading = isInitialLoading;
        const chId = channelId;
        if (loading || !id || !idx || scrolledUnreadIds.has(id)) return;
        void tick().then(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (channelId !== chId) return; // stale rAF
                    const target =
                        scrollEl?.querySelector(`[data-message-id="${id}"]`) ??
                        scrollEl?.querySelector('[data-unread-divider]');
                    if (target) {
                        target.scrollIntoView({ behavior: 'instant', block: 'start' });
                        scrolledUnreadIds.add(id);
                    }
                });
            });
        });
    });

    // Sync isAtBottom with the real scroll position once per channel, AFTER
    // the scroll-to-unread effect above has had a chance to run (same
    // tick→rAF→rAF timing, but defined later so its rAF executes second).
    // This is the ONLY mechanism that sets isAtBottom=true from false (the
    // initial value), which unblocks the ACK effect in PaneView.
    let syncedForChannel = "";
    $effect(() => {
        const chId = channelId;
        const len = sortedMessages.length;
        const loading = isInitialLoading;
        // On ANY channel change (even mid-loading), immediately lock scroll
        // updates and reset isAtBottom. This prevents handleScroll from
        // setting isAtBottom=true with a stale scrollTop during skeleton.
        if (chId !== syncedForChannel) {
            scrollUnlocked = false;
            isAtBottom = false;
        }
        if (loading || len === 0 || chId === syncedForChannel) return;
        syncedForChannel = chId;
        // Wait 3 rAFs: scroll-to-unread uses tick→rAF→rAF (2 frames),
        // so we need one more to read the position AFTER the scroll settled.
        void tick().then(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (channelId !== chId) return;
                        if (scrollEl) {
                            isAtBottom = scrollEl.scrollTop >= -50;
                            wasAtBottom = isAtBottom;
                            console.log("[sync] isAtBottom:", isAtBottom, "scrollTop:", scrollEl.scrollTop);
                        }
                        scrollUnlocked = true;
                    });
                });
            });
        });
    });

    // ── Auto-scroll / unread divider when new messages arrive ──────────────────
    $effect(() => {
        const count = messages.length;
        const visible = $pageVisible;

        // When page becomes visible again, sync scroll state with actual position
        // (it may be stale if messages arrived while the tab was hidden).
        if (visible && scrollEl) {
            const val = scrollEl.scrollTop >= -50;
            wasAtBottom = val;
            isAtBottom = val;
        }

        if (count > prevMessageCount && prevMessageCount > 0) {
            const newest = messages[messages.length - 1];
            const me = $currentUser;
            const isOwnSend = newest && me && newest.author_id === me.id;

            if (isOwnSend) {
                // Always scroll to bottom on own send.
                tick().then(() => { if (scrollEl) scrollEl.scrollTop = 0; });
            } else if (wasAtBottom && visible) {
                // At bottom and page visible — auto-scroll to stay pinned.
                tick().then(() => { if (scrollEl) scrollEl.scrollTop = 0; });
            } else if (lastSeenMsgId) {
                // Scrolled up or page hidden — place the unread divider.
                onUnreadMark?.(lastSeenMsgId);
            }
        }

        // Keep lastSeenMsgId in sync while the user is actively viewing.
        // Update when at bottom AND (page visible OR first initialisation).
        // Without the init path, lastSeenMsgId stays "" and onUnreadMark
        // never fires when the page is hidden before any scroll event.
        if (wasAtBottom && (visible || !lastSeenMsgId)) {
            let newest = "";
            for (const m of messages) {
                if (m.id === m.nonce) continue;
                if (m.id > newest) newest = m.id;
            }
            if (newest) lastSeenMsgId = newest;
        }

        prevMessageCount = count;
    });

    // Reset on channel switch.
    $effect(() => {
        const _chId = channelId;
        prevMessageCount = 0;
        lastSeenMsgId = "";
    });

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

    // ── Message link navigation ────────────────────────────────────────────────
    // Link format: duvet://channels/{spaceId}/{roomId}/{messageId}
    const messageLinkRegex = /^duvet:\/\/channels\/([^/]+)\/([^/]+)\/([^/]+)$/;

    function tryNavigateMessageLink(url: string): boolean {
        const match = messageLinkRegex.exec(url);
        if (!match) return false;
        const [, linkSpaceId, linkRoomId, linkMessageId] = match;
        jumpToMessageRequest.set({
            id: crypto.randomUUID(),
            spaceId: linkSpaceId,
            roomId: linkRoomId,
            messageId: linkMessageId,
        });
        return true;
    }

    function resolveMessageLink(url: string): { spaceName: string; roomName: string; spaceId: string; roomId: string; messageId: string } | null {
        const match = messageLinkRegex.exec(url);
        if (!match) return null;
        const [, linkSpaceId, linkRoomId, linkMessageId] = match;
        const sp = $gatewaySpaces.find((s) => s.id === linkSpaceId);
        const rm = sp?.rooms.find((r) => r.id === linkRoomId);
        return {
            spaceId: linkSpaceId,
            roomId: linkRoomId,
            messageId: linkMessageId,
            spaceName: sp?.name ?? "Unknown server",
            roomName: rm?.name ?? "unknown",
        };
    }

    // ── URL processing ─────────────────────────────────────────────────────────
    const urlRegex = /((?:https?|duvet):\/\/[^\s]+)/g;

    function processMessageContent(content: string) {
        const urls = content.match(urlRegex) || [];
        const inviteCodes: string[] = [];
        const messageLinks: { spaceId: string; roomId: string; messageId: string }[] = [];

        urls.forEach((url) => {
            try {
                const msgLinkMatch = messageLinkRegex.exec(url);
                if (msgLinkMatch) {
                    const [, lSpaceId, lRoomId, lMessageId] = msgLinkMatch;
                    messageLinks.push({ spaceId: lSpaceId, roomId: lRoomId, messageId: lMessageId });
                    return;
                }

                const parsed = new URL(url);
                if (parsed.pathname === "/invite") {
                    const code = parsed.searchParams.get("code");
                    if (code) {
                        inviteCodes.push(code);
                        return;
                    }
                }
            } catch {
                // Invalid URL, ignore
            }
        });

        return { text: content, inviteCodes, messageLinks };
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

    async function openThreadModal(message: Message) {
        threadModalOpen = true;
        threadLoading = true;
        threadError = "";
        threadMessages = [];
        threadRootMessage = message;

        try {
            const thread = await getMessageThread(channelId, message.id);
            threadMessages = thread.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
        } catch (e) {
            threadError = e instanceof Error ? e.message : "Failed to load message thread.";
        } finally {
            threadLoading = false;
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
        <!-- Bottom sentinel: first in DOM → appears at visual bottom in flex-col-reverse.
             Visible when user scrolls to the bottom (newest messages area). -->
        {#if hasMoreMessagesBelow}
            <div
                data-sentinel-bottom
                class="w-full flex flex-col items-center gap-1 py-3"
            >
                {#if isLoadingMoreBelow}
                    <svg
                        class="animate-spin h-5 w-5 text-zinc-400"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                {:else}
                    <span class="text-xs text-zinc-500">Newer messages below</span>
                {/if}
            </div>
        {/if}

        {#each sortedMessages as message, i (message.id)}
            {@const chronoPrev = sortedMessages.at(i + 1)}
            {@const isConsecutive =
                chronoPrev &&
                chronoPrev.author_name === message.author_name &&
                new Date(message.created_at).getTime() -
                    new Date(chronoPrev.created_at).getTime() <=
                    5 * 60 * 1_000}
            {@const showHeader = !isConsecutive || !!message.referenced_message}
            {@const isLast = i === 0}
            {@const isDifferentDay =
                !chronoPrev ||
                !isSameCalendarDay(message.created_at, chronoPrev.created_at)}
            {@const isPending = message.id === message.nonce}
            {@const isFailed =
                isPending && failedNonces.has(message.nonce ?? "")}
            {@const emojiOnly =
                isOnlyEmojis(message.content) &&
                countEmojis(message.content) <= 5}

            {@const isHighlighted = highlightedMessageId === message.id}
            {@const isMention = !!$currentUser && message.author_id !== $currentUser.id && message.content?.includes(`<@${$currentUser.id}>`)}
            {@const msgMember = members.find((m) => m.id === message.author_id)}
            <div
                data-message-id={message.id}
                class="group relative flex flex-col rounded-md px-3 {isLast
                    ? 'mb-3'
                    : 'mb-1'} {message.referenced_message ? 'mt-2 pt-2' : showHeader ? 'mt-4' : 'mt-0'} {isFailed
                    ? 'bg-red-500/10 hover:bg-red-500/15'
                    : isHighlighted
                      ? 'bg-yellow-500/15 hover:bg-yellow-500/20'
                      : isMention
                        ? 'bg-yellow-500/10 hover:bg-yellow-500/15 border-l-2 border-yellow-500/60'
                        : 'hover:bg-zinc-800/55'} -mx-3"
                style={isFailed
                    ? ""
                    : isPending
                      ? "opacity: 0.5; pointer-events: none;"
                      : ""}
            >
                {#if message.referenced_message}
                    <div class="flex items-start min-w-0 mb-0.5">
                        <!-- L-connector aligned to avatar column -->
                        <div class="w-10 mr-3 shrink-0 flex justify-end items-center">
                            <div class="w-5.25 h-3.5 rounded-tl-5px border-t-2 border-l-2 border-zinc-500/60"></div>
                        </div>
                        <!-- Reply preview -->
                        <button
                            type="button"
                            class="-translate-y-1.25 flex items-start gap-1.5 min-w-0 text-xs text-zinc-400 hover:text-zinc-100 cursor-pointer transition-colors"
                            onclick={() => jumpToMessageRequest.set({ id: crypto.randomUUID(), spaceId: message.referenced_message!.space_id ?? spaceId, roomId: message.referenced_message!.room_id ?? channelId, messageId: message.referenced_message!.message_id! })}
                        >
                            <UserAvatar
                                src={message.referenced_message.author_avatar ?? null}
                                name={message.referenced_message.author_name ?? '?'}
                                size={16}
                            />
                            <span class="font-medium text-zinc-300 shrink-0">{message.referenced_message.author_name}</span>
                            <span class="truncate opacity-80 msg-content">{@html renderMarkdown(message.referenced_message.content ?? '', false, mentionMap)}</span>
                            {#if message.referenced_message.created_at}
                                <span class="shrink-0 opacity-50">{new Date(message.referenced_message.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                            {/if}
                        </button>
                    </div>
                {/if}
                <div class="flex items-start">
                {#if showHeader}
                    {#key message.author_avatar_url}
                        <button
                            type="button"
                            class="mr-3 mt-0.5 shrink-0 rounded-full {msgMember ? 'cursor-pointer' : 'cursor-default'}"
                            onclick={() => { if (msgMember) activePopoverMsgId = message.id; }}
                        >
                            <UserAvatar
                                src={message.author_avatar_url}
                                name={message.author_name}
                                size={40}
                            />
                        </button>
                    {/key}
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
                            {#if msgMember}
                                <MemberProfilePopover
                                    member={msgMember}
                                    {spaceId}
                                    {space}
                                    side="right"
                                    open={activePopoverMsgId === message.id}
                                    onOpenChange={(o) => { activePopoverMsgId = o ? message.id : null; }}
                                    triggerClass="font-semibold mr-2 hover:underline cursor-pointer"
                                    triggerStyle={authorColors[message.author_name] || "color: var(--color-zinc-100)"}
                                >
                                    {#snippet children()}
                                        {message.author_name}
                                    {/snippet}
                                </MemberProfilePopover>
                            {:else}
                                <span
                                    class="font-semibold mr-2 cursor-default"
                                    style={authorColors[message.author_name] || "color: var(--color-zinc-100)"}
                                >
                                    {message.author_name}
                                </span>
                            {/if}
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
                                {members}
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
                        {#if message.type === MessageType.Voice}
                            <!-- Voice note -->
                            {@const voiceAtt = message.attachments?.find((a) => a.content_type.startsWith("audio/"))}
                            {#if voiceAtt?.pending}
                                <div class="flex items-center gap-2.5 py-1 px-3.5 rounded-2xl max-w-64 min-w-48" style="background: oklch(0.22 0.01 80 / 0.8); border: 1px solid oklch(0.30 0.01 80 / 0.6);">
                                    <div class="size-9 rounded-full bg-zinc-700 animate-pulse shrink-0"></div>
                                    <div class="flex-1 flex flex-col gap-1.5">
                                        <div class="h-7 rounded bg-zinc-700/40 animate-pulse"></div>
                                        <span class="text-[11px] text-zinc-500">Sending...</span>
                                    </div>
                                </div>
                            {:else if voiceAtt && !voiceAtt.deleted}
                                <VoiceNotePlayer src="{attachmentHost}/attachments/{voiceAtt.id}" />
                            {:else}
                                <div class="flex items-center gap-2 h-12 px-4 rounded-2xl border border-dashed border-zinc-700/50" style="background: oklch(0.20 0.008 80 / 0.5);">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-600"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                                    <span class="text-xs text-zinc-500 italic">Voice note deleted</span>
                                </div>
                            {/if}
                        {:else}
                        {@const processed = processMessageContent(
                            message.content,
                        )}
                        {@const isOnlyLink = /^\s*https?:\/\/\S+\s*$/.test(message.content) && message.embeds && message.embeds.length > 0}
                        {#if !isOnlyLink}
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
                                  : 'leading-5'} wrap-break-word pr-12 select-text cursor-text text-left"
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
                                    {#if messageLinkRegex.test(segment.content)}
                                        {@const resolved = resolveMessageLink(segment.content)}
                                        {#if resolved}
                                            <button
                                                type="button"
                                                class="inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-0.5 rounded bg-zinc-700/70 hover:bg-zinc-600/80 border border-zinc-600/50 transition-colors cursor-pointer text-zinc-300 hover:text-white"
                                                onclick={(e) => {
                                                    e.stopPropagation();
                                                    tryNavigateMessageLink(segment.content);
                                                }}
                                                title="{resolved.spaceName} › #{resolved.roomName}"
                                            >
                                                <span class="text-zinc-400 text-xs">#</span>
                                                <span class="text-xs font-medium">{resolved.roomName}</span>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-400 shrink-0"><path d="m9 18 6-6-6-6"/></svg>
                                            </button>
                                        {:else}
                                            <button
                                                type="button"
                                                class="text-zinc-500 hover:text-zinc-300 text-xs transition-colors cursor-pointer"
                                                onclick={(e) => {
                                                    e.stopPropagation();
                                                    tryNavigateMessageLink(segment.content);
                                                }}>{segment.content}</button
                                            >
                                        {/if}
                                    {:else}
                                        <a
                                            href={segment.content}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="text-stone-300 hover:underline"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                            }}>{segment.content}</a
                                        >
                                    {/if}
                                {:else}
                                    {@html renderMarkdown(
                                        segment.content,
                                        emojiOnly,
                                        mentionMap,
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
                        {/if}
                        {#if processed.inviteCodes.length > 0}
                            <div class="flex flex-col gap-2">
                                {#each processed.inviteCodes as code}
                                    <InviteEmbed {code} />
                                {/each}
                            </div>
                        {/if}
                        {#if processed.messageLinks.length > 0}
                            <div class="flex flex-col gap-1">
                                {#each processed.messageLinks as ml}
                                    <MessageLinkEmbed
                                        spaceId={ml.spaceId}
                                        roomId={ml.roomId}
                                        messageId={ml.messageId}
                                    />
                                {/each}
                            </div>
                        {/if}
                        {#if message.embeds && message.embeds.length > 0}
                            <div class="flex flex-col gap-1">
                                {#each message.embeds as embed}
                                    <EmbedCard {embed} />
                                {/each}
                            </div>
                        {/if}
                        {#if message.attachments && message.attachments.length > 0}
                            <div class="mt-1 flex flex-col gap-1">
                                {#each message.attachments as att}
                                    {#if att.pending}
                                        {#if att.content_type.startsWith("image/")}
                                            <div class="w-64 h-40 rounded-md bg-zinc-700/40 animate-pulse flex items-center justify-center">
                                                <span class="text-xs text-zinc-500">Uploading {att.filename}...</span>
                                            </div>
                                        {:else if att.content_type.startsWith("video/")}
                                            <div class="w-80 h-44 rounded-md bg-zinc-700/40 animate-pulse flex items-center justify-center">
                                                <span class="text-xs text-zinc-500">Uploading {att.filename}...</span>
                                            </div>
                                        {:else}
                                            <div class="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800/60 max-w-xs animate-pulse">
                                                <span class="text-xs text-zinc-500">Uploading {att.filename}...</span>
                                                <span class="text-xs text-zinc-600 shrink-0">{formatFileSize(att.size_bytes)}</span>
                                            </div>
                                        {/if}
                                    {:else if att.deleted}
                                        {@const dw = Math.min(att.width ?? 200, 400)}
                                        {@const dh = Math.min(att.height ?? 48, 400)}
                                        <div
                                            class="rounded-md border border-dashed border-zinc-700 bg-zinc-800/30 flex flex-col items-center justify-center gap-1"
                                            style="width: {dw}px; height: {dh}px; max-width: 100%;"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-600"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                                            <span class="text-xs text-zinc-500">Attachment deleted</span>
                                        </div>
                                    {:else if att.content_type.startsWith("image/")}
                                        {@const iw = Math.min(att.width ?? 400, 400)}
                                        {@const ih = Math.min(att.height ?? 400, 400)}
                                        <div class="relative rounded-md overflow-hidden" style="width: {iw}px; height: {ih}px; max-width: 100%;">
                                            <div class="absolute inset-0 bg-zinc-700/40 animate-pulse img-skeleton"></div>
                                            <img
                                                src="{attachmentHost}/attachments/{att.id}"
                                                alt={att.filename}
                                                class="relative rounded-md object-contain w-full h-full text-transparent"
                                                loading="lazy"
                                                onload={(e) => { (e.currentTarget as HTMLElement).parentElement?.querySelector('.img-skeleton')?.remove(); }}
                                                onerror={(e) => {
                                                    const img = e.currentTarget as HTMLImageElement;
                                                    const retries = parseInt(img.dataset.retries ?? "0");
                                                    if (retries < 10) {
                                                        img.dataset.retries = String(retries + 1);
                                                        setTimeout(() => { img.src = img.src.split("?")[0] + "?r=" + Date.now(); }, 1000);
                                                    } else {
                                                        const parent = img.parentElement!;
                                                        parent.querySelector('.img-skeleton')?.remove();
                                                        img.remove();
                                                        parent.innerHTML = `<div class="flex flex-col items-center justify-center w-full h-full bg-zinc-800/60 rounded-md gap-1"><span class="text-2xl">💩</span><span class="text-xs text-zinc-500">Failed to load</span></div>`;
                                                    }
                                                }}
                                            />
                                        </div>
                                    {:else if att.content_type.startsWith("video/")}
                                        {@const vw = Math.min(att.width ?? 400, 400)}
                                        {@const vh = Math.min(att.height ?? 300, 300)}
                                        <div class="relative rounded-md overflow-hidden" style="width: {vw}px; height: {vh}px; max-width: 100%;">
                                            <div class="absolute inset-0 bg-zinc-700/40 animate-pulse flex items-center justify-center video-skeleton">
                                                <span class="text-xs text-zinc-500">Loading video...</span>
                                            </div>
                                            <!-- svelte-ignore a11y_media_has_caption -->
                                            <video
                                                src="{attachmentHost}/attachments/{att.id}"
                                                controls
                                                class="relative w-full h-full rounded-md"
                                                onloadeddata={(e) => { const el = e.currentTarget as HTMLVideoElement; el.parentElement?.querySelector('.video-skeleton')?.remove(); }}
                                                onerror={(e) => {
                                                    const vid = e.currentTarget as HTMLVideoElement;
                                                    const retries = parseInt(vid.dataset.retries ?? "0");
                                                    if (retries < 10) {
                                                        vid.dataset.retries = String(retries + 1);
                                                        setTimeout(() => { vid.src = vid.src.split("?")[0] + "?r=" + Date.now(); }, 1000);
                                                    } else {
                                                        const parent = vid.parentElement!;
                                                        parent.querySelector('.video-skeleton')?.remove();
                                                        vid.remove();
                                                        parent.innerHTML = `<div class="flex flex-col items-center justify-center w-full h-full bg-zinc-800/60 rounded-md gap-1"><span class="text-2xl">💩</span><span class="text-xs text-zinc-500">Failed to load</span></div>`;
                                                    }
                                                }}
                                            ></video>
                                        </div>
                                    {:else}
                                        <a
                                            href="{attachmentHost}/attachments/{att.id}"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="inline-flex items-center gap-2 mt-1 px-3 py-2 rounded-md bg-zinc-800/60 text-sm text-zinc-300 hover:bg-zinc-700/60 max-w-xs"
                                        >
                                            <span class="truncate">{att.filename}</span>
                                            <span class="text-xs text-zinc-500 shrink-0">{formatFileSize(att.size_bytes)}</span>
                                        </a>
                                    {/if}
                                {/each}
                            </div>
                        {/if}
                        {/if}
                    {/if}
                </div>
                </div><!-- end inner row -->

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
                {:else if !isPending && $currentUser && message.author_id === $currentUser.id && editingMessageId !== message.id}
                    <div
                        class="absolute right-2 -top-3 z-10 hidden overflow-hidden rounded border border-zinc-800 bg-zinc-700 shadow-sm transition-opacity group-hover:flex"
                    >
                        <button
                            class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors"
                            onclick={() => onReply?.(message)}
                            title="Reply"
                            aria-label="Reply"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                        </button>
                        <div class="w-px bg-zinc-800"></div>
                        <button
                            class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors"
                            onclick={() => {
                                navigator.clipboard.writeText(
                                    `duvet://channels/${spaceId}/${channelId}/${message.id}`
                                ).catch(console.error);
                            }}
                            title="Copy message link"
                            aria-label="Copy message link"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        </button>
                        <div class="w-px bg-zinc-800"></div>
                        <button
                            class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors"
                            onclick={() => openThreadModal(message)}
                            title="View thread"
                            aria-label="View thread"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </button>
                        <div class="w-px bg-zinc-800"></div>
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
                {:else if !isPending && $currentUser && message.author_id !== $currentUser.id && editingMessageId !== message.id}
                    <div
                        class="absolute right-2 -top-3 z-10 hidden overflow-hidden rounded border border-zinc-800 bg-zinc-700 shadow-sm transition-opacity group-hover:flex"
                    >
                        <button
                            class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors"
                            onclick={() => onReply?.(message)}
                            title="Reply"
                            aria-label="Reply"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                        </button>
                        <div class="w-px bg-zinc-800"></div>
                        <button
                            class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors"
                            onclick={() => {
                                navigator.clipboard.writeText(
                                    `duvet://channels/${spaceId}/${channelId}/${message.id}`
                                ).catch(console.error);
                            }}
                            title="Copy message link"
                            aria-label="Copy message link"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        </button>
                        <div class="w-px bg-zinc-800"></div>
                        <button
                            class="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors"
                            onclick={() => openThreadModal(message)}
                            title="View thread"
                            aria-label="View thread"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </button>
                        {#if currentUserCanManageMessages()}
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
                        {/if}
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

            {#if unreadDividerIdx !== null && unreadCount > 0 && i === unreadDividerIdx - 1}
                <div data-unread-divider class="flex items-center gap-3 px-2 my-2 select-none">
                    <div class="flex-1 h-px bg-red-500/50"></div>
                    <span class="text-xs text-red-400 font-semibold whitespace-nowrap shrink-0">
                        {unreadCount === 1 ? '1 mensaje nuevo' : `${unreadCount} mensajes nuevos`}
                    </span>
                    <div class="flex-1 h-px bg-red-500/50"></div>
                </div>
            {/if}
        {/each}

        {#if hasMoreMessages}
            <div
                data-sentinel-top
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

<Dialog.Root bind:open={threadModalOpen}>
    <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content class="fixed inset-0 z-51 flex items-center justify-center p-4">
            <div class="w-full max-w-2xl max-h-[75vh] bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden text-zinc-100">
                <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-700">
                    <div>
                        <h2 class="text-base font-semibold text-white">Message thread</h2>
                        {#if threadRootMessage}
                            <p class="text-xs text-zinc-400">From {threadRootMessage.author_name}</p>
                        {/if}
                    </div>
                    <button
                        class="text-zinc-400 hover:text-white hover:bg-zinc-800 p-1.5 rounded-lg transition-colors"
                        onclick={() => (threadModalOpen = false)}
                        aria-label="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>
                <div class="px-5 py-4 overflow-y-auto max-h-[calc(75vh-4.5rem)]">
                    {#if threadLoading}
                        <div class="flex items-center justify-center py-8">
                            <div class="w-6 h-6 border-2 border-stone-400 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    {:else if threadError}
                        <p class="text-sm text-red-400">{threadError}</p>
                    {:else if threadMessages.length === 0}
                        <p class="text-sm text-zinc-400">No thread messages found.</p>
                    {:else}
                        {@const threadMsgMap = new Map(threadMessages.map((m) => [m.id, m]))}
                        <div class="flex flex-col gap-2">
                            {#each threadMessages as threadMsg}
                                {@const parentMsg = threadMsg.ref_message_id ? threadMsgMap.get(threadMsg.ref_message_id) : null}
                                <div class="rounded-md border border-zinc-800 bg-zinc-800/30 px-3 py-2">
                                    {#if parentMsg}
                                        <div class="flex items-center gap-1.5 mb-2 pl-1 border-l-2 border-zinc-600">
                                            <UserAvatar
                                                src={parentMsg.author_avatar_url}
                                                name={parentMsg.author_name}
                                                size={14}
                                            />
                                            <span class="text-xs font-medium text-zinc-400 truncate max-w-24">{parentMsg.author_name}</span>
                                            <span class="text-xs text-zinc-500 truncate">{@html renderMarkdown(parentMsg.content.slice(0, 60), false, mentionMap)}{parentMsg.content.length > 60 ? "…" : ""}</span>
                                        </div>
                                    {/if}
                                    <div class="flex items-start gap-2">
                                        <UserAvatar
                                            src={threadMsg.author_avatar_url}
                                            name={threadMsg.author_name}
                                            size={24}
                                        />
                                        <div class="min-w-0 flex-1">
                                            <div class="flex items-center gap-2">
                                                <span class="text-sm font-semibold text-zinc-100">{threadMsg.author_name}</span>
                                                <span class="text-xs text-zinc-500">{new Date(threadMsg.created_at).toLocaleString(locale)}</span>
                                            </div>
                                            <p class="text-sm text-zinc-200 whitespace-pre-wrap wrap-break-word msg-content">{@html renderMarkdown(threadMsg.content, false, mentionMap)}</p>
                                        </div>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
