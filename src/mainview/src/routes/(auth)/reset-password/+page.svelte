<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
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

	// What the mascot does: it follows what's typed, and shuts its eyes on a password.
	let focusedField = $state<"text" | "secret" | null>(null);
	let typed = $state(0);
	const mood = $derived(focusedField === "secret" ? (showPassword ? "peek" : "shy") : "awake");
	const look = $derived(focusedField === "text" ? Math.min(typed, 28) / 14 - 1 : 0);
</script>

<AuthScene {mood} {look}>
	{#if status === "form"}
		<header class="mb-6 text-center">
			<h1 class="text-duvet-ink text-2xl font-bold">Reset your password</h1>
			<p class="text-duvet-ink2 mt-1 text-sm">Enter your new password below.</p>
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
				<label for="password" class="text-duvet-ink2 mb-2 block text-sm font-medium">New password</label>
				<div class="relative">
					<input
						id="password"
						onfocus={() => (focusedField = "secret")}
						onblur={() => (focusedField = null)}
						type={showPassword ? "text" : "password"}
						autocomplete="new-password"
						minlength={8}
						maxlength={128}
						required
						bind:value={password}
						class="auth-field pr-11"
						placeholder="Minimum 8 characters"
					/>
					<button
						type="button"
						class="text-duvet-ink2 hover:text-duvet-ink absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
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
				<label for="confirmPassword" class="text-duvet-ink2 mb-2 block text-sm font-medium">Confirm password</label>
				<input
					id="confirmPassword"
					onfocus={() => (focusedField = "secret")}
					onblur={() => (focusedField = null)}
					type={showPassword ? "text" : "password"}
					autocomplete="new-password"
					minlength={8}
					maxlength={128}
					required
					bind:value={confirmPassword}
					class="auth-field"
					placeholder="Re-enter your password"
				/>
				{#if confirmPassword && !passwordsMatch}
					<p class="mt-2 text-xs text-rose-400">Passwords don't match.</p>
				{/if}
			</div>

			<button type="submit" class="auth-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSubmit}>
				Reset password
			</button>
		</form>
	{:else if status === "loading"}
		<div class="flex flex-col items-center gap-4 py-8">
			<div class="size-10 animate-spin rounded-full border-4 border-zinc-600 border-t-stone-400"></div>
			<p class="text-duvet-ink2 text-sm">Resetting your password...</p>
		</div>
	{:else if status === "success"}
		<div class="flex flex-col items-center gap-4 py-8 text-center">
			<div class="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600/20 text-emerald-400">
				<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="20 6 9 17 4 12" />
				</svg>
			</div>
			<h1 class="text-duvet-ink text-xl font-bold">Password reset!</h1>
			<p class="text-duvet-ink2 text-sm">Your password has been changed successfully.</p>
			<a href={route("/sign-in.html")} class="auth-primary mt-2 text-sm"> Sign in </a>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-4 py-8 text-center">
			<div class="flex h-14 w-14 items-center justify-center rounded-full bg-red-600/20 text-red-400">
				<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2">
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</div>
			<h1 class="text-duvet-ink text-xl font-bold">Reset failed</h1>
			<p class="text-duvet-ink2 text-sm">{errorMessage}</p>
			<a href={route("/sign-in.html")} class="auth-primary mt-2 text-sm"> Go to Sign In </a>
		</div>
	{/if}
</AuthScene>
