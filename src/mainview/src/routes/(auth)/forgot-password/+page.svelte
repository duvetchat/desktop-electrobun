<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import { Button, Label } from "bits-ui";
	import { forgotPassword } from "$lib/api/auth";

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

	// What the mascot does: it follows what's typed, and shuts its eyes on a password.
	let focusedField = $state<"text" | "secret" | null>(null);
	let typed = $state(0);
	const mood = "awake";
	const look = $derived(focusedField === "text" ? Math.min(typed, 28) / 14 - 1 : 0);
</script>

<AuthScene {mood} {look}>
	<header class="mb-6 text-center">
		<h1 class="text-duvet-ink text-2xl font-bold sm:text-3xl">Forgot password?</h1>
		<p class="text-duvet-ink2 mt-1 text-sm sm:text-base">Enter your email and we will send reset instructions.</p>
	</header>

	<form
		class="space-y-5"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		novalidate
		aria-busy={doingRequest}
	>
		<div>
			<Label.Root for="email" class="text-duvet-ink2 mb-2 block text-sm font-medium">Email</Label.Root>
			<input
				id="email"
				onfocus={(e) => ((focusedField = "text"), (typed = e.currentTarget.value.length))}
				oninput={(e) => (typed = e.currentTarget.value.length)}
				onblur={() => (focusedField = null)}
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
				class="auth-field"
				placeholder="you@example.com"
			/>
		</div>

		{#if errorMessage}
			<p class="border-duvet-danger/40 bg-duvet-danger/10 text-duvet-danger rounded-md border px-3 py-2 text-sm">
				{errorMessage}
			</p>
		{/if}

		{#if successMessage}
			<p class="border-duvet-ink2/40 bg-duvet-ink2/10 text-duvet-ink rounded-md border px-3 py-2 text-sm">
				{successMessage}
			</p>
		{/if}

		<Button.Root
			type="submit"
			disabled={doingRequest || !email.trim()}
			class={`auth-primary ${doingRequest ? "cursor-not-allowed opacity-60" : ""}`}
		>
			{doingRequest ? "Sending reset email..." : "Send reset email"}
		</Button.Root>
	</form>

	<footer class="text-duvet-ink2 mt-6 text-center text-sm">
		Remembered your password?

		<a href="/sign-in" class="auth-link ml-1"> Back to sign in </a>
	</footer>
</AuthScene>
