<script lang="ts">
	import type { SafetyNumber as NumberShown } from "$lib/e2e/engine/contacts";
	import { safetyNumberOf, verifyContact } from "$lib/e2e/engine.svelte";
	import { encryption, safetyNumberRequest } from "$lib/e2e/encryption.svelte";
	import { CoreError } from "$lib/e2e/errors";
	import { t } from "$lib/i18n";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import SafetyNumber from "./SafetyNumber.svelte";

	// A contact's security number, one dialog for the app (PLAN-E2E-CLIENTES.md, Task 28; decision 25), as a profile, a
	// member's menu or a changed key's notice asks for it (safetyNumberRequest). Mark as verified marks the contact only
	// while the number is the one the person compared: one that changed meanwhile shows its new number instead, and says
	// so.
	let asked = $state.raw<{ id: string; name: string } | null>(null);
	let open = $state(false);
	let shown = $state.raw<NumberShown | null>(null);
	let problem = $state<string | null>(null);
	let busy = $state(false);
	/** The latest load's number: an answer for one the person left is dropped. */
	let loads = 0;

	$effect(() => {
		const request = $safetyNumberRequest;
		if (!request) return;
		safetyNumberRequest.set(null);
		asked = request;
		busy = false;
		open = true;
		void load(request);
	});

	/** The contact's number now, `said` shown above it (why it's another one). */
	async function load(request: { id: string; name: string }, said: string | null = null) {
		const mine = ++loads;
		shown = null;
		problem = said;
		try {
			const number = await safetyNumberOf(request.id);
			if (mine === loads) shown = number;
		} catch (error) {
			if (mine === loads) problem = words(error, request.name);
		}
	}

	async function verify() {
		if (!asked || !shown || busy) return;
		const request = asked;
		busy = true;
		try {
			// The number changed meanwhile (new keys, seen as it was checked): the new one shows, to compare again.
			if (!(await verifyContact(asked.id, shown.digits))) {
				await load(request, t("e2e_safety_changed", { name: request.name }));
			}
		} catch (error) {
			problem = words(error, request.name);
		} finally {
			busy = false;
		}
	}

	/** What the person reads of a number that didn't load, or a mark that didn't take. */
	function words(error: unknown, name: string): string {
		if (error instanceof CoreError && error.code === "needs_identities") return t("e2e_safety_none", { name });
		if (error instanceof CoreError && error.code === "not_ready") return t("e2e_not_ready");
		return t("e2e_safety_failed");
	}
</script>

{#if asked}
	<Sheet
		bind:open
		title={t("e2e_verify_number")}
		description={t("e2e_safety_digits", { name: asked.name })}
		class="max-w-[440px]"
	>
		<SafetyNumber
			name={asked.name}
			number={shown}
			verified={encryption.contacts.verified[asked.id] === true}
			{problem}
			{busy}
			onVerify={() => void verify()}
		/>
	</Sheet>
{/if}
