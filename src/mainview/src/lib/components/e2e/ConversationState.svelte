<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";
	import type { ConversationState } from "$lib/e2e/engine/engine";
	import { t } from "$lib/i18n";

	// What a conversation says over its message box of its encrypted group (PLAN-E2E-CLIENTES.md, «Avisos»): nothing while
	// the group goes on. Blocked, its restart for whoever may make it and the wait for the others; waiting for its owner to
	// open it, or for another member to let this device back in; members other than those this device first saw, with the
	// person's yes.
	let {
		conversationState,
		ownerName,
		onRestart,
		onAccept,
	}: {
		conversationState: ConversationState | null;
		/** The conversation's owner, by the name the app shows them. */
		ownerName: string;
		onRestart: () => Promise<void>;
		onAccept: () => Promise<void>;
	} = $props();

	let busy = $state(false);

	const shown = $derived.by((): { text: string; detail?: string; label?: string; run?: () => Promise<void> } | null => {
		const said = conversationState;
		switch (said?.name) {
			case "blocked":
				if (said.restart === "mine") return { text: t("e2e_blocked"), label: t("e2e_blocked_restart"), run: onRestart };
				if (said.restart === "owner") {
					return { text: t("e2e_blocked"), detail: t("e2e_blocked_wait", { owner: ownerName }) };
				}
				return { text: t("e2e_blocked") };
			case "wait_owner":
				return { text: t("e2e_wait_owner", { owner: ownerName }) };
			case "wait_rejoin":
				return { text: t("e2e_wait_rejoin") };
			case "members_changed":
				return { text: t("e2e_members_changed"), label: t("e2e_members_accept"), run: onAccept };
			default:
				return null;
		}
	});

	async function act(run: () => Promise<void>) {
		busy = true;
		try {
			await run();
		} catch (error) {
			console.error("[e2e] What the person asked for failed:", error);
		} finally {
			busy = false;
		}
	}
</script>

{#if shown}
	<div class="text-duvet-ink2 flex items-center gap-3 px-1.5 pb-2 text-[12.5px] leading-[1.3]" role="status">
		<span class="min-w-0 flex-1"
			>{shown.text}{#if shown.detail}{" "}{shown.detail}{/if}</span
		>
		{#if shown.run && shown.label}
			{@const run = shown.run}
			<Button size="sm" disabled={busy} onclick={() => void act(run)}>{shown.label}</Button>
		{/if}
	</div>
{/if}
