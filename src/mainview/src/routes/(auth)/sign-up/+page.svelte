<script lang="ts">
	import { onMount } from "svelte";
	import { signIn, logIn } from "$lib/api/auth";
	import { Button, Checkbox, Dialog, Label } from "bits-ui";
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

	const passwordsMatch = $derived(password === confirmPassword);
	const canSubmit = $derived(
		username.trim() && email.trim() && password && confirmPassword && passwordsMatch && acceptTerms,
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
</script>

<section class="h-full overflow-y-auto bg-zinc-950 p-4 sm:p-8">
	<div class="mx-auto flex min-h-full w-full max-w-lg items-center justify-center py-6 sm:py-10">
		<div
			class="w-full rounded-2xl border border-stone-700/70 bg-[linear-gradient(180deg,oklch(0.2_0.01_80/.96),oklch(0.17_0.008_80/.98))] p-6 text-zinc-100 shadow-2xl sm:p-8"
		>
			<header class="mb-6 text-center">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-br from-stone-500 to-stone-700 text-white shadow-md shadow-stone-900/40"
				>
					<svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M12 11c2 0 3.5-1.5 3.5-3.5S14 4 12 4s-3.5 1.5-3.5 3.5S10 11 12 11z" />
						<path d="M6 20v-1a4 4 0 014-4h4a4 4 0 014 4v1" />
					</svg>
				</div>
				<h1 class="text-2xl font-semibold text-white sm:text-3xl">Create your account</h1>
				<p class="mt-1 text-sm text-zinc-300 sm:text-base">Join Duvet and start chatting in seconds.</p>
			</header>

			<form
				class="space-y-4"
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				novalidate
			>
				<fieldset disabled={doingRequest} class="m-0 space-y-4 border-0 p-0">
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<Label.Root for="username" class="mb-2 block text-sm font-medium text-zinc-300">Username</Label.Root>
							<input
								id="username"
								name="username"
								type="text"
								autocomplete="username"
								autocapitalize="off"
								autocorrect="off"
								spellcheck="false"
								maxlength={32}
								required
								bind:value={username}
								class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
								placeholder="e.g. alex"
							/>
						</div>
						<div>
							<Label.Root for="alias" class="mb-2 block text-sm font-medium text-zinc-300"
								>Display name (optional)</Label.Root
							>
							<input
								id="alias"
								name="alias"
								type="text"
								maxlength={64}
								bind:value={alias}
								class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
								placeholder="How others see you"
							/>
						</div>
					</div>

					<div>
						<Label.Root for="email" class="mb-2 block text-sm font-medium text-zinc-300">Email</Label.Root>
						<input
							id="email"
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
							class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
							placeholder="you@example.com"
						/>
					</div>

					<div>
						<div class="mb-2 flex items-center justify-between">
							<Label.Root for="password" class="block text-sm font-medium text-zinc-300">Password</Label.Root>
							<span class="text-xs text-zinc-400">Minimum 8 characters</span>
						</div>
						<div class="relative">
							<input
								id="password"
								name="password"
								type={showPassword ? "text" : "password"}
								autocomplete="new-password"
								minlength={8}
								maxlength={128}
								required
								bind:value={password}
								class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 pr-11 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
								placeholder="Create a password"
							/>
							<button
								type="button"
								class="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-100"
								aria-pressed={showPassword}
								aria-label={showPassword ? "Hide password" : "Show password"}
								onclick={() => (showPassword = !showPassword)}
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

					<div>
						<Label.Root for="confirmPassword" class="mb-2 block text-sm font-medium text-zinc-300"
							>Confirm password</Label.Root
						>
						<input
							id="confirmPassword"
							name="confirmPassword"
							type={showPassword ? "text" : "password"}
							autocomplete="new-password"
							minlength={8}
							maxlength={128}
							required
							bind:value={confirmPassword}
							class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
							placeholder="Re-enter your password"
							aria-invalid={!passwordsMatch && confirmPassword.length > 0}
						/>
						{#if confirmPassword && !passwordsMatch}
							<p class="mt-2 text-xs text-rose-400">Passwords don't match.</p>
						{/if}
					</div>

					{#if errorMessage}
						<p class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
							{errorMessage}
						</p>
					{/if}

					<label class="inline-flex items-center gap-2 text-sm text-zinc-300">
						<Checkbox.Root
							bind:checked={acceptTerms}
							class="flex h-4 w-4 items-center justify-center rounded border border-stone-600 bg-stone-900/70 data-[state=checked]:border-stone-600 data-[state=checked]:bg-stone-600"
						>
							{#if acceptTerms}
								<span class="text-xxs text-white">✓</span>
							{/if}
						</Checkbox.Root>
						<span
							>I agree to the <button
								type="button"
								class="ml-1 text-stone-300 hover:text-stone-200 hover:underline"
								onclick={() => (showTermsModal = true)}>Terms of use</button
							></span
						>
					</label>

					<Button.Root
						type="submit"
						class="flex w-full items-center justify-center rounded-lg bg-linear-to-br from-stone-500 to-stone-700 py-3 font-semibold text-white shadow-lg shadow-stone-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
						disabled={!canSubmit || doingRequest}
						aria-busy={doingRequest}
					>
						{doingRequest ? "Creating account..." : "Create account"}
					</Button.Root>
				</fieldset>
			</form>

			<footer class="mt-6 text-center text-sm text-zinc-300">
				Already have an account?
				<a href="/sign-in{redirectQuery}" class="ml-1 text-stone-300 hover:text-stone-200 hover:underline"> Sign in </a>
			</footer>
		</div>
	</div>
</section>

<Dialog.Root bind:open={showTermsModal}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<div class="w-full max-w-lg rounded-2xl border border-stone-700/70 bg-stone-950/95 p-6 text-white">
				<Dialog.Title class="mb-3 text-xl font-semibold">Terms of use</Dialog.Title>
				<Dialog.Description class="text-sm leading-6 text-zinc-300">
					By creating an account, you agree to follow community guidelines and use Duvet respectfully.
				</Dialog.Description>
				<div class="mt-6 flex justify-end">
					<Dialog.Close class="rounded-md bg-stone-600 px-4 py-2 text-white hover:bg-stone-500">Close</Dialog.Close>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
