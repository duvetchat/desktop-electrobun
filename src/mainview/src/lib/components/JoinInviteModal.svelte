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
			joinError = getApiError(err, "Failed to join the Space.");
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
				class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float w-full max-w-sm overflow-hidden border"
			>
				<!-- Header -->
				<div class="border-duvet-line flex items-center justify-between border-b px-5 py-4">
					<h2 class="text-duvet-ink text-base font-semibold">Join a Space</h2>
					<button
						class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink rounded-lg p-1.5 transition-colors"
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
							<div class="border-duvet-ink2/40 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"></div>
						</div>
					{:else if loadError}
						<p class="text-duvet-danger py-6 text-center text-sm">
							{loadError}
						</p>
					{:else if invite}
						<!-- Server preview -->
						<div class="mb-5 flex items-center gap-4">
							<div
								class="bg-duvet-chosen text-duvet-chosen-ink shadow-duvet-raised flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-xl font-bold select-none"
							>
								{invite.space_name.charAt(0).toUpperCase()}
							</div>
							<div class="min-w-0">
								<p class="text-duvet-ink truncate text-base font-semibold">
									{invite.space_name}
								</p>
								{#if invite.description}
									<p class="text-duvet-ink2 mt-0.5 truncate text-xs">
										{invite.description}
									</p>
								{/if}
								<div class="mt-1 flex items-center gap-1.5">
									<span class="bg-duvet-alive inline-block h-2 w-2 rounded-full"></span>
									<span class="text-duvet-ink2 text-xs"
										>{invite.member_count}
										{invite.member_count === 1 ? "member" : "members"}</span
									>
								</div>
							</div>
						</div>

						{#if joinError}
							<p class="text-duvet-danger mb-3 text-sm">{joinError}</p>
						{/if}

						<div class="flex justify-end gap-2">
							<button
								class="text-duvet-ink hover:bg-duvet-card hover:text-duvet-ink rounded-md px-4 py-2 text-sm transition-colors"
								onclick={() => (open = false)}
							>
								Cancel
							</button>
							<button
								class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-4 py-2 text-sm font-bold transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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
