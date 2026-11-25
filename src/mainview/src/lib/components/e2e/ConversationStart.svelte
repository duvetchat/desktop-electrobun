<script lang="ts">
	import { t } from "$lib/i18n";
	import { formatDate } from "$lib/i18n/format";

	// What an encrypted conversation says at its start (PLAN-E2E-CLIENTES.md, «La vista de una conversación»): one from
	// before the cutover, the day its older messages were deleted (decision 56), by the server's date; and, once, that
	// the messages from before the user joined aren't on this device (Ruling 15).
	let {
		legacy,
		cutoverAt,
		beforeJoining,
	}: {
		/** The conversation was made before end-to-end encryption came. */
		legacy: boolean;
		/** The cutover's instant, as the API gives it (GET /api/e2e). */
		cutoverAt: string | null;
		/** Messages from before the user joined are left out of the chat. */
		beforeJoining: boolean;
	} = $props();

	const cutover = $derived(
		legacy && cutoverAt ? t("e2e_cutover", { date: formatDate(new Date(cutoverAt), { dateStyle: "long" }) }) : null,
	);
</script>

{#if cutover || beforeJoining}
	<div class="text-duvet-ink2 flex flex-col items-center gap-1 px-6 pb-4 text-center text-[12.5px]" role="note">
		{#if cutover}<p>{cutover}</p>{/if}
		{#if beforeJoining}<p>{t("e2e_before_joining")}</p>{/if}
	</div>
{/if}
