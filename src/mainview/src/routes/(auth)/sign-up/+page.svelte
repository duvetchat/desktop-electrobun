<script lang="ts">
	import MascotPeek from "$lib/components/MascotPeek.svelte";
	import { onMount } from "svelte";
	import { signIn, logIn } from "$lib/api/auth";
	import { Button, Checkbox, Dialog } from "bits-ui";
	import { userSession } from "$lib/stores.svelte";
	import { route } from "$lib/common/common";
	import { localUrl } from "$lib/urls";

	let showPassword = $state(false);
	let username = $state("");
	let alias = $state("");
	let email = $state("");
	let password = $state("");
	let confirmPassword = $state("");
	let acceptTerms = $state(false);
	let doingRequest = $state(false);
	let showTermsModal = $state(false);
	let errorMessage = $state("");
	// The page to go on to (an invite's), which signing in instead goes on to as well.
	let redirectQuery = $state("");

	onMount(() => {
		const redirect = new URLSearchParams(window.location.search).get("redirect");
		if (redirect) redirectQuery = `?redirect=${encodeURIComponent(redirect)}`;
	});

	// The same rules the mobile app checks before it asks the server.
	const usernameValid = $derived(/^[a-zA-Z0-9_.]{2,32}$/.test(username.trim()));
	const emailValid = $derived(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()));
	const passwordLong = $derived(password.length >= 8);
	const passwordsMatch = $derived(password === confirmPassword);
	const canSubmit = $derived(
		username.trim() && email.trim() && password && confirmPassword && passwordsMatch && acceptTerms,
	);

	// The sentence grows a line once the one before it reads right; the display name may stay empty.
	const shown = $derived(
		1 +
			(usernameValid ? 1 : 0) +
			(usernameValid && emailValid ? 1 : 0) +
			(usernameValid && emailValid && passwordLong ? 1 : 0),
	);

	async function handleSubmit() {
		doingRequest = true;
		errorMessage = "";
		try {
			await signIn({
				username,
				alias: alias || null,
				email,
				password,
			});
			const result = await logIn({ email, password });
			userSession.token = result.token;
			// Only to a path of the app (localUrl): another site, or javascript:, would leave it or run in it.
			const redirect = new URLSearchParams(window.location.search).get("redirect");
			window.location.href = localUrl(redirect, window.location.href) ?? route("/app.html");
		} catch (err) {
			errorMessage =
				err instanceof Error ? err.message : "We couldn't create your account. Check your details and try again.";
		} finally {
			doingRequest = false;
		}
	}

	// What the mascot does: it follows what's typed, and shuts its eyes on a password.
	let focusedField = $state<"text" | "secret" | null>(null);
	let typed = $state(0);
	const mood = $derived(focusedField === "secret" ? (showPassword ? "peek" : "shy") : "awake");
	const look = $derived(focusedField === "text" ? Math.min(typed, 28) / 14 - 1 : 0);

	const onText = {
		onfocus: (e: FocusEvent & { currentTarget: HTMLInputElement }) => {
			focusedField = "text";
			typed = e.currentTarget.value.length;
		},
		oninput: (e: Event & { currentTarget: HTMLInputElement }) => (typed = e.currentTarget.value.length),
		onblur: () => (focusedField = null),
	};
	const onSecret = { onfocus: () => (focusedField = "secret"), onblur: () => (focusedField = null) };

	/** What sizes an inline field: its text, or its placeholder while empty (bullets for a hidden password). */
	const sizer = (value: string, placeholder: string, secret = false) =>
		value ? (secret && !showPassword ? "•".repeat(value.length) : value) : placeholder;
</script>

