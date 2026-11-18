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
			<div class="rounded-card border-duvet-line bg-duvet-bg shadow-duvet-float w-full max-w-md border p-5">
				{#if target}
					<AlertDialog.Title class="text-duvet-ink mb-1 text-sm font-semibold">Ban {target.name}?</AlertDialog.Title>
					<AlertDialog.Description class="text-duvet-ink mb-4 text-sm">
						They're removed from {target.spaceName}, and can't join it again until they're unbanned.
					</AlertDialog.Description>
					<label
						for="ban-reason"
						class="text-duvet-ink2 mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium"
					>
						<span>Reason <span class="text-duvet-ink2 font-normal">(optional)</span></span>
						<span class="tabular-nums {tooLong ? 'text-duvet-danger' : 'text-duvet-ink2'}">{length}/{REASON_MAX}</span>
					</label>
					<textarea
						id="ban-reason"
						bind:this={reasonEl}
						bind:value={reason}
						rows="3"
						disabled={banning}
						placeholder="Why they're banned, for whoever manages the bans"
						class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent w-full resize-none rounded-xl px-3 py-2 text-sm focus-visible:outline-2 disabled:opacity-60"
						onkeydown={(e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
								e.preventDefault();
								void ban();
							}
						}}
					></textarea>
					{#if tooLong}
						<p class="text-duvet-danger mt-1 text-xs">A reason takes {REASON_MAX} characters at most.</p>
					{/if}
					<div class="mt-4 flex justify-end gap-2">
						<AlertDialog.Cancel
							class="text-duvet-ink hover:bg-duvet-card rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
							disabled={banning}
						>
							Cancel
						</AlertDialog.Cancel>
						<button
							class="text-duvet-on-accent rounded-row bg-duvet-danger hover:bg-duvet-danger/85 flex min-w-20 items-center justify-center gap-1.5 px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
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
