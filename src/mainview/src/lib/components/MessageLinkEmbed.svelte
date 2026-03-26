<script lang="ts">
    import { onMount } from "svelte";
    import { getMessageById } from "$lib/api/messages";
    import { getDirectMessageById } from "$lib/api/conversations";
    import { gatewayMessageToMessage } from "$lib/types";
    import { gatewaySpaces, jumpToMessageRequest, conversations } from "$lib/stores.svelte";
    import UserAvatar from "$lib/components/UserAvatar.svelte";
    import type { Message } from "$lib/types";
    import { renderMarkdown } from "$lib/markdown";

    let {
        spaceId = "",
        roomId = "",
        messageId,
        conversationId,
    }: {
        spaceId?: string;
        roomId?: string;
        messageId: string;
        conversationId?: string;
    } = $props();

    const isConv = $derived(!!conversationId);

    let message = $state<Message | null>(null);
    let loading = $state(true);
    let error = $state(false);

    const locale =
        typeof navigator !== "undefined" ? navigator.language : "en-US";

    const space = $derived(!isConv ? ($gatewaySpaces.find((s) => s.id === spaceId) ?? null) : null);
    const room = $derived(space?.rooms.find((r) => r.id === roomId) ?? null);
    const conv = $derived(isConv ? ($conversations.find((c) => c.id === conversationId) ?? null) : null);
    const convName = $derived(conv?.name ?? "Direct Message");

    function formatTime(dateStr: string): string {
        return new Date(dateStr).toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    onMount(async () => {
        try {
            if (isConv && conversationId) {
                const raw = await getDirectMessageById(conversationId, messageId);
                message = {
                    id: raw.id,
                    content: raw.content,
                    type: raw.type ?? 0,
                    author_id: raw.author_id,
                    author_name: raw.user?.alias ?? raw.user?.username ?? raw.author_id.slice(0, 8),
                    author_avatar_url: raw.user?.avatar ?? null,
                    created_at: raw.created_at,
                    updated_at: raw.updated_at,
                    embeds: raw.embeds ?? null,
                    attachments: raw.attachments ?? null,
                    reactions: raw.reactions ?? null,
                };
            } else {
                const raw = await getMessageById(roomId, messageId);
                message = gatewayMessageToMessage(raw, $gatewaySpaces);
            }
        } catch {
            error = true;
        } finally {
            loading = false;
        }
    });

    function jump() {
        if (isConv && conversationId) {
            jumpToMessageRequest.set({
                id: crypto.randomUUID(),
                spaceId: "",
                roomId: "",
                messageId,
                conversationId,
            });
        } else {
            jumpToMessageRequest.set({
                id: crypto.randomUUID(),
                spaceId,
                roomId,
                messageId,
            });
        }
    }
</script>

{#if loading}
    <div class="mt-1 flex items-center gap-2 max-w-sm rounded-md border-l-4 border-zinc-600 bg-zinc-800/60 px-3 py-2">
        <div class="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
        <span class="text-xs text-zinc-500">Loading message...</span>
    </div>
{:else if !error && message}
    <button
        type="button"
        onclick={jump}
        class="mt-1 flex flex-col max-w-sm w-full rounded-md border-l-4 border-zinc-500 bg-zinc-800/60 hover:bg-zinc-800 transition-colors text-left cursor-pointer overflow-hidden"
    >
        <!-- Breadcrumb header -->
        <div class="flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b border-zinc-700/60 min-w-0">
            {#if isConv}
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-500 shrink-0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span class="text-xs text-zinc-400 font-medium truncate">{convName}</span>
            {:else}
                {#if space}
                    <div class="w-4 h-4 shrink-0 rounded-sm bg-zinc-600 flex items-center justify-center text-[9px] font-bold text-zinc-200 select-none leading-none">
                        {space.name.charAt(0).toUpperCase()}
                    </div>
                    <span class="text-xs text-zinc-400 font-medium truncate max-w-25">{space.name}</span>
                    <span class="text-zinc-600 text-xs shrink-0">></span>
                {/if}
                {#if room}
                    <span class="text-zinc-500 text-xs shrink-0">#</span>
                    <span class="text-xs text-zinc-400 font-medium truncate max-w-22.5">{room.name}</span>
                {:else}
                    <span class="text-xs text-zinc-500 italic">unknown-channel</span>
                {/if}
            {/if}
        </div>

        <!-- Message preview -->
        <div class="flex items-start gap-2.5 px-3 py-2">
            <div class="shrink-0 mt-0.5">
                <UserAvatar
                    src={message.author_avatar_url}
                    name={message.author_name}
                    size={28}
                />
            </div>
            <div class="flex flex-col min-w-0 flex-1">
                <div class="flex items-baseline gap-1.5 mb-0.5">
                    <span class="text-sm font-semibold text-zinc-100 truncate">{message.author_name}</span>
                    <span class="text-xxs text-zinc-500 shrink-0">{formatTime(message.created_at)}</span>
                </div>
                <p class="text-sm text-zinc-300 line-clamp-3 wrap-break-word whitespace-pre-wrap">{@html renderMarkdown(message.content)}</p>
            </div>
        </div>
    </button>
{/if}
