<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthNote from "$lib/components/auth/AuthNote.svelte";
	import AuthResult from "$lib/components/auth/AuthResult.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";
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

<!-- The sign-in pages' frame, with the invite as a card: mobile's InviteCard, at a page's size. -->
<AuthScene>
	{#if loading}
		<AuthResult state="loading" text="Loading…" />
	{:else if error && !invite}
		<AuthResult state="warning" title="Invite not available" text={error}>
			<AuthSubmit variant="secondary" onclick={() => (window.location.href = route("/index.html"))}>Go back</AuthSubmit>
		</AuthResult>
	{:else if invite}
		<div class="bg-duvet-card shadow-duvet-raised rounded-[20px] p-6 text-center" data-invite-card>
			<SpaceIcon name={invite.space_name} size={64} class="shadow-duvet-raised select-none" />

			<p class="text-duvet-ink2 mt-4 text-[13px] leading-[1.2] font-medium">You've been invited to join</p>
			<h1 class="text-duvet-ink font-serif-lg mt-1 text-[28px] leading-[1.15] font-medium wrap-break-word">
				{invite.space_name}
			</h1>

			{#if invite.description}
				<p class="text-duvet-ink2 font-content mt-2 text-[14px] leading-[1.4] wrap-break-word">
					{invite.description}
				</p>
			{/if}

			<div class="mt-3 flex items-center justify-center gap-2">
				<span class="bg-duvet-alive inline-block size-2 rounded-full" aria-hidden="true"></span>
				<span class="text-duvet-ink text-[13.5px]"
					>{formatCount(invite.member_count)}
					{invite.member_count === 1 ? "Member" : "Members"}</span
				>
			</div>

			<div class="mt-6 flex flex-col gap-2 text-left">
				{#if error}
					<AuthNote>{error}</AuthNote>
				{/if}

				{#if userSession.token}
					<AuthSubmit busy={joining} onclick={handleJoin}>
						{joining ? "Joining…" : "Join Space"}
					</AuthSubmit>
				{:else}
					<p class="text-duvet-ink2 font-content text-center text-[14px]">Sign in to join this Space.</p>
					<AuthSubmit onclick={() => (window.location.href = signInUrl(inviteUrl(code)))}>Sign in to join</AuthSubmit>
				{/if}

				<AuthSubmit variant="quiet" onclick={() => (window.location.href = route("/index.html"))}>Not now</AuthSubmit>
			</div>
		</div>
	{/if}
</AuthScene>
