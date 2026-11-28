<script lang="ts">
	import { getApiError } from "$lib/api/api";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { ERROR_NOTE, spinnerClass } from "$lib/overlay-forms";
	import { getInvite, joinInvite, type InviteInfo } from "$lib/api/invites";
	import { toast } from "$lib/stores/toast.svelte";
	import { route } from "$lib/common/common";
	import { t } from "$lib/i18n";

	let {
		open = $bindable(false),
		inviteCode = $bindable(""),
	}: {
		open?: boolean;
		inviteCode?: string;
	} = $props();

	let invite = $state<InviteInfo | null>(null);
	let loading = $state(false);
	let joining = $state(false);
	let joined = $state(false);
	// The API's error on joining, or its fallback. An invite that didn't load is a flag, drawn in the app's language of
	// the moment.
	let error = $state("");
	let notFound = $state(false);

	$effect(() => {
		if (open && inviteCode) {
			loading = true;
			error = "";
			notFound = false;
			invite = null;
			joined = false;
			getInvite(inviteCode)
				.then((data) => {
					invite = data;
				})
				.catch(() => {
					notFound = true;
				})
				.finally(() => {
					loading = false;
				});
		}
	});

	async function handleJoin() {
		joining = true;
		error = "";
		try {
			await joinInvite(inviteCode);
			joined = true;
			toast(t("people_space_invite_joined"), "success");
		} catch (err) {
			error = getApiError(err, t("people_join_failed"));
		} finally {
			joining = false;
		}
	}
</script>

<Sheet bind:open title={t("people_space_invite_title")} class="max-w-[420px]">
	{#if loading}
		<div class="text-duvet-ink2 flex items-center justify-center py-8">
			<div class={spinnerClass("lg")} role="status" aria-label={t("people_invite_loading")}></div>
		</div>
	{:else if notFound}
		<p class="text-duvet-danger py-4 text-center text-[13px]">{t("people_invite_not_found")}</p>
	{:else if invite}
		<div class="bg-duvet-card shadow-duvet-raised flex items-center gap-3.5 rounded-2xl p-3">
			<div
				class="bg-duvet-chosen text-duvet-chosen-ink grid size-12 shrink-0 place-items-center rounded-[13px] text-lg font-bold select-none"
			>
				{invite.space_name.charAt(0).toUpperCase()}
			</div>
			<div class="min-w-0">
				<p class="text-duvet-ink truncate text-[14px] font-semibold">{invite.space_name}</p>
				{#if invite.description}
					<p class="text-duvet-ink2 line-clamp-2 text-xs">{invite.description}</p>
				{/if}
				<div class="mt-0.5 flex items-center gap-1.5">
					<span class="bg-duvet-alive inline-block size-2 shrink-0 rounded-full"></span>
					<span class="text-duvet-ink2 text-xs">
						{t("people_space_invite_member_count", { count: invite.member_count })}
					</span>
				</div>
			</div>
		</div>

		{#if error}
			<p role="alert" class={ERROR_NOTE}>{error}</p>
		{/if}

		{#if joined}
			<div
				class="bg-duvet-chosen text-duvet-chosen-ink rounded-control flex h-[34px] w-full items-center justify-center text-[13px] font-medium"
			>
				{t("people_space_invite_in")}
			</div>
		{:else}
			<Button class="w-full" onclick={handleJoin} disabled={joining}>
				{joining ? t("people_join_joining") : t("people_space_invite_join")}
			</Button>
		{/if}
	{/if}
</Sheet>
