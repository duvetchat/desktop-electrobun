<script lang="ts">
	import { ShieldCheck } from "@lucide/svelte";
	import { t } from "$lib/i18n";

	// A verified contact's mark (PLAN-E2E-CLIENTES.md, Task 28): the person compared their security number and marked
	// them verified on this device, whose core keeps it. Beside their name in their DM and their profile, named for a
	// screen reader and on hover.
	let { class: className = "" }: { class?: string } = $props();
</script>

<span
	role="img"
	aria-label={t("e2e_verified")}
	title={t("e2e_verified")}
	class="text-duvet-alive-text inline-flex shrink-0 items-center {className}"
>
	<ShieldCheck class="size-4" aria-hidden="true" />
</span>
