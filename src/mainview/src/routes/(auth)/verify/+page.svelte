<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthResult from "$lib/components/auth/AuthResult.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import { onMount } from "svelte";
	import { verifyEmail } from "$lib/api/auth";
	import { route } from "$lib/common/common";
	import { t, type MessageKey } from "$lib/i18n";

	let status = $state<"loading" | "success" | "error">("loading");
	// What went wrong: the app's own sentence by its key, drawn in the language of the moment, or the API's words.
	let errorKey = $state<MessageKey | null>(null);
	let errorMessage = $state("");

	onMount(async () => {
		const token = new URLSearchParams(window.location.search).get("token");

		if (!token) {
			status = "error";
			errorKey = "auth_verify_no_token";
			return;
		}

		try {
			await verifyEmail(token);
			status = "success";
		} catch (err) {
			status = "error";
			// verifyEmail always throws an Error, in words of lib/api/auth.ts.
			errorMessage = (err as Error).message;
		}
	});
</script>

<AuthScene>
	{#if status === "loading"}
		<AuthResult state="loading" text={t("auth_verify_busy")} />
	{:else if status === "success"}
		<AuthResult state="success" title={t("auth_verify_done_title")} text={t("auth_verify_done_text")}>
			<AuthSubmit href={route("/app.html")}>{t("auth_go_to_duvet")}</AuthSubmit>
		</AuthResult>
	{:else}
		<AuthResult state="error" title={t("auth_verify_failed_title")} text={errorKey ? t(errorKey) : errorMessage}>
			<AuthSubmit href={route("/sign-in.html")}>{t("auth_go_to_sign_in")}</AuthSubmit>
		</AuthResult>
	{/if}
</AuthScene>
