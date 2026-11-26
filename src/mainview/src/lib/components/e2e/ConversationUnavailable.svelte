<script module lang="ts">
	import type { EngineState } from "$lib/e2e/engine/engine";

	/**
	 * Whether this app can't open its encrypted conversations at all (PLAN-E2E-CLIENTES.md, «El motor», its states): a
	 * platform or a browser without the core, or a client the API answers 426. Neither changes until the app does.
	 */
	export function unavailableHere(encryption: EngineState): boolean {
		return encryption.name === "unsupported" || encryption.name === "update";
	}
</script>

<script lang="ts">
	import { t } from "$lib/i18n";
	import UpdateNotice from "./UpdateNotice.svelte";

	// What a direct message shows in place of its messages and its box where this app can't open it (Task 34): its
	// messages can't load there and its box can't send. The desktop app on macOS and Linux carries no core (decisions 38
	// and 39), a browser may lack what the core needs, and an old client gets the API's 426, which names no minimum on a
	// platform without encryption. The app's bottom bar says the same, but the person may have closed it.
	let { encryption, web }: { encryption: EngineState; web: boolean } = $props();
</script>

{#if encryption.name === "update"}
	<UpdateNotice minimum={encryption.minimum} />
{:else if encryption.name === "unsupported"}
	<div class="flex flex-col items-center gap-3 px-4 py-6 text-center" role="status">
		<p class="text-duvet-ink2 max-w-[42ch] text-[13.5px] leading-[1.45]">
			{web ? t("e2e_unsupported_browser") : t("e2e_no_e2e_here")}
		</p>
	</div>
{/if}
