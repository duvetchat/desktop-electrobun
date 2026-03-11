<script lang="ts">
import { X as XIcon } from "lucide-svelte";
import { Dialog } from "bits-ui";
import { getInvite, joinInvite } from "$lib/api/invites";
import type { InviteInfo } from "$lib/api/invites";

let {
	open = $bindable(false),
	code = null,
}: {
	open?: boolean;
	code?: string | null;
} = $props();

let invite = $state<InviteInfo | null>(null);
let loading = $state(false);
let joining = $state(false);
let loadError = $state("");
let joinError = $state("");


$effect(() => {
	if (!open || !code) {
		return;
	}
	loadPreview(code);
});

$effect(() => {
	if (open) {
		return;
	}
	invite = null;
	loadError = "";
	joinError = "";
});

async function loadPreview(c: string) {
	invite = null;
	loadError = "";
	joinError = "";
	loading = true;
	try {
		invite = await getInvite(c);
	} catch (err) {
		loadError =
			err instanceof Error ? err.message : "Invite not found or has expired.";
	} finally {
		loading = false;
	}
}

async function handleJoin() {
	if (!code) return;
	joining = true;
	joinError = "";
	try {
		await joinInvite(code);
		open = false;
	} catch (err) {
		joinError = err instanceof Error ? err.message : "Failed to join server.";
	} finally {
		joining = false;
	}
}
</script>

<Dialog.Root bind:open>
    <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content class="fixed inset-0 z-51 flex items-center justify-center p-4">
            <div class="w-full max-w-sm bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden text-zinc-100">
            <!-- Header -->
            <div
                class="flex items-center justify-between px-5 py-4 border-b border-zinc-700"
            >
                <h2 class="text-base font-semibold text-white">
                    Join a Server
                </h2>
                <button
                    class="text-zinc-400 hover:text-white hover:bg-zinc-800 p-1.5 rounded-lg transition-colors"
                    on:click={() => (open = false)}
                    aria-label="Close"
                >
                    <XIcon class="size-5" />
                </button>
            </div>

            <!-- Body -->
            <div class="px-5 py-5">
                {#if loading}
                    <div class="flex items-center justify-center py-8">
                        <div
                            class="w-6 h-6 border-2 border-stone-400 border-t-transparent rounded-full animate-spin"
                        ></div>
                    </div>
                {:else if loadError}
                    <p class="text-sm text-red-400 text-center py-6">
                        {loadError}
                    </p>
                {:else if invite}
                    <!-- Server preview -->
                    <div class="flex items-center gap-4 mb-5">
                        <div
                            class="w-14 h-14 rounded-xl bg-gradient-to-br from-stone-500 to-stone-700 flex items-center justify-center text-white text-xl font-bold shrink-0 select-none"
                        >
                            {invite.space_name.charAt(0).toUpperCase()}
                        </div>
                        <div class="min-w-0">
                            <p
                                class="text-white font-semibold text-base truncate"
                            >
                                {invite.space_name}
                            </p>
                            {#if invite.description}
                                <p class="text-zinc-400 text-xs mt-0.5 truncate">
                                    {invite.description}
                                </p>
                            {/if}
                            <div class="flex items-center gap-1.5 mt-1">
                                <span
                                    class="w-2 h-2 rounded-full bg-stone-300 inline-block"
                                ></span>
                                <span class="text-zinc-400 text-xs"
                                    >{invite.member_count}
                                    {invite.member_count === 1
                                        ? "member"
                                        : "members"}</span
                                >
                            </div>
                        </div>
                    </div>

                    {#if joinError}
                        <p class="text-red-400 text-sm mb-3">{joinError}</p>
                    {/if}

                    <div class="flex gap-2 justify-end">
                        <button
                            class="px-4 py-2 text-sm rounded-md text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                            on:click={() => (open = false)}
                        >
                            Cancel
                        </button>
                        <button
                            class="px-4 py-2 text-sm rounded-md bg-stone-600 hover:bg-stone-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            on:click={handleJoin}
                            disabled={joining}
                        >
                            {joining ? "Joining…" : "Accept Invite"}
                        </button>
                    </div>
                {/if}
            </div>
            </div>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
