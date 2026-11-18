<script lang="ts">
	import { getApiError } from "$lib/api/api";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { ERROR_NOTE, spinnerClass } from "$lib/overlay-forms";
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
			loadError = getApiError(err, "Invite not found or has expired.");
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
			joinError = getApiError(err, "Couldn't join the Space.");
		} finally {
			joining = false;
		}
	}
</script>

<Sheet bind:open title="Join a Space" class="max-w-[420px]">
	{#if loading}
		<div class="text-duvet-ink2 flex items-center justify-center py-8">
			<div class={spinnerClass("lg")} role="status" aria-label="Loading the invite"></div>
		</div>
	{:else if loadError}
		<p class="text-duvet-danger py-6 text-center text-[13px]">
			{loadError}
		</p>
	{:else if invite}
		<!-- The Space's preview -->
		<div class="bg-duvet-card shadow-duvet-raised flex items-center gap-3.5 rounded-2xl p-3">
			<div
				class="bg-duvet-chosen text-duvet-chosen-ink grid size-14 shrink-0 place-items-center rounded-[15px] text-xl font-bold select-none"
			>
				{invite.space_name.charAt(0).toUpperCase()}
			</div>
			<div class="min-w-0">
				<p class="text-duvet-ink truncate text-[15px] font-semibold">
					{invite.space_name}
				</p>
				{#if invite.description}
					<p class="text-duvet-ink2 mt-0.5 truncate text-xs">
						{invite.description}
					</p>
				{/if}
				<div class="mt-1 flex items-center gap-1.5">
					<span class="bg-duvet-alive inline-block size-2 rounded-full"></span>
					<span class="text-duvet-ink2 text-xs"
						>{invite.member_count}
						{invite.member_count === 1 ? "member" : "members"}</span
					>
				</div>
			</div>
		</div>

		{#if joinError}
			<p role="alert" class={ERROR_NOTE}>{joinError}</p>
		{/if}

		<div class="mt-1 flex items-center justify-end gap-2">
			<Button variant="quiet" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleJoin} disabled={joining}>
				{joining ? "Joining…" : "Accept invite"}
			</Button>
		</div>
	{/if}
</Sheet>
