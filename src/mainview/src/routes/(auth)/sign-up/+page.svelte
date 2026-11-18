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

	// The sentence's lines. Each one fades in, rising a little, once the one before it reads right (hiddenPart).
	const lineClass =
		"text-[clamp(1.6rem,3.4vw,2.9rem)] leading-[1.45] font-bold tracking-[-0.02em] transition-[opacity,translate] duration-260 ease-[ease] motion-reduce:transition-none";
	const hiddenPart = "pointer-events-none translate-y-2 opacity-0";
	// An inline field as wide as its text: the field and an invisible copy of that text share one grid cell.
	const sizerClass =
		"inline-grid max-w-full align-baseline after:invisible after:col-start-1 after:row-start-1 after:px-[0.2em] after:font-medium after:whitespace-pre after:content-[attr(data-text)]";
	// The field. Its underline is its focus ring, so it takes no global one (focus-override).
	const slotClass =
		"focus-override text-duvet-accent-text col-start-1 row-start-1 w-full min-w-[2ch] border-0 border-b-3 border-b-[color-mix(in_oklab,var(--duvet-ink2)_45%,transparent)] px-[0.15em] font-medium transition-[border-color] duration-140 ease-[ease] placeholder:text-[color-mix(in_oklab,var(--duvet-ink2)_55%,transparent)] focus:border-b-duvet-accent focus:outline-none aria-invalid:border-b-duvet-danger";
	const hintClass = "mt-1 mb-3 text-[0.95rem]";
</script>

<section
	class="bg-duvet-bg text-duvet-ink relative h-full overflow-x-clip overflow-y-auto bg-[radial-gradient(45%_50%_at_85%_100%,color-mix(in_oklab,var(--duvet-accent)_18%,transparent),transparent_70%)]"
>
	<p
		class="absolute top-8 left-[clamp(1.5rem,8vw,7.5rem)] text-[1.375rem] font-bold tracking-[-0.02em]"
		aria-hidden="true"
	>
		Duvet<span class="text-duvet-accent">.chat</span>
	</p>

	<form
		class="max-w-[76rem] px-[clamp(1.5rem,8vw,7.5rem)] pt-28 pb-48"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		novalidate
		aria-label="Create your account"
	>
		<fieldset disabled={doingRequest} class="m-0 border-0 p-0">
			<h1 class="text-duvet-ink2 mb-7 text-[1.25rem] font-normal">
				a cozy place to talk, and you're about to join it.
			</h1>

			<p class={lineClass}>
				Hi, I'm
				<span class={sizerClass} data-text={sizer(alias, "your name", false)}
					><input
						id="alias"
						name="alias"
						type="text"
						aria-label="Display name (optional)"
						maxlength={32}
						bind:value={alias}
						class={slotClass}
						size={1}
						placeholder="your name"
						{...onText}
					/></span
				>,
			</p>

			<p class={lineClass}>
				people find me as @<span class={sizerClass} data-text={sizer(username, "username", false)}
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
						class={slotClass}
						size={1}
						placeholder="username"
						{...onText}
					/></span
				>
			</p>
			<p
				id="username-hint"
				class="{hintClass} {username.length > 0 && !usernameValid ? 'text-duvet-danger' : 'text-duvet-ink2'}"
			>
				Letters, numbers, dots and _, 2 to 32. It's how people mention you.
			</p>

			<p class="{lineClass} {shown < 2 ? hiddenPart : ''}" inert={shown < 2}>
				and you can reach me at
				<span class={sizerClass} data-text={sizer(email, "you@example.com", false)}
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
						class={slotClass}
						size={1}
						placeholder="you@example.com"
						{...onText}
					/></span
				>.
			</p>

			<p class="{lineClass} {shown < 3 ? hiddenPart : ''}" inert={shown < 3}>
				My password is
				<span class="inline-flex items-baseline gap-[0.25em]">
					<span class={sizerClass} data-text={sizer(password, "8 or more", true)}
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
							class={slotClass}
							size={1}
							placeholder="8 or more"
							{...onSecret}
						/></span
					>
					<button
						type="button"
						class="text-duvet-ink2 hover:text-duvet-ink focus-visible:outline-duvet-accent-text size-[0.8em] self-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid"
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

			<p class="{lineClass} {shown < 4 ? hiddenPart : ''}" inert={shown < 4}>
				once more, to be sure:
				<span class={sizerClass} data-text={sizer(confirmPassword, "the same", true)}
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
						class={slotClass}
						size={1}
						placeholder="the same"
						{...onSecret}
					/></span
				>.
			</p>
			{#if confirmPassword && !passwordsMatch}
				<p class="{hintClass} text-duvet-danger" role="status">Passwords don't match.</p>
			{/if}

			{#if errorMessage}
				<p
					class="text-duvet-danger mt-5 max-w-[40rem] rounded-xl bg-[color-mix(in_oklab,var(--duvet-danger)_12%,transparent)] px-[0.9rem] py-[0.6rem]"
					role="alert"
				>
					{errorMessage}
				</p>
			{/if}

			<div
				class="mt-9 flex flex-wrap items-center gap-x-8 gap-y-5 transition-opacity duration-260 ease-[ease] {shown < 4
					? hiddenPart
					: ''}"
				inert={shown < 4}
			>
				<label class="text-duvet-ink2 inline-flex items-center gap-[0.6rem] text-[1rem]">
					<!-- Its outline is its focus ring, so it takes no global one (focus-override). -->
					<Checkbox.Root
						bind:checked={acceptTerms}
						class="focus-override bg-duvet-sunk shadow-duvet-press text-duvet-on-accent data-[state=checked]:bg-duvet-accent focus-visible:outline-duvet-accent-text flex size-5 items-center justify-center rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid data-[state=checked]:shadow-none"
					>
						{#if acceptTerms}
							<svg
								class="size-[0.9rem]"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								stroke-width="2.2"
								aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke-linecap="round" stroke-linejoin="round" /></svg
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
					class="auth-primary w-auto px-7 text-[1.05rem] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={!canSubmit || doingRequest}
					aria-busy={doingRequest}
				>
					{doingRequest ? "Creating account..." : "Create my account"}
				</Button.Root>
			</div>

			<p class="text-duvet-ink2 mt-6 text-[1rem]">
				Already have an account? <a href="/sign-in{redirectQuery}" class="auth-link">Sign in</a>
			</p>
		</fieldset>
	</form>

	<MascotPeek
		{mood}
		{look}
		class="pointer-events-none absolute right-[clamp(1rem,10vw,9rem)] -bottom-13 w-[clamp(150px,18vw,240px)] [@media(max-width:720px)]:-bottom-10 [@media(max-width:720px)]:w-[120px]"
	/>
</section>

<Dialog.Root bind:open={showTermsModal}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<div
				class="border-duvet-line bg-duvet-card shadow-duvet-float rounded-card text-duvet-ink w-full max-w-lg border p-6"
			>
				<Dialog.Title class="mb-3 text-xl font-semibold">Terms of use</Dialog.Title>
				<Dialog.Description class="text-duvet-ink2 text-sm leading-6">
					By creating an account, you agree to follow community guidelines and use Duvet respectfully.
				</Dialog.Description>
				<div class="mt-6 flex justify-end">
					<Dialog.Close
						class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-4 py-2 hover:brightness-110"
						>Close</Dialog.Close
					>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
