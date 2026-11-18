<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
	import { onMount } from "svelte";
	import { Button, Label } from "bits-ui";
	import { logIn } from "$lib/api/auth";
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
		const redirect = new URLSearchParams(window.location.search).get("redirect");
		if (redirect) redirectQuery = `?redirect=${encodeURIComponent(redirect)}`;
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
	let focusedField = $state<"text" | "secret" | null>(null);
	let typed = $state(0);
	const mood = $derived(focusedField === "secret" ? (showPassword ? "peek" : "shy") : "awake");
	const look = $derived(focusedField === "text" ? Math.min(typed, 28) / 14 - 1 : 0);

	// The stickers' cues: the mailbox when the email first reads as one, the heart on each try.
	let mailCue = $state(0);
	let sendCue = $state(0);
	let emailLooked = false;
	$effect(() => {
		const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
		if (valid && !emailLooked) mailCue++;
		emailLooked = valid;
	});
</script>

<AuthScene {mood} {look} {mailCue} {sendCue}>
	<header class="mb-6 text-center">
		<h1 class="text-duvet-ink text-2xl font-bold sm:text-3xl">Welcome back</h1>
		<p class="text-duvet-ink2 mt-1 text-sm sm:text-base">Sign in to continue to Duvet.</p>
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

		<div>
			<div class="mb-2 flex items-center justify-between">
				<Label.Root for="password" class="text-duvet-ink2 block text-sm font-medium">Password</Label.Root>
				<a href="/forgot-password" class="auth-link text-sm">Forgot password?</a>
			</div>
			<div class="relative">
				<input
					id="password"
					onfocus={() => (focusedField = "secret")}
					onblur={() => (focusedField = null)}
					name="password"
					type={showPassword ? "text" : "password"}
					autocomplete="current-password"
					maxlength={128}
					required
					bind:value={password}
					disabled={doingRequest}
					class="auth-field pr-11"
					placeholder="Enter your password"
				/>
				<button
					type="button"
					class="text-duvet-ink2 hover:text-duvet-ink absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
					aria-pressed={showPassword}
					aria-label={showPassword ? "Hide password" : "Show password"}
					onclick={() => (showPassword = !showPassword)}
					disabled={doingRequest}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12z"
						/>
						<circle cx="12" cy="12" r="3" />
					</svg>
				</button>
			</div>
		</div>

		{#if errorMessage}
			<p class="border-duvet-danger/40 bg-duvet-danger/10 text-duvet-danger rounded-md border px-3 py-2 text-sm">
				{errorMessage}
			</p>
		{/if}

		<Button.Root
			type="submit"
			disabled={doingRequest}
			class={`auth-primary ${doingRequest ? "cursor-not-allowed opacity-60" : ""}`}
			aria-busy={doingRequest}
		>
			{doingRequest ? "Signing in..." : "Sign in"}
		</Button.Root>
	</form>

	<footer class="text-duvet-ink2 mt-6 text-center text-sm">
		New to Duvet?
		<a href="/sign-up{redirectQuery}" class="auth-link ml-1">Create an account</a>
	</footer>
</AuthScene>
