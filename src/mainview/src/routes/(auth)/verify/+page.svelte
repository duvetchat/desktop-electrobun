<script lang="ts">
	import { onMount } from "svelte";
	import { verifyEmail } from "$lib/api/auth";
	import { route } from "$lib/common/common";

	let status = $state<"loading" | "success" | "error">("loading");
	let errorMessage = $state("");

	onMount(async () => {
		const token = new URLSearchParams(window.location.search).get("token");

		if (!token) {
			status = "error";
			errorMessage = "No verification token found.";
			return;
		}

		try {
			await verifyEmail(token);
			status = "success";
		} catch (err) {
			status = "error";
			errorMessage = err instanceof Error ? err.message : "Verification failed. The link may have expired.";
		}
	});
</script>

<section class="h-full overflow-y-auto bg-zinc-950 p-4 sm:p-8">
	<div class="mx-auto flex min-h-full w-full max-w-lg items-center justify-center py-6 sm:py-10">
		<div
			class="w-full rounded-2xl border border-stone-700/70 bg-[linear-gradient(180deg,oklch(0.2_0.01_80/.96),oklch(0.17_0.008_80/.98))] p-6 text-zinc-100 shadow-2xl sm:p-8"
		>
			{#if status === "loading"}
				<div class="flex flex-col items-center gap-4 py-8">
					<div class="size-10 animate-spin rounded-full border-4 border-zinc-600 border-t-stone-400"></div>
					<p class="text-sm text-zinc-300">Verifying your email...</p>
				</div>
			{:else if status === "success"}
				<div class="flex flex-col items-center gap-4 py-8 text-center">
					<div
						class="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600/20 text-emerald-400"
					>
						<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="20 6 9 17 4 12" />
						</svg>
					</div>
					<h1 class="text-xl font-semibold text-white">Email verified!</h1>
					<p class="text-sm text-zinc-300">Your email has been verified successfully.</p>
					<a
						href={route("/app.html")}
						class="mt-2 inline-block rounded-lg bg-stone-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-500"
					>
						Go to Duvet
					</a>
				</div>
			{:else}
				<div class="flex flex-col items-center gap-4 py-8 text-center">
					<div
						class="flex h-14 w-14 items-center justify-center rounded-full bg-red-600/20 text-red-400"
					>
						<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</div>
					<h1 class="text-xl font-semibold text-white">Verification failed</h1>
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
