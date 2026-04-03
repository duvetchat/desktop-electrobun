<script lang="ts">
	import { Dialog } from "bits-ui";
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
			error = err instanceof Error ? err.message : "Failed to join.";
		} finally {
			joining = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<Dialog.Content class="fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-base font-semibold text-white">Server Invite</h2>
				<Dialog.Close class="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white">
					<XIcon class="size-5" />
				</Dialog.Close>
			</div>

			{#if loading}
				<div class="flex items-center justify-center py-8">
					<div class="h-8 w-8 animate-spin rounded-full border-3 border-stone-500 border-t-transparent"></div>
				</div>
			{:else if error && !invite}
				<p class="py-4 text-center text-sm text-red-400">{error}</p>
			{:else if invite}
				<div class="mb-4 flex items-center gap-3">
					<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-stone-500 to-stone-700 text-lg font-bold text-white select-none">
						{invite.space_name.charAt(0).toUpperCase()}
					</div>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-white">{invite.space_name}</p>
						{#if invite.description}
							<p class="line-clamp-2 text-xs text-zinc-400">{invite.description}</p>
						{/if}
						<div class="mt-0.5 flex items-center gap-1.5">
							<span class="inline-block h-2 w-2 shrink-0 rounded-full bg-stone-300"></span>
							<span class="text-xs text-zinc-400">
								{numberFormatter.format(invite.member_count)}
								{invite.member_count === 1 ? "Member" : "Members"}
							</span>
						</div>
					</div>
				</div>

				{#if error}
					<p class="mb-2 text-xs text-red-400">{error}</p>
				{/if}

				{#if joined}
					<div class="w-full rounded-md bg-stone-700 py-2.5 text-center text-sm font-semibold text-white">You're in!</div>
				{:else}
					<button
						class="w-full rounded-md bg-stone-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-stone-500 disabled:opacity-50"
						onclick={handleJoin}
						disabled={joining}
					>
						{joining ? "Joining..." : "Join Server"}
					</button>
				{/if}
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
