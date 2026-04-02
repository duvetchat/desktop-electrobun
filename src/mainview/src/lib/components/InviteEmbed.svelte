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
	const numberFormatter = new Intl.NumberFormat(typeof navigator !== "undefined" ? navigator.language : "en-US");

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
	<div class="mt-2 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 p-4">
		<div class="mb-3 h-3 w-44 animate-pulse rounded bg-zinc-800"></div>
		<div class="mb-4 flex items-center gap-3">
			<div class="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-zinc-800"></div>
			<div class="flex flex-col gap-1.5">
				<div class="h-4 w-28 animate-pulse rounded bg-zinc-800"></div>
				<div class="h-3 w-20 animate-pulse rounded bg-zinc-800"></div>
			</div>
		</div>
		<div class="h-9 w-full animate-pulse rounded-md bg-zinc-800"></div>
	</div>
{:else if !error && invite}
	<div
		class="mt-2 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 p-4 transition-colors duration-150 hover:bg-zinc-800/90"
	>
		<p class="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
			You've been invited to join a server
		</p>
		<div class="mb-4 flex items-center gap-3">
			<!-- Server icon -->
			<div
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-stone-500 to-stone-700 text-lg font-bold text-white select-none"
			>
				{invite.space_name.charAt(0).toUpperCase()}
			</div>
			<div class="min-w-0">
				<p class="truncate text-sm font-semibold text-white">
					{invite.space_name}
				</p>
				{#if invite.description}
					<p class="line-clamp-2 text-xs wrap-break-word text-zinc-400">
						{invite.description}
					</p>
				{/if}
				<div class="mt-0.5 flex items-center gap-1.5">
					<span class="inline-block h-2 w-2 shrink-0 rounded-full bg-stone-300"></span>
					<span class="text-xs text-zinc-400">
						{formatCount(invite.member_count)}
						{invite.member_count === 1 ? "Member" : "Members"}
					</span>
				</div>
			</div>
		</div>

		{#if joinError}
			<p class="mb-2 text-xs text-red-400">{joinError}</p>
		{/if}

		{#if joined}
			<div class="w-full rounded-md bg-stone-700 py-2 text-center text-sm font-semibold text-white">You're in.</div>
		{:else}
			<button
				class="w-full rounded-md bg-stone-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-500 disabled:cursor-not-allowed disabled:opacity-50"
				onclick={handleJoin}
				disabled={joining}
			>
				{joining ? "Joining…" : "Join server"}
			</button>
		{/if}
	</div>
{/if}
