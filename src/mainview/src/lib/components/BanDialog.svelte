<script lang="ts">
	import { AlertDialog } from "bits-ui";
	import { getApiError } from "$lib/api/api";
	import { banUser } from "$lib/api/moderation";
	import { banAdded } from "$lib/bans";
	import { banRequest, type ModerationTarget } from "$lib/moderation";
	import { toast } from "$lib/stores/toast.svelte";

	// A member's ban, as a menu's Ban asks it (banRequest), one for the app: a reason or none, 512 characters at most as
	// the API counts them (trimmed, each code point one), then the ban. A refusal shows the API's reason in a toast, and
	// the dialog stays with what was typed, to try again or cancel.
	const REASON_MAX = 512;

	let target = $state.raw<ModerationTarget | null>(null);
	let open = $state(false);
	let reason = $state("");
	let banning = $state(false);
	let reasonEl = $state<HTMLTextAreaElement | null>(null);

	const length = $derived([...reason.trim()].length);
	const tooLong = $derived(length > REASON_MAX);

	$effect(() => {
		const asked = $banRequest;
		if (!asked) return;
		banRequest.set(null);
		target = asked;
		reason = "";
		open = true;
	});

	async function ban() {
		if (!target || banning || tooLong) return;
		const { spaceId, userId, name } = target;
		banning = true;
		try {
			// 201 with the new ban, or 200 with the one already there: either way they're banned.
			banAdded(await banUser(spaceId, userId, reason.trim() || undefined));
			toast(`${name} was banned`, "success");
			open = false;
		} catch (err) {
			toast(getApiError(err, "Couldn't ban them"), "error");
		} finally {
			banning = false;
		}
	}
</script>

<!-- While the ban is on its way it doesn't close: its answer says how it went. -->
<AlertDialog.Root
	{open}
	onOpenChange={(v) => {
		if (!banning) open = v;
	}}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fixed inset-0 z-9998 bg-black/60 backdrop-blur-sm" />
		<AlertDialog.Content
			class="fixed inset-0 z-9999 flex items-center justify-center p-4"
			onOpenAutoFocus={(e) => {
				e.preventDefault();
				reasonEl?.focus();
			}}
		>
			<div class="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
				{#if target}
					<AlertDialog.Title class="mb-1 text-sm font-semibold text-white">Ban {target.name}?</AlertDialog.Title>
					<AlertDialog.Description class="mb-4 text-sm text-zinc-300">
						They're removed from {target.spaceName}, and can't join it again until they're unbanned.
					</AlertDialog.Description>
					<label
						for="ban-reason"
						class="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium text-zinc-400"
					>
						<span>Reason <span class="font-normal text-zinc-500">(optional)</span></span>
						<span class="tabular-nums {tooLong ? 'text-red-400' : 'text-zinc-500'}">{length}/{REASON_MAX}</span>
					</label>
					<textarea
						id="ban-reason"
						bind:this={reasonEl}
						bind:value={reason}
						rows="3"
						disabled={banning}
						placeholder="Why they're banned, for whoever manages the bans"
						class="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 disabled:opacity-60"
						onkeydown={(e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
								e.preventDefault();
								void ban();
							}
						}}
					></textarea>
					{#if tooLong}
						<p class="mt-1 text-xs text-red-400">A reason takes {REASON_MAX} characters at most.</p>
					{/if}
					<div class="mt-4 flex justify-end gap-2">
						<AlertDialog.Cancel
							class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
							disabled={banning}
						>
							Cancel
						</AlertDialog.Cancel>
						<button
							class="text-fixed-white flex min-w-20 items-center justify-center gap-1.5 rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-red-500 disabled:opacity-50"
							disabled={banning || tooLong}
							onclick={ban}
						>
							{#if banning}
								<div
									class="border-fixed-white/30 border-t-fixed-white size-3.5 animate-spin rounded-full border-2"
								></div>
								Banning…
							{:else}
								Ban
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
