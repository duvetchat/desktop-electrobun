<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthNote from "$lib/components/auth/AuthNote.svelte";
	import AuthResult from "$lib/components/auth/AuthResult.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import Rich from "$lib/components/Rich.svelte";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";
	import { onMount } from "svelte";
	import { getApiError } from "$lib/api/api";
	import { page } from "$app/state";
	import { getInvite, joinInvite } from "$lib/api/invites";
	import type { InviteInfo } from "$lib/api/invites";
	import { userSession } from "$lib/stores.svelte";
	import { route } from "$lib/common/common";
	import { isUuid, signInUrl } from "$lib/urls";
	import { t, type MessageKey } from "$lib/i18n";

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
	// What went wrong: the app's own sentence by its key, drawn in the language of the moment, or the API's words.
	let errorKey = $state<MessageKey | null>(null);
	let error = $state("");
	const shownError = $derived(errorKey ? t(errorKey) : error);

	// getApiError's fallback, never a sentence: when it comes back, the API said nothing the page shows (or something
	// inAppWords puts the page's own words in place of), and the page's sentence goes in by its key.
	const NO_REASON = "\u0000";

	/** Shows why a request about the invite failed, or sends a session that has ended to sign in. */
	function showFailure(err: unknown, key: MessageKey) {
		const msg = getApiError(err, NO_REASON);
		if (msg === "Session invalid or expired") {
			window.location.href = signInUrl(inviteUrl(code));
			return;
		}
		if (msg === NO_REASON) errorKey = key;
		else error = msg;
	}

	onMount(async () => {
		const botParam = page.url.searchParams.get("bot");
		code = page.url.searchParams.get("code") ?? readCodeFromHash(window.location.hash) ?? "";

		if (botParam) {
			// A bot's ID goes into the paths of the requests about it, and anyone can make this link.
			if (!isUuid(botParam)) {
				errorKey = "public_invite_bad_link";
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
				showFailure(err, "public_invite_expired");
			} finally {
				loading = false;
			}
		} else {
			errorKey = "public_invite_bad_link";
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
		errorKey = null;
		error = "";
		try {
			await joinInvite(code);
			window.location.href = route("/app.html");
		} catch (err) {
			showFailure(err, "public_invite_join_failed");
		} finally {
			joining = false;
		}
	}
</script>

<!-- The sign-in pages' frame, with the invite as a card: mobile's InviteCard, at a page's size. -->
<AuthScene>
	{#if loading}
		<AuthResult state="loading" text={t("public_invite_loading")} />
	{:else if shownError && !invite}
		<AuthResult state="warning" title={t("public_invite_unavailable")} text={shownError}>
			<AuthSubmit variant="secondary" onclick={() => (window.location.href = route("/index.html"))}
				>{t("public_invite_go_back")}</AuthSubmit
			>
		</AuthResult>
	{:else if invite}
		<div class="bg-duvet-card shadow-duvet-raised rounded-[20px] p-6 text-center" data-invite-card>
			<SpaceIcon name={invite.space_name} size={64} class="shadow-duvet-raised select-none" />

			{#snippet invitedLine(text: string)}
				<p class="text-duvet-ink2 mt-4 text-[13px] leading-[1.2] font-medium">{text}</p>
			{/snippet}
			{#snippet spaceName(text: string)}
				<h1 class="text-duvet-ink font-serif-lg mt-1 text-[28px] leading-[1.15] font-medium wrap-break-word">
					{text}
				</h1>
			{/snippet}
			<Rich
				key="public_invite_invited"
				values={{ space: invite.space_name }}
				tags={{ line: invitedLine, name: spaceName }}
			/>

			{#if invite.description}
				<p class="text-duvet-ink2 font-content mt-2 text-[14px] leading-[1.4] wrap-break-word">
					{invite.description}
				</p>
			{/if}

			<div class="mt-3 flex items-center justify-center gap-2">
				<span class="bg-duvet-alive inline-block size-2 rounded-full" aria-hidden="true"></span>
				<span class="text-duvet-ink text-[13.5px]">{t("public_invite_members", { count: invite.member_count })}</span>
			</div>

			<div class="mt-6 flex flex-col gap-2 text-left">
				{#if shownError}
					<AuthNote>{shownError}</AuthNote>
				{/if}

				{#if userSession.token}
					<AuthSubmit busy={joining} onclick={handleJoin}>
						{joining ? t("public_invite_joining") : t("public_invite_join")}
					</AuthSubmit>
				{:else}
					<p class="text-duvet-ink2 font-content text-center text-[14px]">{t("public_invite_sign_in_note")}</p>
					<AuthSubmit onclick={() => (window.location.href = signInUrl(inviteUrl(code)))}
						>{t("public_invite_sign_in")}</AuthSubmit
					>
				{/if}

				<AuthSubmit variant="quiet" onclick={() => (window.location.href = route("/index.html"))}
					>{t("public_invite_not_now")}</AuthSubmit
				>
			</div>
		</div>
	{/if}
</AuthScene>