<section class="signup h-full overflow-y-auto">
	<p class="signup-brand" aria-hidden="true">Duvet<span>.chat</span></p>

	<form
		class="signup-form"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		novalidate
		aria-label="Create your account"
	>
		<fieldset disabled={doingRequest} class="m-0 border-0 p-0">
			<h1 class="signup-lead">a cozy place to talk, and you're about to join it.</h1>

			<p class="signup-line">
				Hi, I'm
				<span class="signup-sizer" data-text={sizer(alias, "your name", false)}
					><input
						id="alias"
						name="alias"
						type="text"
						aria-label="Display name (optional)"
						maxlength={32}
						bind:value={alias}
						class="signup-slot focus-override"
						size={1}
						placeholder="your name"
						{...onText}
					/></span
				>,
			</p>

			<p class="signup-line">
				people find me as @<span class="signup-sizer" data-text={sizer(username, "username", false)}
					><input
						id="username"
						name="username"
						type="text"
						aria-label="Username"
						aria-describedby="username-hint"
						aria-invalid={username.length > 0 && !usernameValid}
						autocomplete="username"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
						maxlength={32}
						required
						bind:value={username}
						class="signup-slot focus-override"
						size={1}
						placeholder="username"
						{...onText}
					/></span
				>
			</p>
			<p id="username-hint" class="signup-hint" class:is-error={username.length > 0 && !usernameValid}>
				Letters, numbers, dots and _, 2 to 32. It's how people mention you.
			</p>

			<p class="signup-line" class:is-hidden={shown < 2} inert={shown < 2}>
				and you can reach me at
				<span class="signup-sizer" data-text={sizer(email, "you@example.com", false)}
					><input
						id="email"
						name="email"
						type="email"
						aria-label="Email"
						autocomplete="email"
						inputmode="email"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
						maxlength={254}
						required
						bind:value={email}
						class="signup-slot focus-override"
						size={1}
						placeholder="you@example.com"
						{...onText}
					/></span
				>.
			</p>

			<p class="signup-line" class:is-hidden={shown < 3} inert={shown < 3}>
				My password is
				<span class="signup-secret">
					<span class="signup-sizer" data-text={sizer(password, "8 or more", true)}
						><input
							id="password"
							name="password"
							type={showPassword ? "text" : "password"}
							aria-label="Password, at least 8 characters"
							autocomplete="new-password"
							minlength={8}
							maxlength={128}
							required
							bind:value={password}
							class="signup-slot focus-override"
							size={1}
							placeholder="8 or more"
							{...onSecret}
						/></span
					>
					<button
						type="button"
						class="signup-eye"
						aria-pressed={showPassword}
						aria-label={showPassword ? "Hide password" : "Show password"}
						onclick={() => (showPassword = !showPassword)}
					>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12z"
							/>
							<circle cx="12" cy="12" r="3" />
						</svg>
					</button>
				</span>
			</p>

			<p class="signup-line" class:is-hidden={shown < 4} inert={shown < 4}>
				once more, to be sure:
				<span class="signup-sizer" data-text={sizer(confirmPassword, "the same", true)}
					><input
						id="confirmPassword"
						name="confirmPassword"
						type={showPassword ? "text" : "password"}
						aria-label="Confirm password"
						aria-invalid={!passwordsMatch && confirmPassword.length > 0}
						autocomplete="new-password"
						minlength={8}
						maxlength={128}
						required
						bind:value={confirmPassword}
						class="signup-slot focus-override"
						size={1}
						placeholder="the same"
						{...onSecret}
					/></span
				>.
			</p>
			{#if confirmPassword && !passwordsMatch}
				<p class="signup-hint is-error" role="status">Passwords don't match.</p>
			{/if}

			{#if errorMessage}
				<p class="signup-error" role="alert">{errorMessage}</p>
			{/if}

			<div class="signup-actions" class:is-hidden={shown < 4} inert={shown < 4}>
				<label class="signup-terms">
					<Checkbox.Root bind:checked={acceptTerms} class="signup-check">
						{#if acceptTerms}
							<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"
								><path d="M3.5 8.5l3 3 6-7" stroke-linecap="round" stroke-linejoin="round" /></svg
							>
						{/if}
					</Checkbox.Root>
					<span
						>I agree to the <button type="button" class="auth-link" onclick={() => (showTermsModal = true)}
							>Terms of use</button
						></span
					>
				</label>
				<Button.Root
					type="submit"
					class="auth-primary signup-submit disabled:cursor-not-allowed disabled:opacity-50"
					disabled={!canSubmit || doingRequest}
					aria-busy={doingRequest}
				>
					{doingRequest ? "Creating account..." : "Create my account"}
				</Button.Root>
			</div>

			<p class="signup-footer">
				Already have an account? <a href="/sign-in{redirectQuery}" class="auth-link">Sign in</a>
			</p>
		</fieldset>
	</form>

	<MascotPeek {mood} {look} class="signup-mascot" />
</section>

<Dialog.Root bind:open={showTermsModal}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<div class="w-full max-w-lg rounded-2xl border border-stone-700/70 bg-stone-950/95 p-6 text-white">
				<Dialog.Title class="mb-3 text-xl font-semibold">Terms of use</Dialog.Title>
				<Dialog.Description class="text-duvet-ink2 text-sm leading-6">
					By creating an account, you agree to follow community guidelines and use Duvet respectfully.
				</Dialog.Description>
				<div class="mt-6 flex justify-end">
					<Dialog.Close class="bg-fill-600 text-fixed-white hover:bg-fill-500 rounded-md px-4 py-2">Close</Dialog.Close>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.signup {
		position: relative;
		overflow-x: clip;
		background:
			radial-gradient(45% 50% at 85% 100%, color-mix(in oklab, var(--duvet-accent) 18%, transparent), transparent 70%),
			var(--duvet-bg);
		color: var(--duvet-ink);
	}

	.signup-brand {
		position: absolute;
		top: 2rem;
		left: clamp(1.5rem, 8vw, 7.5rem);
		font-size: 1.375rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.signup-brand span {
		color: var(--duvet-accent);
	}

	.signup-form {
		max-width: 76rem;
		padding: 7rem clamp(1.5rem, 8vw, 7.5rem) 12rem;
	}

	.signup-lead {
		margin-bottom: 1.75rem;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--duvet-ink2);
	}

	.signup-line {
		font-size: clamp(1.6rem, 3.4vw, 2.9rem);
		font-weight: 700;
		line-height: 1.45;
		letter-spacing: -0.02em;
		transition:
			opacity 260ms ease,
			transform 260ms ease;
	}

	.signup-line.is-hidden,
	.signup-actions.is-hidden {
		opacity: 0;
		transform: translateY(8px);
		pointer-events: none;
	}

	/* An inline field as wide as its text: the field and an invisible copy of that text share one grid cell. */
	.signup-sizer {
		display: inline-grid;
		max-width: 100%;
		vertical-align: baseline;
	}

	.signup-sizer::after {
		content: attr(data-text);
		grid-area: 1 / 1;
		visibility: hidden;
		white-space: pre;
		padding: 0 0.2em;
		font-weight: 500;
	}

	/* Its underline is its focus ring, so it takes no global one (focus-override). */
	.signup-slot {
		grid-area: 1 / 1;
		width: 100%;
		min-width: 2ch;
		border: 0;
		border-bottom: 3px solid color-mix(in oklab, var(--duvet-ink2) 45%, transparent);
		border-radius: 0;
		background: transparent;
		padding: 0 0.15em;
		color: var(--duvet-accent-text);
		font: inherit;
		font-weight: 500;
		letter-spacing: inherit;
		transition: border-color 140ms ease;
	}

	.signup-slot::placeholder {
		color: color-mix(in oklab, var(--duvet-ink2) 55%, transparent);
	}

	.signup-slot:focus,
	.signup-slot:focus-visible {
		outline: none;
		border-bottom-color: var(--duvet-accent);
	}

	.signup-slot[aria-invalid="true"] {
		border-bottom-color: var(--duvet-danger);
	}

	.signup-secret {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25em;
	}

	.signup-eye {
		align-self: center;
		width: 0.8em;
		height: 0.8em;
		border-radius: 8px;
		color: var(--duvet-ink2);
	}

	.signup-eye:hover {
		color: var(--duvet-ink);
	}

	.signup-eye:focus-visible {
		outline: 2px solid var(--duvet-accent-text);
		outline-offset: 4px;
	}

	.signup-hint {
		margin: 0.25rem 0 0.75rem;
		font-size: 0.95rem;
		color: var(--duvet-ink2);
	}

	.signup-hint.is-error {
		color: var(--duvet-danger);
	}

	.signup-error {
		margin-top: 1.25rem;
		max-width: 40rem;
		border-radius: 12px;
		background: color-mix(in oklab, var(--duvet-danger) 12%, transparent);
		padding: 0.6rem 0.9rem;
		color: var(--duvet-danger);
	}

	.signup-actions {
		transition: opacity 260ms ease;
		margin-top: 2.25rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1.25rem 2rem;
	}

	.signup-terms {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1rem;
		color: var(--duvet-ink2);
	}

	:global(.signup-check) {
		display: flex;
		width: 1.25rem;
		height: 1.25rem;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		background: var(--duvet-sunk);
		box-shadow: var(--duvet-shadow-press);
		color: var(--duvet-on-accent);
	}

	:global(.signup-check[data-state="checked"]) {
		background: var(--duvet-accent);
		box-shadow: none;
	}

	:global(.signup-check svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	:global(.signup-check:focus-visible) {
		outline: 2px solid var(--duvet-accent-text);
		outline-offset: 2px;
	}

	:global(.signup-submit) {
		width: auto !important;
		padding-inline: 1.75rem !important;
		font-size: 1.05rem;
	}

	.signup-footer {
		margin-top: 1.5rem;
		font-size: 1rem;
		color: var(--duvet-ink2);
	}

	:global(.signup-mascot) {
		position: absolute;
		right: clamp(1rem, 10vw, 9rem);
		bottom: -3.25rem;
		width: clamp(150px, 18vw, 240px);
		pointer-events: none;
	}

	@media (max-width: 720px) {
		:global(.signup-mascot) {
			width: 120px;
			bottom: -2.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.signup-line {
			transition: none;
		}
	}
</style>
