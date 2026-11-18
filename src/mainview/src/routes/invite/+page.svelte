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
			const msg = getApiError(err, "We couldn't join this Space. Please try again.");
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

<section class="bg-duvet-sunk flex min-h-screen items-center justify-center p-6">
	<div class="border-duvet-line bg-duvet-card shadow-duvet-float rounded-card w-full max-w-md border p-10">
		{#if loading}
			<div class="text-duvet-ink flex flex-col items-center gap-4">
				<div class="border-duvet-ink2/40 h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"></div>
				<p>Loading…</p>
			</div>
		{:else if error && !invite}
			<div class="text-center">
				<div class="bg-duvet-card mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
					<svg viewBox="0 0 24 24" class="text-duvet-ink h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.5">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
						/>
					</svg>
				</div>
				<h1 class="text-duvet-ink mb-2 text-xl font-semibold">Invite not available</h1>
				<p class="text-duvet-ink text-sm">{error}</p>
				<button
					class="bg-duvet-card text-duvet-ink hover:bg-duvet-ink/10 mt-6 rounded-lg px-6 py-2.5 text-sm font-medium transition"
					onclick={() => (window.location.href = route("/index.html"))}
				>
					Go back
				</button>
			</div>
		{:else if invite}
			<div class="text-center">
				<div
					class="bg-duvet-chosen text-duvet-chosen-ink rounded-card shadow-duvet-float mx-auto mb-5 flex h-20 w-20 items-center justify-center text-3xl font-bold select-none"
				>
					{invite.space_name.charAt(0).toUpperCase()}
				</div>

				<p class="text-duvet-ink2 mb-1 text-[13px] font-bold">You've been invited to join</p>
				<h1 class="text-duvet-ink mb-1 text-2xl font-bold wrap-break-word">
					{invite.space_name}
				</h1>

				{#if invite.description}
					<p class="text-duvet-ink mt-1 mb-3 text-sm wrap-break-word">
						{invite.description}
					</p>
				{/if}

				<div class="mb-6 flex items-center justify-center gap-2">
					<span class="bg-duvet-alive inline-block h-2 w-2 rounded-full"></span>
					<span class="text-duvet-ink text-sm"
						>{formatCount(invite.member_count)}
						{invite.member_count === 1 ? "Member" : "Members"}</span
					>
				</div>

				{#if error}
					<p class="text-duvet-danger mb-4 text-sm">{error}</p>
				{/if}

				{#if userSession.token}
					<button
						class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised w-full rounded-xl py-3 text-base font-bold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={handleJoin}
						disabled={joining}
					>
						{joining ? "Joining…" : "Join Space"}
					</button>
				{:else}
					<p class="text-duvet-ink mb-4 text-sm">Sign in to join this Space.</p>
					<button
						class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised w-full rounded-xl py-3 text-base font-bold transition hover:brightness-110"
						onclick={() => (window.location.href = signInUrl(inviteUrl(code)))}
					>
						Sign in to join
					</button>
				{/if}

				<button
					class="text-duvet-ink hover:text-duvet-ink mt-3 w-full rounded-xl bg-transparent py-2.5 text-sm font-medium transition"
					onclick={() => (window.location.href = route("/index.html"))}
				>
					Not now
				</button>
			</div>
		{/if}
	</div>
</section>
