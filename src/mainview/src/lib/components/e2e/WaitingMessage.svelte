<script lang="ts">
	import { Clock } from "@lucide/svelte";
	import { t } from "$lib/i18n";

	// A conversation's message this device doesn't hold yet (PLAN-E2E-CLIENTES.md, «La vista de una conversación»): its
	// copy didn't open here, or never came. It shows once the sender's device delivers it (decision 15).
</script>

<span class="text-duvet-ink2 inline-flex items-center gap-1.5 text-[13px] italic" title={t("e2e_waiting_detail")}>
	<Clock class="size-3.5 shrink-0" aria-hidden="true" />
	<span>{t("e2e_waiting")}</span>
	<span class="sr-only">{t("e2e_waiting_detail")}</span>
</span>
