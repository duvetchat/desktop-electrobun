<script lang="ts">
	import { onMount } from "svelte";
	import { getApiError } from "$lib/api/api";
	import { getInvite, joinInvite } from "$lib/api/invites";
	import type { InviteInfo } from "$lib/api/invites";
	import { userSession } from "$lib/stores.svelte";
	import { route } from "$lib/common/common";
	import { signInUrl } from "$lib/urls";
	import { MESSAGE_INVITE_CARD } from "$lib/message-styles";

	let { code }: { code: string } = $props();

	function inviteUrl(codeValue: string) {
		return route(`/invite.html?code=${encodeURIComponent(codeValue)}`);
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
			window.location.href = signInUrl(inviteUrl(code));
			return;
		}
		joining = true;
		joinError = "";
		try {
			await joinInvite(code);
			joined = true;
		} catch (err) {
			joinError = getApiError(err, "Couldn't join the Space.");
		} finally {
			joining = false;
		}
	}
</script>

{#if loading}
	<div class={MESSAGE_INVITE_CARD}>
		<div class="bg-duvet-ink/10 mb-3 h-3 w-44 animate-pulse rounded"></div>
		<div class="mb-4 flex items-center gap-3">
			<div class="bg-duvet-ink/10 h-12 w-12 shrink-0 animate-pulse rounded-xl"></div>
			<div class="flex flex-col gap-1.5">
				<div class="bg-duvet-ink/10 h-4 w-28 animate-pulse rounded"></div>
				<div class="bg-duvet-ink/10 h-3 w-20 animate-pulse rounded"></div>
			</div>
		</div>
		<div class="bg-duvet-ink/10 h-9 w-full animate-pulse rounded-md"></div>
	</div>
{:else if !error && invite}
	<div class={MESSAGE_INVITE_CARD}>
		<p class="text-duvet-ink2 mb-3 text-[13px] font-bold">You've been invited to join a Space</p>
		<div class="mb-4 flex items-center gap-3">
			<!-- Server icon -->
			<div
				class="bg-duvet-chosen text-duvet-chosen-ink shadow-duvet-raised flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold select-none"
			>
				{invite.space_name.charAt(0).toUpperCase()}
			</div>
			<div class="min-w-0">
				<p class="text-duvet-ink truncate text-sm font-semibold">
					{invite.space_name}
				</p>
				{#if invite.description}
					<p class="text-duvet-ink2 line-clamp-2 text-xs wrap-break-word">
						{invite.description}
					</p>
				{/if}
				<div class="mt-0.5 flex items-center gap-1.5">
					<span class="bg-duvet-alive inline-block h-2 w-2 shrink-0 rounded-full"></span>
					<span class="text-duvet-ink2 text-xs">
						{formatCount(invite.member_count)}
						{invite.member_count === 1 ? "Member" : "Members"}
					</span>
				</div>
			</div>
		</div>

		{#if joinError}
			<p class="text-duvet-danger mb-2 text-xs">{joinError}</p>
		{/if}

		{#if joined}
			<div class="bg-duvet-chosen text-duvet-chosen-ink w-full rounded-xl py-2 text-center text-sm font-bold">
				You're in.
			</div>
		{:else}
			<button
				class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised w-full rounded-xl py-2 text-sm font-bold transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
				onclick={handleJoin}
				disabled={joining}
			>
				{joining ? "Joining…" : "Join Space"}
			</button>
		{/if}
	</div>
{/if}
