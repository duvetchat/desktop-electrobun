<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import AuthField from "$lib/components/auth/AuthField.svelte";
	import AuthNote from "$lib/components/auth/AuthNote.svelte";
	import AuthSubmit from "$lib/components/auth/AuthSubmit.svelte";
	import PasswordEye from "$lib/components/auth/PasswordEye.svelte";
	import { onMount } from "svelte";
	import { logIn } from "$lib/api/auth";
	import { emailValid, mascotLook, mascotMood, redirectQuery as redirectOf, type FocusedField } from "$lib/auth-form";
	import { userSession } from "$lib/stores.svelte";
	import { route } from "$lib/common/common";
	import { localUrl } from "$lib/urls";

	let showPassword = $state(false);
	let email = $state("");
	let password = $state("");
	let doingRequest = $state(false);
	let errorMessage = $state("");
	// The page to go on to (an invite's), which creating an account instead goes on to as well.
	let redirectQuery = $state("");

	onMount(() => {
		redirectQuery = redirectOf(window.location.search);
	});

	async function handleSubmit() {
		sendCue++;
		doingRequest = true;
		errorMessage = "";
		try {
			const result = await logIn({ email, password });
			userSession.token = result.token;
			// Only to a path of the app (localUrl): another site, or javascript:, would leave it or run in it.
			const redirect = new URLSearchParams(window.location.search).get("redirect");
			window.location.href = localUrl(redirect, window.location.href) ?? route("/app.html");
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : "We couldn't sign you in. Check your details and try again.";
		} finally {
			doingRequest = false;
		}
	}

	// What the mascot does: it follows what's typed, and shuts its eyes on a password.
	let focusedField = $state<FocusedField>(null);
	let typed = $state(0);
	const mood = $derived(mascotMood(focusedField, showPassword));
	const look = $derived(mascotLook(focusedField, typed));

	// The stickers' cues: the mailbox when the email first reads as one, the heart on each try.
	let mailCue = $state(0);
	let sendCue = $state(0);
	let emailLooked = false;
	$effect(() => {
		const valid = emailValid(email);
		if (valid && !emailLooked) mailCue++;
		emailLooked = valid;
	});
</script>

<AuthScene {mood} {look} {mailCue} {sendCue} title="Welcome back" lead="Sign in to continue to Duvet.">
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

		<AuthField
			id="password"
			label="Password"
			name="password"
			type={showPassword ? "text" : "password"}
			autocomplete="current-password"
			maxlength={128}
			required
			bind:value={password}
			disabled={doingRequest}
			placeholder="Enter your password"
			onfocus={() => (focusedField = "secret")}
			onblur={() => (focusedField = null)}
		>
			{#snippet aside()}
				<a href="/forgot-password" class="auth-link text-[13px]">Forgot password?</a>
			{/snippet}
			{#snippet trailing()}
				<PasswordEye bind:shown={showPassword} disabled={doingRequest} />
			{/snippet}
		</AuthField>

		{#if errorMessage}
			<AuthNote>{errorMessage}</AuthNote>
		{/if}

		<AuthSubmit busy={doingRequest} class="mt-2">
			{doingRequest ? "Signing in..." : "Sign in"}
		</AuthSubmit>
	</form>

	<footer class="text-duvet-ink2 mt-6 text-center text-[14px]">
		New to Duvet?
		<a href="/sign-up{redirectQuery}" class="auth-link ml-1">Create an account</a>
	</footer>
</AuthScene>
