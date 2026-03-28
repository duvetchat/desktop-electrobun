<script lang="ts">
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { getInvite, joinInvite } from "$lib/api/invites";
	import type { InviteInfo } from "$lib/api/invites";
	import { userSession } from "$lib/stores.svelte";
	import { route } from "$lib/common/common";

	function inviteUrl(code: string) {
		return route(`/invite.html?code=${encodeURIComponent(code)}`);
	}

	function loginUrlForInvite(code: string) {
		return route(`/index.html?redirect=${encodeURIComponent(inviteUrl(code))}`);
	}

	function readCodeFromHash(hash: string) {
		if (!hash.startsWith("#invite:")) return "";
		return decodeURIComponent(hash.slice(8));
	}

	let code = "";
	let invite = $state<InviteInfo | null>(null);
	let loading = $state(true);
	let joining = $state(false);
	let error = $state("");
	const numberFormatter = new Intl.NumberFormat(typeof navigator !== "undefined" ? navigator.language : "en-US");

	function formatCount(value: number) {
		return numberFormatter.format(value);
	}

	onMount(async () => {
		code = page.url.searchParams.get("code") ?? readCodeFromHash(window.location.hash) ?? "";

		if (!code) {
			error = "Invite code is required.";
			loading = false;
			return;
		}

		try {
			invite = await getInvite(code);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "This invite is invalid or has expired.";
			if (msg === "Session invalid or expired") {
				window.location.href = loginUrlForInvite(code);
				return;
			}
			error = msg;
		} finally {
			loading = false;
		}
	});

	async function handleJoin() {
		if (!code) return;

		if (!userSession.token) {
			window.location.href = loginUrlForInvite(code);
			return;
		}

		joining = true;
		error = "";
		try {
			await joinInvite(code);
			window.location.href = route("/app.html");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "We couldn't join this server. Please try again.";
			if (msg === "Session invalid or expired") {
				window.location.href = loginUrlForInvite(code);
				return;
			}
			error = msg;
		} finally {
			joining = false;
		}
	}
</script>

<section class="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
	<div class="w-full max-w-md rounded-3xl border border-zinc-700 bg-zinc-900/90 p-10 shadow-2xl backdrop-blur-xl">
		{#if loading}
			<div class="flex flex-col items-center gap-4 text-zinc-300">
				<div class="h-10 w-10 animate-spin rounded-full border-4 border-red-500 border-t-transparent"></div>
				<p>Loading invite…</p>
			</div>
		{:else if error && !invite}
			<div class="text-center">
				<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800">
					<svg viewBox="0 0 24 24" class="h-7 w-7 text-zinc-300" fill="none" stroke="currentColor" stroke-width="1.5">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
						/>
					</svg>
				</div>
				<h1 class="mb-2 text-xl font-semibold text-white">Invite not available</h1>
				<p class="text-sm text-zinc-300">{error}</p>
				<button
					class="mt-6 rounded-lg bg-zinc-800 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700"
					onclick={() => (window.location.href = route("/index.html"))}
				>
					Back to sign in
				</button>
			</div>
		{:else if invite}
			<div class="text-center">
				<!-- Server icon placeholder -->
				<div
					class="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-linear-to-br from-red-500 to-red-700 text-3xl font-bold text-white shadow-lg select-none"
				>
					{invite.space_name.charAt(0).toUpperCase()}
				</div>

				<p class="mb-1 text-sm font-medium tracking-widest text-zinc-300 uppercase">You've been invited to join</p>
				<h1 class="mb-1 text-2xl font-bold wrap-break-word text-white">
					{invite.space_name}
				</h1>

				{#if invite.description}
					<p class="mt-1 mb-3 text-sm wrap-break-word text-zinc-300">
						{invite.description}
					</p>
				{/if}

				<div class="mb-6 flex items-center justify-center gap-2">
					<span class="inline-block h-2 w-2 rounded-full bg-stone-300"></span>
					<span class="text-sm text-zinc-300"
						>{formatCount(invite.member_count)}
						{invite.member_count === 1 ? "Member" : "Members"}</span
					>
				</div>

				{#if error}
					<p class="mb-4 text-sm text-red-400">{error}</p>
				{/if}

				{#if userSession.token}
					<button
						class="w-full rounded-xl bg-red-600 py-3 text-base font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={handleJoin}
						disabled={joining}
					>
						{joining ? "Joining…" : "Join server"}
					</button>
				{:else}
					<p class="mb-4 text-sm text-zinc-300">Sign in to join this server.</p>
					<button
						class="w-full rounded-xl bg-red-600 py-3 text-base font-semibold text-white transition hover:bg-red-700"
						onclick={() => (window.location.href = loginUrlForInvite(code))}
					>
						Sign in to join
					</button>
				{/if}

				<button
					class="mt-3 w-full rounded-xl bg-transparent py-2.5 text-sm font-medium text-zinc-300 transition hover:text-white"
					onclick={() => (window.location.href = route("/index.html"))}
				>
					Not now
				</button>
			</div>
		{/if}
	</div>
</section>
