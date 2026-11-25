<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthResult from "$lib/components/auth/AuthResult.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import { onMount } from "svelte";
	import { changeEmail } from "$lib/api/auth";
	import { route } from "$lib/common/common";
	import { t, type MessageKey } from "$lib/i18n";

	let status = $state<"loading" | "success" | "error">("loading");
	// What went wrong: the app's own sentence by its key, drawn in the language of the moment, or the API's words.
	let errorKey = $state<MessageKey | null>(null);
	let errorMessage = $state("");

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const token = params.get("token");
		const email = params.get("email");

		if (!token || !email) {
			status = "error";
			errorKey = "auth_change_email_bad_link";
			return;
		}

		try {
			await changeEmail(token, email);
			status = "success";
		} catch (err) {
			status = "error";
			// changeEmail always throws an Error, in words of lib/api/auth.ts.
			errorMessage = (err as Error).message;
		}
	});
</script>

<AuthScene>
	{#if status === "loading"}
		<AuthResult state="loading" text={t("auth_change_email_busy")} />
	{:else if status === "success"}
		<AuthResult state="success" title={t("auth_change_email_done_title")} text={t("auth_change_email_done_text")}>
			<AuthSubmit href={route("/app.html")}>{t("auth_go_to_duvet")}</AuthSubmit>
		</AuthResult>
	{:else}
		<AuthResult state="error" title={t("auth_change_email_failed_title")} text={errorKey ? t(errorKey) : errorMessage}>
			<AuthSubmit href={route("/app.html")}>{t("auth_go_to_duvet")}</AuthSubmit>
		</AuthResult>
	{/if}
</AuthScene>
