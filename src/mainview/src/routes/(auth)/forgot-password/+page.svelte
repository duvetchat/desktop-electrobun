<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthField from "$lib/components/auth/AuthField.svelte";
	import AuthNote from "$lib/components/auth/AuthNote.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import { forgotPassword } from "$lib/api/auth";
	import { mascotLook, type FocusedField } from "$lib/auth-form";
	import { t } from "$lib/i18n";

	let email = $state("");
	let doingRequest = $state(false);
	// What the API answered, drawn in the language of the moment.
	let failed = $state(false);
	let sent = $state(false);

	async function handleSubmit() {
		doingRequest = true;
		failed = false;
		sent = false;
		try {
			await forgotPassword(email);
			sent = true;
		} catch {
			failed = true;
		} finally {
			doingRequest = false;
		}
	}

	// What the mascot does: it follows what's typed. There is no password here for it to shut its eyes on.
	let focusedField = $state<FocusedField>(null);
	let typed = $state(0);
	const look = $derived(mascotLook(focusedField, typed));
</script>

<AuthScene mood="awake" {look} title={t("auth_forgot_title")} lead={t("auth_forgot_lead")}>
	<form
		class="flex flex-col gap-4"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		novalidate
		aria-busy={doingRequest}
	>
		<AuthField
			id="email"
			label={t("auth_email_label")}
			name="email"
			type="email"
			autocomplete="email"
			inputmode="email"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
			maxlength={254}
			required
			bind:value={email}
			disabled={doingRequest}
			placeholder={t("auth_email_placeholder")}
			onfocus={(e) => ((focusedField = "text"), (typed = e.currentTarget.value.length))}
			oninput={(e) => (typed = e.currentTarget.value.length)}
			onblur={() => (focusedField = null)}
		/>

		{#if failed}
			<AuthNote>{t("auth_forgot_failed")}</AuthNote>
		{/if}

		{#if sent}
			<AuthNote tone="sent">{t("auth_forgot_sent")}</AuthNote>
		{/if}

		<AuthSubmit busy={doingRequest} disabled={!email.trim()} class="mt-2">
			{doingRequest ? t("auth_forgot_busy") : t("auth_forgot_submit")}
		</AuthSubmit>
	</form>

	<footer class="text-duvet-ink2 mt-6 text-center text-[14px]">
		{t("auth_forgot_remembered")}
		<a href="/sign-in" class="auth-link ml-1">{t("auth_back_to_sign_in")}</a>
	</footer>
</AuthScene>
