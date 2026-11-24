<script lang="ts">
	import { getApiError } from "$lib/api/api";
	import { banUser } from "$lib/api/moderation";
	import { t } from "$lib/i18n";
	import { banAdded } from "$lib/bans";
	import { banRequest, type ModerationTarget } from "$lib/moderation";
	import { toast } from "$lib/stores/toast.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Rich from "$lib/components/Rich.svelte";
	import { FIELD_ERROR, FIELD_LABEL, fieldClass, spinnerClass } from "$lib/overlay-forms";

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
			toast(t("mod_ban_done", { name }), "success");
			open = false;
		} catch (err) {
			toast(getApiError(err, t("mod_ban_failed")), "error");
		} finally {
			banning = false;
		}
	}
</script>

{#snippet muted(text: string)}<span class="font-normal">{text}</span>{/snippet}

<!-- While the ban is on its way it doesn't close: its answer says how it went. -->
<Sheet
	bind:open={
		() => open,
		(next) => {
			if (!banning) open = next;
		}
	}
	title={target ? t("mod_ban_title", { name: target.name }) : ""}
	description={target ? t("mod_ban_description", { space: target.spaceName }) : undefined}
	closeLabel={t("mod_ban_cancel")}
	class="max-w-[440px]"
	interactOutsideBehavior={banning ? "ignore" : "close"}
	escapeKeydownBehavior={banning ? "ignore" : "close"}
	onOpenAutoFocus={(e) => {
		e.preventDefault();
		reasonEl?.focus();
	}}
>
	{#if target}
		<div class="flex flex-col gap-1.5">
			<label for="ban-reason" class="{FIELD_LABEL} flex items-baseline justify-between gap-2">
				<span><Rich key="mod_ban_reason_label" tags={{ muted }} /></span>
				<span class="tabular-nums {tooLong ? 'text-duvet-danger' : ''}"
					>{t("mod_ban_reason_count", { count: length, max: REASON_MAX })}</span
				>
			</label>
			<textarea
				id="ban-reason"
				bind:this={reasonEl}
				bind:value={reason}
				rows="3"
				disabled={banning}
				placeholder={t("mod_ban_reason_placeholder")}
				class={fieldClass("area")}
				onkeydown={(e) => {
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						void ban();
					}
				}}
			></textarea>
			{#if tooLong}
				<p class={FIELD_ERROR}>{t("mod_ban_reason_too_long", { max: REASON_MAX })}</p>
			{/if}
		</div>
	{/if}
	{#snippet foot()}
		<span></span>
		<Button variant="quiet" disabled={banning} onclick={() => (open = false)}>{t("mod_ban_cancel")}</Button>
		<Button variant="danger" class="min-w-20" disabled={banning || tooLong} onclick={ban}>
			{#if banning}
				<span class={spinnerClass()} aria-hidden="true"></span>
				{t("mod_ban_banning")}
			{:else}
				{t("mod_ban_confirm")}
			{/if}
		</Button>
	{/snippet}
</Sheet>
