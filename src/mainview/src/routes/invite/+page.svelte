<script lang="ts">
	import { onMount } from "svelte";
	import { getApiError } from "$lib/api/api";
	import { page } from "$app/state";
	import { getInvite, joinInvite } from "$lib/api/invites";
	import type { InviteInfo } from "$lib/api/invites";
	import { userSession } from "$lib/stores.svelte";
	import { route } from "$lib/common/common";
	import { isUuid, signInUrl } from "$lib/urls";

	function inviteUrl(code: string) {
		return route(`/invite.html?code=${encodeURIComponent(code)}`);
	}

	function botInviteUrl(id: string) {
		return route(`/invite.html?bot=${encodeURIComponent(id)}`);
	}

	function readCodeFromHash(hash: string) {
		if (!hash.startsWith("#invite:")) return "";
		return decodeURIComponent(hash.slice(8));
	}

	let code = "";
	let invite = $state<InviteInfo | null>(null);
	let joining = $state(false);
	let loading = $state(true);
	let error = $state("");

	const numberFormatter = new Intl.NumberFormat(typeof navigator !== "undefined" ? navigator.language : "en-US");

	function formatCount(value: number) {
		return numberFormatter.format(value);
	}

	onMount(async () => {
		const botParam = page.url.searchParams.get("bot");
		code = page.url.searchParams.get("code") ?? readCodeFromHash(window.location.hash) ?? "";

		if (botParam) {
			// A bot's ID goes into the paths of the requests about it, and anyone can make this link.
			if (!isUuid(botParam)) {
				error = "Invalid invite link.";
				loading = false;
				return;
			}
			if (!userSession.token) {
				window.location.href = signInUrl(botInviteUrl(botParam));
				return;
			}
			// Redirect to app — the gateway needs to be connected for the space list
			window.location.href = route(`/app.html?bot=${encodeURIComponent(botParam)}`);
			return;
		} else if (code) {
			try {
				invite = await getInvite(code);
			} catch (err) {
				const msg = getApiError(err, "This invite is invalid or has expired.");
				if (msg === "Session invalid or expired") {
					window.location.href = signInUrl(inviteUrl(code));
					return;
				}
				error = msg;
			} finally {
				loading = false;
			}
		} else {
			error = "Invalid invite link.";
			loading = false;
		}
	});

	async function handleJoin() {
		if (!code) return;

		if (!userSession.token) {
			window.location.href = signInUrl(inviteUrl(code));
			return;
		}

		joining = true;
		error = "";
		try {
			await joinInvite(code);
			window.location.href = route("/app.html");
		} catch (err) {
			const msg = getApiError(err, "We couldn't join this server. Please try again.");
			if (msg === "Session invalid or expired") {
				window.location.href = signInUrl(inviteUrl(code));
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
				<div class="h-10 w-10 animate-spin rounded-full border-4 border-stone-500 border-t-transparent"></div>
				<p>Loading…</p>
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
					Go back
				</button>
			</div>
		{:else if invite}
			<div class="text-center">
				<div
					class="from-fill-500 to-fill-700 text-fixed-white mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-linear-to-br text-3xl font-bold shadow-lg select-none"
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
					<span class="inline-block h-2 w-2 rounded-full bg-[var(--status-online,var(--color-stone-300))]"></span>
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
						class="bg-fill-600 text-fixed-white hover:bg-fill-500 w-full rounded-xl py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
						onclick={handleJoin}
						disabled={joining}
					>
						{joining ? "Joining…" : "Join server"}
					</button>
				{:else}
					<p class="mb-4 text-sm text-zinc-300">Sign in to join this server.</p>
					<button
						class="bg-fill-600 text-fixed-white hover:bg-fill-500 w-full rounded-xl py-3 text-base font-semibold transition"
						onclick={() => (window.location.href = signInUrl(inviteUrl(code)))}
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
