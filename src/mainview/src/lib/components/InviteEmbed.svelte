<script lang="ts">
import { onMount } from "svelte";
import { getInvite, joinInvite } from "$lib/api/invites";
import type { InviteInfo } from "$lib/api/invites";
import { userSession } from "$lib/stores.svelte";
import { route } from "$lib/common/common";

let { code }: { code: string } = $props();

function inviteUrl(codeValue: string) {
	return route(`/invite.html?code=${encodeURIComponent(codeValue)}`);
}

function loginUrlForInvite(codeValue: string) {
	return route(`/index.html?redirect=${encodeURIComponent(inviteUrl(codeValue))}`);
}

let invite = $state<InviteInfo | null>(null);
let loading = $state(true);
let error = $state(false);
let joining = $state(false);
let joined = $state(false);
let joinError = $state("");
const numberFormatter = new Intl.NumberFormat(
	typeof navigator !== "undefined" ? navigator.language : "en-US",
);

function formatCount(value: number) {
	return numberFormatter.format(value);
}

onMount(async () => {
	try {
		invite = await getInvite(code);
	} catch {
		error = true;
	} finally {
		loading = false;
	}
});

async function handleJoin() {
	if (!userSession.token) {
		window.location.href = loginUrlForInvite(code);
		return;
	}
	joining = true;
	joinError = "";
	try {
		await joinInvite(code);
		joined = true;
	} catch (err) {
		joinError = err instanceof Error ? err.message : "Failed to join.";
	} finally {
		joining = false;
	}
}
</script>

{#if loading}
    <div
        class="mt-2 flex max-w-xs items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
        <div
            class="w-4 h-4 border-2 border-stone-400 border-t-transparent rounded-full animate-spin"
        ></div>
        <span class="text-sm text-zinc-400">Loading invite…</span>
    </div>
{:else if !error && invite}
    <div
        class="mt-2 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 p-4 transition-colors duration-150 hover:bg-zinc-800/90"
    >
        <p
            class="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase"
        >
            You've been invited to join a server
        </p>
        <div class="flex items-center gap-3 mb-4">
            <!-- Server icon -->
            <div
                class="w-12 h-12 rounded-xl bg-linear-to-br from-stone-500 to-stone-700 flex items-center justify-center text-white text-lg font-bold shrink-0 select-none"
            >
                {invite.space_name.charAt(0).toUpperCase()}
            </div>
            <div class="min-w-0">
                <p class="text-white font-semibold text-sm truncate">
                    {invite.space_name}
                </p>
                {#if invite.description}
                    <p class="text-xs text-zinc-400 line-clamp-2 wrap-break-word">
                        {invite.description}
                    </p>
                {/if}
                <div class="flex items-center gap-1.5 mt-0.5">
                    <span
                        class="w-2 h-2 rounded-full bg-stone-300 inline-block shrink-0"
                    ></span>
                    <span class="text-xs text-zinc-400">
                        {formatCount(invite.member_count)}
                        {invite.member_count === 1 ? "Member" : "Members"}
                    </span>
                </div>
            </div>
        </div>

        {#if joinError}
            <p class="text-red-400 text-xs mb-2">{joinError}</p>
        {/if}

        {#if joined}
            <div
                class="w-full py-2 rounded-md bg-stone-700 text-white text-sm font-semibold text-center"
            >
                You're in.
            </div>
        {:else}
			<button
                class="w-full py-2 rounded-md bg-stone-600 hover:bg-stone-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				onclick={handleJoin}
                disabled={joining}
            >
                {joining ? "Joining…" : "Join server"}
            </button>
        {/if}
    </div>
{/if}
