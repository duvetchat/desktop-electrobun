<script lang="ts">
	import { X as XIcon } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Dialog from "$lib/components/ui/Dialog.svelte";
	import { GLASS, iconButtonClass } from "$lib/components/ui/recipes";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import type { EngineState } from "$lib/e2e/engine/engine";
	import { t } from "$lib/i18n";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import ApprovalPrompt, { approvalTitle } from "./ApprovalPrompt.svelte";
	import DeviceSetupCard from "./DeviceSetupCard.svelte";
	import RecoveryKeySheet from "./RecoveryKeySheet.svelte";
	import UpdateNotice from "./UpdateNotice.svelte";

	// What the app says of its encrypted conversations by the engine's state (PLAN-E2E-CLIENTES.md, «El motor», its
	// states): nothing while it starts or once it's ready. A first device's recovery key, once made, is a dialog only
	// "I saved it" and its upload close (decision 23, Ruling 13), and so are the new one of a change of keys (Task 24)
	// and starting over's (Task 26), which, made before the app closed, are a bar whose Finish brings them back. A new
	// device's bar opens its setup in a sheet (Task 26), and another device's request to be approved is a question of
	// its own on a ready one. Every other state is a bar at the bottom with what the person can do, which its × hides
	// until the state changes: the rest of the app, Spaces among it, goes on. The page stacks the bar with the app's
	// other bottom bars. What deletes the device's data asks first.
	let {
		encryption,
		web,
		onMakeIdentity,
		onKeySaved,
		onLater,
		onStartOver,
		onFinishKeys,
		setupActions,
		approvalActions,
	}: {
		encryption: EngineState;
		/** The web app, whose unsupported state is its browser's; the desktop app's is its platform's. */
		web: boolean;
		onMakeIdentity: () => Promise<void>;
		onKeySaved: () => Promise<void>;
		/** The key's sheet closed after its upload failed: its upload waits for Finish. */
		onLater: () => Promise<void>;
		onStartOver: () => Promise<void>;
		/** A change of keys made before the app closed, its key shown again to be saved. */
		onFinishKeys: () => Promise<void>;
		/** A new device's setup: the recovery key, another device's approval, or starting over (Task 26). */
		setupActions: {
			recover(recoveryKey: string): Promise<void>;
			beginApproval(): Promise<void>;
			useCode(): Promise<void>;
			acceptCode(code: string): Promise<void>;
			endApproval(): Promise<void>;
			resetIdentity(): Promise<void>;
			finishSetup(): Promise<void>;
		};
		/** The person's answers about a new device of theirs that asks to be approved. */
		approvalActions: {
			approve(deviceId: string): Promise<void>;
			decline(deviceId: string): Promise<void>;
			confirm(deviceId: string): Promise<void>;
		};
	} = $props();

	let hiddenFor = $state<string | null>(null);
	let busy = $state(false);
	let setupOpen = $state(false);

	// Starting over deletes the database: the person says yes to that first.
	const confirmed = (label: string) => () => confirmAction(t("e2e_start_over_confirm"), label, onStartOver);

	// The recovery key the person saves before anything goes up: a first device's, a change of keys', or starting over's.
	const shownKey = $derived(
		encryption.name === "first_device"
			? encryption.recoveryKey
			: encryption.name === "ready"
				? (encryption.rotation?.recoveryKey ?? null)
				: encryption.name === "new_device" && encryption.setup?.way === "reset"
					? encryption.setup.recoveryKey
					: null,
	);

	// The setup's sheet, while the device is a new one that may begin a way: the person's Set up opens it, and its
	// attempt begins (its QR); closed, the attempt shows no more.
	const setupShown = $derived(
		setupOpen &&
			encryption.name === "new_device" &&
			(!encryption.setup || encryption.setup.way === "qr" || encryption.setup.way === "code"),
	);
	$effect(() => {
		if (encryption.name !== "new_device") setupOpen = false;
	});
	async function openSetup() {
		setupOpen = true;
		await setupActions.beginApproval();
	}
	function setupOpenChange(open: boolean) {
		if (open) return;
		setupOpen = false;
		void setupActions.endApproval().catch((error: unknown) => console.error("[e2e] The attempt didn't end:", error));
	}

	// A new device's request to be approved, until its transfer went.
	const approving = $derived(
		encryption.name === "ready" && encryption.approval && encryption.approval.step !== "confirmed"
			? encryption.approval
			: null,
	);

	const bar = $derived.by((): { text: string; label?: string; run?: () => Promise<void> } | null => {
		switch (encryption.name) {
			case "ready":
				// A change that can't finish (I1) says why and what to do, with nothing to press here.
				if (!encryption.rotation || encryption.rotation.recoveryKey) return null;
				return encryption.rotation.stuck
					? { text: t("e2e_rotation_stuck") }
					: { text: t("e2e_rotation_finish"), label: t("e2e_finish"), run: onFinishKeys };
			case "first_device":
				return encryption.finishing
					? { text: t("e2e_first_device_finish"), label: t("e2e_finish"), run: onMakeIdentity }
					: { text: t("e2e_first_device"), label: t("e2e_set_up"), run: onMakeIdentity };
			case "new_device":
				if (encryption.setup?.way === "finishing") {
					return { text: t("e2e_new_device_finish"), label: t("e2e_finish"), run: setupActions.finishSetup };
				}
				if (encryption.setup?.way === "reset") {
					return { text: t("e2e_reset_finish"), label: t("e2e_finish"), run: setupActions.finishSetup };
				}
				return { text: t("e2e_new_device"), label: t("e2e_set_up"), run: openSetup };
			case "removed":
				return { text: t("e2e_removed_device"), label: t("e2e_set_up_again"), run: confirmed(t("e2e_set_up_again")) };
			case "locked":
				return { text: t("e2e_locked") };
			case "unsupported":
				return { text: web ? t("e2e_unsupported_browser") : t("e2e_no_e2e_here") };
			case "failed":
				return encryption.lostKey
					? { text: t("e2e_lost_key"), label: t("e2e_delete_device"), run: confirmed(t("e2e_delete_device")) }
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

{#if shownKey}
	<Dialog open title={t("e2e_recovery_title")} escapeKeydownBehavior="ignore">
		{encryption.name === "ready" ? t("e2e_rotation_why") : t("e2e_recovery_why")}
		{#snippet body()}
			<RecoveryKeySheet recoveryKey={shownKey ?? ""} onContinue={onKeySaved} {onLater} />
		{/snippet}
	</Dialog>
{:else if hiddenFor !== encryption.name && (bar || encryption.name === "update")}
	<div
		class="{GLASS} animate-toast-in text-duvet-ink flex w-[min(30rem,calc(100vw-2rem))] items-center gap-3 rounded-[18px] py-2 pr-2 pl-3.5 text-[13px]"
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

{#if encryption.name === "new_device"}
	<Sheet open={setupShown} onOpenChange={setupOpenChange} title={t("e2e_setup_title")} class="max-w-[440px]">
		<DeviceSetupCard
			setup={encryption.setup}
			onRecover={setupActions.recover}
			onUseCode={setupActions.useCode}
			onAcceptCode={setupActions.acceptCode}
			onReset={setupActions.resetIdentity}
		/>
	</Sheet>
{/if}

{#if approving}
	<Dialog open title={approvalTitle(approving)} escapeKeydownBehavior="ignore">
		{#snippet body()}
			<ApprovalPrompt
				approval={approving}
				onApprove={() => approvalActions.approve(approving.device)}
				onDecline={() => approvalActions.decline(approving.device)}
				onConfirm={() => approvalActions.confirm(approving.device)}
			/>
		{/snippet}
	</Dialog>
{/if}
