<script lang="ts">
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
</script>

<section class="h-full overflow-y-auto bg-zinc-950 p-4 sm:p-8">
	<div class="mx-auto flex min-h-full w-full max-w-md items-center justify-center py-6 sm:py-10">
		<div
			class="w-full rounded-2xl border border-stone-700/70 bg-[linear-gradient(180deg,oklch(0.2_0.01_80/.96),oklch(0.17_0.008_80/.98))] p-6 text-zinc-100 shadow-2xl sm:p-8"
		>
			<header class="mb-6 text-center">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-br from-stone-500 to-stone-700 text-white shadow-md shadow-stone-900/40"
				>
					<svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.6">
						<path d="M6 8.5c1.5-1 4-1.5 6-1.5s4.5.5 6 1.5" />
						<circle cx="9" cy="12.5" r="1" />
						<circle cx="15" cy="12.5" r="1" />
					</svg>
				</div>
				<h1 class="text-2xl font-semibold text-white sm:text-3xl">Welcome back</h1>
				<p class="mt-1 text-sm text-zinc-300 sm:text-base">Sign in to continue to Duvet.</p>
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
						disabled={doingRequest}
						class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
						placeholder="you@example.com"
					/>
				</div>

				<div>
					<div class="mb-2 flex items-center justify-between">
						<Label.Root for="password" class="block text-sm font-medium text-zinc-300">Password</Label.Root>
						<a href="/forgot-password" class="text-sm text-stone-300 hover:text-stone-200 hover:underline"
							>Forgot password?</a
						>
					</div>
					<div class="relative">
						<input
							id="password"
							name="password"
							type={showPassword ? "text" : "password"}
							autocomplete="current-password"
							maxlength={128}
							required
							bind:value={password}
							disabled={doingRequest}
							class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 pr-11 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
							placeholder="Enter your password"
						/>
						<button
							type="button"
							class="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-100"
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
					<p class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
						{errorMessage}
					</p>
				{/if}

				<Button.Root
					type="submit"
					disabled={doingRequest}
					class={`flex w-full items-center justify-center rounded-lg bg-linear-to-br from-stone-500 to-stone-700 py-3 text-base font-semibold text-white shadow-lg shadow-stone-900/40 transition hover:brightness-110 ${doingRequest ? "cursor-not-allowed opacity-60" : ""}`}
					aria-busy={doingRequest}
				>
					{doingRequest ? "Signing in..." : "Sign in"}
				</Button.Root>
			</form>

			<footer class="mt-6 text-center text-sm text-zinc-300">
				New to Duvet?
				<a href="/sign-up{redirectQuery}" class="ml-1 text-stone-300 hover:text-stone-200 hover:underline"
					>Create an account</a
				>
			</footer>
		</div>
	</div>
</section>
