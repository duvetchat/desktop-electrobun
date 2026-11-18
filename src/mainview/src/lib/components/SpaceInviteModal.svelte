<script lang="ts">
	import { Dialog } from "bits-ui";
	import { getApiError } from "$lib/api/api";
	import { X as XIcon } from "@lucide/svelte";
	import { getInvite, joinInvite, type InviteInfo } from "$lib/api/invites";
	import { toast } from "$lib/stores/toast.svelte";
	import { route } from "$lib/common/common";

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
	let error = $state("");

	const numberFormatter = new Intl.NumberFormat(typeof navigator !== "undefined" ? navigator.language : "en-US");

	$effect(() => {
		if (open && inviteCode) {
			loading = true;
			error = "";
			invite = null;
			joined = false;
			getInvite(inviteCode)
				.then((data) => {
					invite = data;
				})
				.catch(() => {
					error = "Invite not found or has expired.";
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
			toast("Joined!", "success");
		} catch (err) {
			error = getApiError(err, "Failed to join.");
		} finally {
			joining = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<Dialog.Content
			class="rounded-card border-duvet-line bg-duvet-bg shadow-duvet-float fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 border p-6"
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-duvet-ink text-base font-semibold">Space Invite</h2>
				<Dialog.Close class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink rounded-md p-1 transition-colors">
					<XIcon class="size-5" />
				</Dialog.Close>
			</div>

			{#if loading}
				<div class="flex items-center justify-center py-8">
					<div class="border-duvet-ink2/40 h-8 w-8 animate-spin rounded-full border-3 border-t-transparent"></div>
				</div>
			{:else if error && !invite}
				<p class="text-duvet-danger py-4 text-center text-sm">{error}</p>
			{:else if invite}
				<div class="mb-4 flex items-center gap-3">
					<div
						class="bg-duvet-chosen text-duvet-chosen-ink shadow-duvet-raised flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold select-none"
					>
						{invite.space_name.charAt(0).toUpperCase()}
					</div>
					<div class="min-w-0">
						<p class="text-duvet-ink truncate text-sm font-semibold">{invite.space_name}</p>
						{#if invite.description}
							<p class="text-duvet-ink2 line-clamp-2 text-xs">{invite.description}</p>
						{/if}
						<div class="mt-0.5 flex items-center gap-1.5">
							<span class="bg-duvet-alive inline-block h-2 w-2 shrink-0 rounded-full"></span>
							<span class="text-duvet-ink2 text-xs">
								{numberFormatter.format(invite.member_count)}
								{invite.member_count === 1 ? "Member" : "Members"}
							</span>
						</div>
					</div>
				</div>

				{#if error}
					<p class="text-duvet-danger mb-2 text-xs">{error}</p>
				{/if}

				{#if joined}
					<div class="bg-duvet-chosen text-duvet-chosen-ink w-full rounded-xl py-2.5 text-center text-sm font-bold">
						You're in!
					</div>
				{:else}
					<button
						class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised w-full rounded-xl py-2.5 text-sm font-bold transition-colors hover:brightness-110 disabled:opacity-50"
						onclick={handleJoin}
						disabled={joining}
					>
						{joining ? "Joining..." : "Join Space"}
					</button>
				{/if}
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
