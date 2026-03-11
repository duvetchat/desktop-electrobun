<script lang="ts">
import { Button, Label } from "bits-ui";

let email = $state("");
let doingRequest = $state(false);
let errorMessage = $state("");
let successMessage = $state("");

async function handleSubmit() {
	doingRequest = true;
	errorMessage = "";
	successMessage = "";
	try {
		await new Promise((resolve) => setTimeout(resolve, 700));
		successMessage =
			"If an account exists for this email, you will receive reset instructions shortly.";
	} catch {
		errorMessage = "We couldn't process your request right now. Please try again.";
	} finally {
		doingRequest = false;
	}
}
</script>

<section class="h-full overflow-y-auto bg-zinc-950 p-4 sm:p-8">
	<div class="mx-auto flex min-h-full w-full max-w-md items-center justify-center py-6 sm:py-10">
		<div class="w-full rounded-2xl border border-stone-700/70 bg-[linear-gradient(180deg,oklch(0.2_0.01_80/.96),oklch(0.17_0.008_80/.98))] p-6 text-zinc-100 shadow-2xl sm:p-8">
			<header class="mb-6 text-center">
				<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-br from-stone-500 to-stone-700 text-white shadow-md shadow-stone-900/40">
					<svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M12 17v.01" />
						<path d="M8 10V8a4 4 0 118 0v2" />
						<rect x="5" y="10" width="14" height="10" rx="2" />
					</svg>
				</div>
				<h1 class="text-2xl font-semibold text-white sm:text-3xl">Forgot password?</h1>
				<p class="mt-1 text-sm text-zinc-300 sm:text-base">Enter your email and we will send reset instructions.</p>
			</header>

			<form class="space-y-5" onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}} novalidate aria-busy={doingRequest}>
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
						class="w-full rounded-lg border border-stone-700 bg-stone-900/70 px-4 py-3 text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-stone-500/70"
						placeholder="you@example.com"
					/>
				</div>

				{#if errorMessage}
					<p class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{errorMessage}</p>
				{/if}

				{#if successMessage}
					<p class="rounded-md border border-stone-500/40 bg-stone-500/10 px-3 py-2 text-sm text-stone-200">{successMessage}</p>
				{/if}

				<Button.Root
					type="submit"
					disabled={doingRequest}
					class={`flex w-full items-center justify-center rounded-lg bg-linear-to-br from-stone-500 to-stone-700 py-3 text-base font-semibold text-white shadow-lg shadow-stone-900/40 transition hover:brightness-110 ${doingRequest ? "cursor-not-allowed opacity-60" : ""}`}
				>
					{doingRequest ? "Sending reset email..." : "Send reset email"}
				</Button.Root>
			</form>

			<footer class="mt-6 text-center text-sm text-zinc-300">
				Remembered your password?
				
				<a href="/sign-in" class="ml-1 text-stone-300 hover:text-stone-200 hover:underline">
					Back to sign in
				</a>
			</footer>
		</div>
	</div>
</section>
