<script lang="ts">
	import { ExternalLink as ExternalLinkIcon, RotateCw as RotateCwIcon } from "@lucide/svelte";
	import { DOWNLOAD_PAGE, restarting, takeUpdate, updateOffer } from "$lib/app-update";
	import Button from "$lib/components/ui/Button.svelte";
	import { buttonClass } from "$lib/components/ui/recipes";
	import { t } from "$lib/i18n";

	// What a direct message shows once the API answered 426 (PLAN-E2E-CLIENTES.md, «El motor», its state update): update
	// Duvet, from its download page or, in the desktop app with a version ready, by the title bar's Restart to update
	// (lib/app-update.ts); or, where the platform has no end-to-end encryption yet, that. The engine's state shows it,
	// with its UpdateRequiredError's minimum: null when the API names none for this platform.
	let { minimum }: { minimum: string | null } = $props();
</script>

<div class="flex flex-col items-center gap-3 px-4 py-6 text-center" role="status">
	{#if minimum === null}
		<p class="text-duvet-ink2 max-w-[42ch] text-[13.5px] leading-[1.45]">{t("e2e_no_e2e_here")}</p>
	{:else}
		<p class="text-duvet-ink text-[14px] font-semibold">{t("e2e_update")}</p>
		{#if $updateOffer?.how === "restart"}
			<Button size="sm" disabled={$restarting} onclick={() => void takeUpdate()}>
				<RotateCwIcon size={14} aria-hidden="true" />
				{$restarting ? t("e2e_restarting") : t("e2e_restart_to_update")}
			</Button>
		{:else}
			<!-- The desktop app opens it in the system browser (lib/external-links.ts). -->
			<a href={DOWNLOAD_PAGE} target="_blank" rel="noopener noreferrer" class={buttonClass("secondary", "sm")}>
				<ExternalLinkIcon size={14} aria-hidden="true" />
				duvet.chat/download
			</a>
		{/if}
	{/if}
</div>
