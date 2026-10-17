<script lang="ts">
	import { onMount } from "svelte";
	import { resetPassword } from "$lib/api/auth";
	import { route } from "$lib/common/common";

	let status = $state<"form" | "loading" | "success" | "error">("form");
	let errorMessage = $state("");
	let token = $state("");
	let password = $state("");
	let confirmPassword = $state("");
	let showPassword = $state(false);

	const passwordsMatch = $derived(password === confirmPassword);
	const canSubmit = $derived(password.length >= 8 && passwordsMatch);

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
</script>

<section class="h-full overflow-y-auto bg-zinc-950 p-4 sm:p-8">
	<div class="mx-auto flex min-h-full w-full max-w-lg items-center justify-center py-6 sm:py-10">
		<div
			class="w-full rounded-2xl border border-stone-700/70 bg-[linear-gradient(180deg,oklch(0.2_0.01_80/.96),oklch(0.17_0.008_80/.98))] p-6 text-zinc-100 shadow-2xl sm:p-8"
		>
			{#if status === "form"}
				<header class="mb-6 text-center">
					<div
						class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-br from-stone-500 to-stone-700 text-white shadow-md shadow-stone-900/40"
					>
						<svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.5">
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0 1 10 0v4" />
						</svg>
					</div>
					<h1 class="text-2xl font-semibold text-white">Reset your password</h1>
					<p class="mt-1 text-sm text-zinc-300">Enter your new password below.</p>
				</header>

				<form
					class="space-y-4"
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					novalidate
				>
					<div>
						<label for="password" class="mb-2 block text-sm font-medium text-zinc-300">New password</label>
						<div class="relative">
							<input
								id="password"
								type={showPassword ? "text" : "password"}
								autocomplete="new-password"
								minlength={8}
								maxlength={128}
								required
								bind:value={password}
								class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 pr-11 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
								placeholder="Minimum 8 characters"
							/>
							<button
								type="button"
								class="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-100"
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
						<label for="confirmPassword" class="mb-2 block text-sm font-medium text-zinc-300">Confirm password</label>
						<input
							id="confirmPassword"
							type={showPassword ? "text" : "password"}
							autocomplete="new-password"
							minlength={8}
							maxlength={128}
							required
							bind:value={confirmPassword}
							class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-stone-500/70 focus:outline-none"
							placeholder="Re-enter your password"
						/>
						{#if confirmPassword && !passwordsMatch}
							<p class="mt-2 text-xs text-rose-400">Passwords don't match.</p>
						{/if}
					</div>

					<button
						type="submit"
						class="flex w-full items-center justify-center rounded-lg bg-linear-to-br from-stone-500 to-stone-700 py-3 font-semibold text-white shadow-lg shadow-stone-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
						disabled={!canSubmit}
					>
						Reset password
					</button>
				</form>
			{:else if status === "loading"}
				<div class="flex flex-col items-center gap-4 py-8">
					<div class="size-10 animate-spin rounded-full border-4 border-zinc-600 border-t-stone-400"></div>
					<p class="text-sm text-zinc-300">Resetting your password...</p>
				</div>
			{:else if status === "success"}
				<div class="flex flex-col items-center gap-4 py-8 text-center">
					<div class="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600/20 text-emerald-400">
						<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="20 6 9 17 4 12" />
						</svg>
					</div>
					<h1 class="text-xl font-semibold text-white">Password reset!</h1>
					<p class="text-sm text-zinc-300">Your password has been changed successfully.</p>
					<a
						href={route("/sign-in.html")}
						class="mt-2 inline-block rounded-lg bg-stone-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-500"
					>
						Sign in
					</a>
				</div>
			{:else}
				<div class="flex flex-col items-center gap-4 py-8 text-center">
					<div class="flex h-14 w-14 items-center justify-center rounded-full bg-red-600/20 text-red-400">
						<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</div>
					<h1 class="text-xl font-semibold text-white">Reset failed</h1>
					<p class="text-sm text-zinc-300">{errorMessage}</p>
					<a
						href={route("/sign-in.html")}
						class="mt-2 inline-block rounded-lg bg-stone-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-500"
					>
						Go to Sign In
					</a>
				</div>
			{/if}
		</div>
	</div>
</section>
