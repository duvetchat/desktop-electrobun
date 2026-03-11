<script lang="ts">
import {
	X as XIcon,
	Link2 as LinkSimpleIcon,
	Copy as CopySimpleIcon,
	Check as CheckIcon,
} from "@lucide/svelte";
import { Dialog } from "bits-ui";
import { createRoomInvite } from "$lib/api/rooms";
import type { Channel } from "$lib/types";

let {
	open = $bindable(false),
	channel = null,
	spaceId = "",
}: {
	open?: boolean;
	channel?: Channel | null;
	spaceId?: string;
} = $props();

let inviteLink = $state("");
let isLoading = $state(false);
let copied = $state(false);
let genError = $state("");
let linkInput = $state<HTMLInputElement | undefined>(undefined);

// Re-generate whenever the modal opens or the channel changes

$effect(() => {
	if (!open || !channel) {
		return;
	}
 	generate();
});

async function generate() {
	if (!channel || !spaceId) return;
	inviteLink = "";
	genError = "";
	copied = false;
	isLoading = true;
	try {
		const code = await createRoomInvite(spaceId, channel.id);
		inviteLink = `${window.location.origin}/invite.html?code=${encodeURIComponent(code)}`;
	} catch (err) {
		genError = err instanceof Error ? err.message : "Failed to generate link.";
	} finally {
		isLoading = false;
	}
}

function copyLink() {
	if (!inviteLink) return;
	navigator.clipboard.writeText(inviteLink);
	copied = true;
	setTimeout(() => (copied = false), 2000);
}
</script>

<Dialog.Root bind:open>
    <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content class="fixed inset-0 z-51 flex items-center justify-center p-4">
            <div class="w-full max-w-md bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden text-zinc-100">
            <!-- Header -->
            <div
                class="flex items-center justify-between px-6 py-4 border-b border-zinc-700"
            >
                <div class="flex items-center gap-2.5">
                    <LinkSimpleIcon class="size-4 text-stone-300" />
                    <div>
                        <h2
                            class="text-base font-semibold text-white leading-tight"
                        >
                            Invite People
                        </h2>
                        {#if channel}
                            <p class="text-xs text-zinc-400">#{channel.name}</p>
                        {/if}
                    </div>
                </div>
                <button
                    class="text-zinc-400 hover:text-white hover:bg-zinc-800 p-1.5 rounded-lg transition-colors"
                    onclick={() => (open = false)}
                    aria-label="Close"
                >
                    <XIcon class="size-5" />
                </button>
            </div>

            <!-- Body -->
            <div class="px-6 py-5 space-y-4">
                <p class="text-sm text-zinc-300">
                    Share this invite link. Anyone with this link can join the
                    server.
                </p>

                {#if isLoading}
                    <div class="flex items-center justify-center py-8">
                        <div
                            class="w-6 h-6 border-2 border-stone-400 border-t-transparent rounded-full animate-spin"
                        ></div>
                    </div>
                {:else if genError}
                    <p class="text-sm text-red-400 text-center py-4">
                        {genError}
                    </p>
                    <button
                        class="w-full py-2 rounded-lg bg-zinc-800 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
                        onclick={generate}
                    >
                        Try again
                    </button>
                {:else if inviteLink}
                    <div class="flex items-center gap-2">
                        <input
                            bind:this={linkInput}
                            type="text"
                            readonly
                            value={inviteLink}
                            class="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-stone-500 font-mono"
                            onclick={() => linkInput?.select()}
                        />
                        <button
                            class="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium text-white transition-colors
                            {copied
                                ? 'bg-stone-600 hover:bg-stone-500'
                                : 'bg-stone-600 hover:bg-stone-500'}"
                            onclick={copyLink}
                            aria-label="Copy link"
                        >
                            {#if copied}
                                <CheckIcon class="size-4" />
                                Copied!
                            {:else}
                                <CopySimpleIcon class="size-4" />
                                Copy
                            {/if}
                        </button>
                    </div>
                    <p class="text-xs text-zinc-400">This link never expires.</p>
                {/if}
            </div>
            </div>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
