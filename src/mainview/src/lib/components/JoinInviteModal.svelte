<script lang="ts">
	import { X as XIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import { Dialog } from "bits-ui";
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
			joinError = getApiError(err, "Failed to join server.");
		} finally {
			joining = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-51 flex items-center justify-center p-4">
			<div
				class="w-full max-w-sm overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
			>
				<!-- Header -->
				<div class="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
					<h2 class="text-base font-semibold text-white">Join a Server</h2>
					<button
						class="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
						onclick={() => (open = false)}
						aria-label="Close"
					>
						<XIcon class="size-5" />
					</button>
				</div>

				<!-- Body -->
				<div class="px-5 py-5">
					{#if loading}
						<div class="flex items-center justify-center py-8">
							<div class="h-6 w-6 animate-spin rounded-full border-2 border-stone-400 border-t-transparent"></div>
						</div>
					{:else if loadError}
						<p class="py-6 text-center text-sm text-red-400">
							{loadError}
						</p>
					{:else if invite}
						<!-- Server preview -->
						<div class="mb-5 flex items-center gap-4">
							<div
								class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-stone-500 to-stone-700 text-xl font-bold text-white select-none"
							>
								{invite.space_name.charAt(0).toUpperCase()}
							</div>
							<div class="min-w-0">
								<p class="truncate text-base font-semibold text-white">
									{invite.space_name}
								</p>
								{#if invite.description}
									<p class="mt-0.5 truncate text-xs text-zinc-400">
										{invite.description}
									</p>
								{/if}
								<div class="mt-1 flex items-center gap-1.5">
									<span class="inline-block h-2 w-2 rounded-full bg-stone-300"></span>
									<span class="text-xs text-zinc-400"
										>{invite.member_count}
										{invite.member_count === 1 ? "member" : "members"}</span
									>
								</div>
							</div>
						</div>

						{#if joinError}
							<p class="mb-3 text-sm text-red-400">{joinError}</p>
						{/if}

						<div class="flex justify-end gap-2">
							<button
								class="rounded-md px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
								onclick={() => (open = false)}
							>
								Cancel
							</button>
							<button
								class="rounded-md bg-stone-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-500 disabled:cursor-not-allowed disabled:opacity-50"
								onclick={handleJoin}
								disabled={joining}
							>
								{joining ? "Joining…" : "Accept Invite"}
							</button>
						</div>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
