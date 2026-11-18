<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthResult from "$lib/components/auth/AuthResult.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import { onMount } from "svelte";
	import { changeEmail } from "$lib/api/auth";
	import { route } from "$lib/common/common";

	let status = $state<"loading" | "success" | "error">("loading");
	let errorMessage = $state("");

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const token = params.get("token");
		const email = params.get("email");

		if (!token || !email) {
			status = "error";
			errorMessage = "Invalid link. Missing token or email.";
			return;
		}

		try {
			await changeEmail(token, email);
			status = "success";
		} catch (err) {
			status = "error";
			errorMessage = err instanceof Error ? err.message : "Email change failed. The link may have expired.";
		}
	});
</script>

<AuthScene>
	{#if status === "loading"}
		<AuthResult state="loading" text="Changing your email..." />
	{:else if status === "success"}
		<AuthResult state="success" title="Email changed!" text="Your email has been updated successfully.">
			<AuthSubmit href={route("/app.html")}>Go to Duvet</AuthSubmit>
		</AuthResult>
	{:else}
		<AuthResult state="error" title="Email change failed" text={errorMessage}>
			<AuthSubmit href={route("/app.html")}>Go to Duvet</AuthSubmit>
		</AuthResult>
	{/if}
</AuthScene>
