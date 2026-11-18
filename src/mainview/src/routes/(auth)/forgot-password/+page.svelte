<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthField from "$lib/components/auth/AuthField.svelte";
	import AuthNote from "$lib/components/auth/AuthNote.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import { forgotPassword } from "$lib/api/auth";
	import { mascotLook, type FocusedField } from "$lib/auth-form";

	let email = $state("");
	let doingRequest = $state(false);
	let errorMessage = $state("");
	let successMessage = $state("");

	async function handleSubmit() {
		doingRequest = true;
		errorMessage = "";
		successMessage = "";
		try {
			await forgotPassword(email);
			successMessage = "If an account exists for this email, you will receive reset instructions shortly.";
		} catch {
			errorMessage = "We couldn't process your request right now. Please try again.";
		} finally {
			doingRequest = false;
		}
	}

	// What the mascot does: it follows what's typed. There is no password here for it to shut its eyes on.
	let focusedField = $state<FocusedField>(null);
	let typed = $state(0);
	const look = $derived(mascotLook(focusedField, typed));
</script>

<AuthScene mood="awake" {look} title="Forgot password?" lead="Enter your email and we will send reset instructions.">
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
			label="Email"
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
			placeholder="you@example.com"
			onfocus={(e) => ((focusedField = "text"), (typed = e.currentTarget.value.length))}
			oninput={(e) => (typed = e.currentTarget.value.length)}
			onblur={() => (focusedField = null)}
		/>

		{#if errorMessage}
			<AuthNote>{errorMessage}</AuthNote>
		{/if}

		{#if successMessage}
			<AuthNote tone="sent">{successMessage}</AuthNote>
		{/if}

		<AuthSubmit busy={doingRequest} disabled={!email.trim()} class="mt-2">
			{doingRequest ? "Sending reset email..." : "Send reset email"}
		</AuthSubmit>
	</form>

	<footer class="text-duvet-ink2 mt-6 text-center text-[14px]">
		Remembered your password?
		<a href="/sign-in" class="auth-link ml-1">Back to sign in</a>
	</footer>
</AuthScene>
