<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthField from "$lib/components/auth/AuthField.svelte";
	import AuthResult from "$lib/components/auth/AuthResult.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import PasswordEye from "$lib/components/auth/PasswordEye.svelte";
	import { onMount } from "svelte";
	import { resetPassword } from "$lib/api/auth";
	import { canResetPassword, mascotMood, PASSWORD_MIN, type FocusedField } from "$lib/auth-form";
	import { route } from "$lib/common/common";
	import { t, type MessageKey } from "$lib/i18n";

	let status = $state<"form" | "loading" | "success" | "error">("form");
	// What went wrong: the app's own sentence by its key, drawn in the language of the moment, or the API's words.
	let errorKey = $state<MessageKey | null>(null);
	let errorMessage = $state("");
	let token = $state("");
	let password = $state("");
	let confirmPassword = $state("");
	let showPassword = $state(false);

	const passwordsMatch = $derived(password === confirmPassword);
	const canSubmit = $derived(canResetPassword(password, confirmPassword));

	onMount(() => {
		const found = new URLSearchParams(window.location.search).get("token");
		if (!found) {
			status = "error";
			errorKey = "auth_reset_no_token";
			return;
		}
		token = found;
	});

	async function handleSubmit() {
		if (!canSubmit) return;
		status = "loading";
		try {
			await resetPassword(token, password);
			status = "success";
		} catch (err) {
			status = "error";
			// resetPassword always throws an Error, in words of lib/api/auth.ts.
			errorMessage = (err as Error).message;
		}
	}

	// What the mascot does: it shuts its eyes on a password, and peeks while it's shown.
	let focusedField = $state<FocusedField>(null);
	const mood = $derived(mascotMood(focusedField, showPassword));
	const onSecret = { onfocus: () => (focusedField = "secret" as const), onblur: () => (focusedField = null) };
</script>

<!-- One scene for the form and for how it turned out: the stickers don't start over between them. -->
<AuthScene
	{mood}
	title={status === "form" ? t("auth_reset_title") : undefined}
	lead={status === "form" ? t("auth_reset_lead") : undefined}
>
	{#if status === "form"}
		<form
			class="flex flex-col gap-4"
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			novalidate
		>
			<AuthField
				id="password"
				label={t("auth_new_password_label")}
				type={showPassword ? "text" : "password"}
				autocomplete="new-password"
				minlength={8}
				maxlength={128}
				required
				bind:value={password}
				placeholder={t("auth_reset_password_placeholder", { count: PASSWORD_MIN })}
				{...onSecret}
			>
				{#snippet trailing()}
					<PasswordEye bind:shown={showPassword} />
				{/snippet}
			</AuthField>

			<AuthField
				id="confirmPassword"
				label={t("auth_confirm_password_label")}
				type={showPassword ? "text" : "password"}
				autocomplete="new-password"
				minlength={8}
				maxlength={128}
				required
				bind:value={confirmPassword}
				placeholder={t("auth_reset_confirm_placeholder")}
				error={confirmPassword && !passwordsMatch ? t("auth_passwords_differ") : undefined}
				{...onSecret}
			/>

			<AuthSubmit disabled={!canSubmit} class="mt-2">{t("auth_reset_submit")}</AuthSubmit>
		</form>
	{:else if status === "loading"}
		<AuthResult state="loading" text={t("auth_reset_busy")} />
	{:else if status === "success"}
		<AuthResult state="success" title={t("auth_reset_done_title")} text={t("auth_reset_done_text")}>
			<AuthSubmit href={route("/sign-in.html")}>{t("auth_sign_in")}</AuthSubmit>
		</AuthResult>
	{:else}
		<AuthResult state="error" title={t("auth_reset_failed_title")} text={errorKey ? t(errorKey) : errorMessage}>
			<AuthSubmit href={route("/sign-in.html")}>{t("auth_go_to_sign_in")}</AuthSubmit>
		</AuthResult>
	{/if}
</AuthScene>
