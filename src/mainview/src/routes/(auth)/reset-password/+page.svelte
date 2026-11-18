<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthField from "$lib/components/auth/AuthField.svelte";
	import AuthResult from "$lib/components/auth/AuthResult.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import PasswordEye from "$lib/components/auth/PasswordEye.svelte";
	import { onMount } from "svelte";
	import { resetPassword } from "$lib/api/auth";
	import { canResetPassword, mascotMood, type FocusedField } from "$lib/auth-form";
	import { route } from "$lib/common/common";

	let status = $state<"form" | "loading" | "success" | "error">("form");
	let errorMessage = $state("");
	let token = $state("");
	let password = $state("");
	let confirmPassword = $state("");
	let showPassword = $state(false);

	const passwordsMatch = $derived(password === confirmPassword);
	const canSubmit = $derived(canResetPassword(password, confirmPassword));

	onMount(() => {
		const t = new URLSearchParams(window.location.search).get("token");
		if (!t) {
			status = "error";
			errorMessage = "No reset token found.";
			return;
		}
		token = t;
	});

	async function handleSubmit() {
		if (!canSubmit) return;
		status = "loading";
		try {
			await resetPassword(token, password);
			status = "success";
		} catch (err) {
			status = "error";
			errorMessage = err instanceof Error ? err.message : "Password reset failed. The link may have expired.";
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
	title={status === "form" ? "Reset your password" : undefined}
	lead={status === "form" ? "Enter your new password below." : undefined}
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
				label="New password"
				type={showPassword ? "text" : "password"}
				autocomplete="new-password"
				minlength={8}
				maxlength={128}
				required
				bind:value={password}
				placeholder="Minimum 8 characters"
				{...onSecret}
			>
				{#snippet trailing()}
					<PasswordEye bind:shown={showPassword} />
				{/snippet}
			</AuthField>

			<AuthField
				id="confirmPassword"
				label="Confirm password"
				type={showPassword ? "text" : "password"}
				autocomplete="new-password"
				minlength={8}
				maxlength={128}
				required
				bind:value={confirmPassword}
				placeholder="Re-enter your password"
				error={confirmPassword && !passwordsMatch ? "Passwords don't match." : undefined}
				{...onSecret}
			/>

			<AuthSubmit disabled={!canSubmit} class="mt-2">Reset password</AuthSubmit>
		</form>
	{:else if status === "loading"}
		<AuthResult state="loading" text="Resetting your password…" />
	{:else if status === "success"}
		<AuthResult state="success" title="Password reset" text="Your password has been changed successfully.">
			<AuthSubmit href={route("/sign-in.html")}>Sign in</AuthSubmit>
		</AuthResult>
	{:else}
		<AuthResult state="error" title="Reset failed" text={errorMessage}>
			<AuthSubmit href={route("/sign-in.html")}>Go to sign in</AuthSubmit>
		</AuthResult>
	{/if}
</AuthScene>
