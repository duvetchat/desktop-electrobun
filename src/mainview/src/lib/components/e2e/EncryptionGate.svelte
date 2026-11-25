<script lang="ts">
	import { X as XIcon } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Dialog from "$lib/components/ui/Dialog.svelte";
	import { GLASS, iconButtonClass } from "$lib/components/ui/recipes";
	import type { EngineState } from "$lib/e2e/engine/engine";
	import { t } from "$lib/i18n";
	import RecoveryKeySheet from "./RecoveryKeySheet.svelte";
	import UpdateNotice from "./UpdateNotice.svelte";

	// What the app says of its encrypted conversations by the engine's state (PLAN-E2E-CLIENTES.md, «El motor», its
	// states): nothing while it starts or once it's ready. A first device's recovery key, once made, is a dialog only
	// "I saved it" and its upload close (decision 23, Ruling 13). Every other state is a bar at the bottom with what the
	// person can do, which its × hides until the state changes: the rest of the app, Spaces among it, goes on.
	let {
		encryption,
		web,
		onMakeIdentity,
		onKeySaved,
		onStartOver,
	}: {
		encryption: EngineState;
		/** The web app, whose unsupported state is its browser's; the desktop app's is its platform's. */
		web: boolean;
		onMakeIdentity: () => Promise<void>;
		onKeySaved: () => Promise<void>;
		onStartOver: () => Promise<void>;
	} = $props();

	let hiddenFor = $state<string | null>(null);
	let busy = $state(false);

	const bar = $derived.by((): { text: string; label?: string; run?: () => Promise<void> } | null => {
		switch (encryption.name) {
			case "first_device":
				return encryption.finishing
					? { text: t("e2e_first_device_finish"), label: t("e2e_finish"), run: onMakeIdentity }
					: { text: t("e2e_first_device"), label: t("e2e_set_up"), run: onMakeIdentity };
			case "new_device":
				return { text: t("e2e_new_device") };
			case "removed":
				return { text: t("e2e_removed_device"), label: t("e2e_set_up_again"), run: onStartOver };
			case "locked":
				return { text: t("e2e_locked") };
			case "unsupported":
				return { text: web ? t("e2e_unsupported_browser") : t("e2e_no_e2e_here") };
			case "failed":
				return encryption.lostKey
					? { text: t("e2e_lost_key"), label: t("e2e_delete_device"), run: onStartOver }
					: { text: t("e2e_failed") };
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

{#if encryption.name === "first_device" && encryption.recoveryKey}
	<Dialog open title={t("e2e_recovery_title")} escapeKeydownBehavior="ignore">
		{t("e2e_recovery_why")}
		{#snippet body()}
			<RecoveryKeySheet
				recoveryKey={encryption.name === "first_device" ? (encryption.recoveryKey ?? "") : ""}
				onContinue={onKeySaved}
			/>
		{/snippet}
	</Dialog>
{:else if hiddenFor !== encryption.name && (bar || encryption.name === "update")}
	<!-- At the bottom centre, as the notifications' bar: above where a toast shows. -->
	<div
		class="{GLASS} animate-toast-in text-duvet-ink fixed bottom-16 left-1/2 z-9990 flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-[18px] py-2 pr-2 pl-3.5 text-[13px]"
		role="region"
		aria-label={t("e2e_gate")}
	>
		{#if encryption.name === "update"}
			<div class="min-w-0 flex-1"><UpdateNotice minimum={encryption.minimum} /></div>
		{:else if bar}
			<span class="min-w-0 flex-1">{bar.text}</span>
			{#if bar.run && bar.label}
				{@const run = bar.run}
				<Button size="sm" disabled={busy} onclick={() => void act(run)}>{bar.label}</Button>
			{/if}
		{/if}
		<button
			type="button"
			class={iconButtonClass("sm")}
			aria-label={t("e2e_dismiss")}
			onclick={() => (hiddenFor = encryption.name)}
		>
			<XIcon size={14} />
		</button>
	</div>
{/if}
