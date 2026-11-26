<script lang="ts">
	import { RadioGroup } from "bits-ui";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { encryption, shareHistory } from "$lib/e2e/engine.svelte";
	import { SHARE_RANGES, type ShareRange } from "$lib/e2e/engine/history";
	import { pickedRange, RANGE_WORDS, shareFromDialog } from "$lib/e2e/sharing";
	import { t } from "$lib/i18n";
	import { shareHistoryRequest } from "$lib/member-actions";
	import { ERROR_NOTE, spinnerClass } from "$lib/overlay-forms";

	// A conversation's history shared with another member (PLAN-E2E-CLIENTES.md, Task 30; decision 26), one for the app,
	// as a member menu's Share history asks it (shareHistoryRequest): how far back, then the share, which goes on the
	// person's tap alone, once this device is ready. Once the API took it the dialog closes, as its notice shows in the
	// chat, unless it was cut to the newest, which it says; one that didn't go says why, the hour's ten shares among
	// them, and Share goes again.
	type Asked = { conversationId: string; userId: string; name: string };

	let asked = $state.raw<Asked | null>(null);
	let open = $state(false);
	let range = $state<ShareRange>("week");
	let sharing = $state(false);
	/** What the dialog says after the share was answered: `done` once it went (cut), so nothing more is offered. */
	let said = $state<{ text: string; done: boolean } | null>(null);
	const ready = $derived(encryption.state.name === "ready");

	$effect(() => {
		const request = $shareHistoryRequest;
		if (!request) return;
		shareHistoryRequest.set(null);
		asked = request;
		range = "week";
		said = null;
		open = true;
	});

	async function share() {
		if (!asked || sharing || !ready) return;
		const { conversationId, userId, name } = asked;
		sharing = true;
		said = null;
		try {
			said = await shareFromDialog((picked) => shareHistory(conversationId, userId, picked), range, name);
			if (said === null) open = false;
		} finally {
			sharing = false;
		}
	}
</script>

<!-- While the share is on its way it doesn't close: its answer says how it went. -->
<Sheet
	bind:open={
		() => open,
		(next) => {
			if (!sharing) open = next;
		}
	}
	title={asked ? t("e2e_share_history_with", { name: asked.name }) : ""}
	description={asked ? t("e2e_share_history_line", { name: asked.name }) : undefined}
	class="max-w-[440px]"
	interactOutsideBehavior={sharing ? "ignore" : "close"}
	escapeKeydownBehavior={sharing ? "ignore" : "close"}
>
	{#if asked}
		<RadioGroup.Root
			bind:value={() => range, (picked) => (range = pickedRange(picked, range))}
			disabled={sharing || !!said?.done}
			aria-label={t("e2e_share_history")}
			class="flex flex-col gap-1"
		>
			{#each SHARE_RANGES as option (option)}
				<RadioGroup.Item
					value={option}
					class="group text-duvet-ink hover:bg-duvet-ink/5 data-[state=checked]:bg-duvet-ink/10 flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] data-disabled:opacity-50"
				>
					<span
						class="ring-duvet-line group-data-[state=checked]:ring-duvet-accent flex size-4 shrink-0 items-center justify-center rounded-full ring-2"
						aria-hidden="true"
					>
						<span class="bg-duvet-accent size-2 rounded-full opacity-0 group-data-[state=checked]:opacity-100"></span>
					</span>
					<span class="first-letter:uppercase">{t(RANGE_WORDS[option])}</span>
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
		{#if said}
			<p class={said.done ? "text-duvet-ink2 text-[13px] leading-[1.35]" : ERROR_NOTE} role="status">{said.text}</p>
		{:else if !ready}
			<p class={ERROR_NOTE} role="status">{t("e2e_not_ready")}</p>
		{/if}
	{/if}
	{#snippet foot()}
		<span></span>
		{#if !said?.done}
			<Button variant="quiet" disabled={sharing} onclick={() => (open = false)}>{t("e2e_cancel")}</Button>
			<Button class="min-w-20" disabled={sharing || !ready} onclick={share}>
				{#if sharing}
					<span class={spinnerClass()} aria-hidden="true"></span>
					{t("e2e_share_history_sharing")}
				{:else}
					{t("e2e_share_history_send")}
				{/if}
			</Button>
		{/if}
	{/snippet}
</Sheet>
