<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthResult from "$lib/components/auth/AuthResult.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import { onMount } from "svelte";
	import { verifyEmail } from "$lib/api/auth";
	import { route } from "$lib/common/common";

	let status = $state<"loading" | "success" | "error">("loading");
	let errorMessage = $state("");

	onMount(async () => {
		const token = new URLSearchParams(window.location.search).get("token");

		if (!token) {
			status = "error";
			errorMessage = "No verification token found.";
			return;
		}

		try {
			await verifyEmail(token);
			status = "success";
		} catch (err) {
			status = "error";
			errorMessage = err instanceof Error ? err.message : "Verification failed. The link may have expired.";
		}
	});
</script>

<AuthScene>
	{#if status === "loading"}
		<AuthResult state="loading" text="Verifying your email…" />
	{:else if status === "success"}
		<AuthResult state="success" title="Email verified" text="Your email has been verified successfully.">
			<AuthSubmit href={route("/app.html")}>Go to Duvet</AuthSubmit>
		</AuthResult>
	{:else}
		<AuthResult state="error" title="Verification failed" text={errorMessage}>
			<AuthSubmit href={route("/sign-in.html")}>Go to sign in</AuthSubmit>
		</AuthResult>
	{/if}
</AuthScene>
