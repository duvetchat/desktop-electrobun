<script lang="ts">
	import { X as XIcon, Link2 as LinkSimpleIcon, Copy as CopySimpleIcon, Check as CheckIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import { Dialog } from "bits-ui";
	import { createRoomInvite } from "$lib/api/rooms";
	import type { Channel } from "$lib/types";
	import { route, DUVET_DOMAIN } from "$lib/common/common";

	let {
		open = $bindable(false),
		channel = null,
		spaceId = "",
	}: {
		open?: boolean;
		channel?: Channel | null;
		spaceId?: string;
	} = $props();

	let inviteLink = $state("");
	let isLoading = $state(false);
	let copied = $state(false);
	let genError = $state("");
	let linkInput = $state<HTMLInputElement | undefined>(undefined);

	// Re-generate whenever the modal opens or the channel changes

	$effect(() => {
		if (!open || !channel) {
			return;
		}
		generate();
	});

	async function generate() {
		if (!channel || !spaceId) return;
		inviteLink = "";
		genError = "";
		copied = false;
		isLoading = true;
		try {
			const code = await createRoomInvite(spaceId, channel.id);
			inviteLink = `${DUVET_DOMAIN}/invite?code=${encodeURIComponent(code)}`;
		} catch (err) {
			genError = getApiError(err, "Failed to generate link.");
		} finally {
			isLoading = false;
		}
	}

	function copyLink() {
		if (!inviteLink) return;
		navigator.clipboard.writeText(inviteLink);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-51 flex items-center justify-center p-4">
			<div
				class="w-full max-w-md overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
			>
				<!-- Header -->
				<div class="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
					<div class="flex items-center gap-2.5">
						<LinkSimpleIcon class="size-4 text-stone-300" />
						<div>
							<h2 class="text-base leading-tight font-semibold text-white">Invite People</h2>
							{#if channel}
								<p class="text-xs text-zinc-400">#{channel.name}</p>
							{/if}
						</div>
					</div>
					<button
						class="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
						onclick={() => (open = false)}
						aria-label="Close"
					>
						<XIcon class="size-5" />
					</button>
				</div>

				<!-- Body -->
				<div class="space-y-4 px-6 py-5">
					<p class="text-sm text-zinc-300">Share this invite link. Anyone with this link can join the server.</p>

					{#if isLoading}
						<div class="flex items-center justify-center py-8">
							<div class="h-6 w-6 animate-spin rounded-full border-2 border-stone-400 border-t-transparent"></div>
						</div>
					{:else if genError}
						<p class="py-4 text-center text-sm text-red-400">
							{genError}
						</p>
						<button
							class="w-full rounded-lg bg-zinc-800 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-700"
							onclick={generate}
						>
							Try again
						</button>
					{:else if inviteLink}
						<div class="flex items-center gap-2">
							<input
								bind:this={linkInput}
								type="text"
								readonly
								value={inviteLink}
								class="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 font-mono text-sm text-white focus:ring-1 focus:ring-stone-500 focus:outline-none"
								onclick={() => linkInput?.select()}
							/>
							<button
								class="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-white transition-colors
                            {copied ? 'bg-stone-600 hover:bg-stone-500' : 'bg-stone-600 hover:bg-stone-500'}"
								onclick={copyLink}
								aria-label="Copy link"
							>
								{#if copied}
									<CheckIcon class="size-4" />
									Copied!
								{:else}
									<CopySimpleIcon class="size-4" />
									Copy
								{/if}
							</button>
						</div>
						<p class="text-xs text-zinc-400">This link never expires.</p>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
