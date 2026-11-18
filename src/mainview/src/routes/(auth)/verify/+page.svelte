<script lang="ts">
	import AuthScene from "$lib/components/AuthScene.svelte";
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

<AuthScene>
	{#if status === "loading"}
		<div class="flex flex-col items-center gap-4 py-8">
			<div class="border-duvet-line border-t-duvet-ink2/40 size-10 animate-spin rounded-full border-4"></div>
			<p class="text-duvet-ink2 text-sm">Verifying your email...</p>
		</div>
	{:else if status === "success"}
		<div class="flex flex-col items-center gap-4 py-8 text-center">
			<div class="bg-duvet-alive/20 text-duvet-alive flex h-14 w-14 items-center justify-center rounded-full">
				<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="20 6 9 17 4 12" />
				</svg>
			</div>
			<h1 class="text-duvet-ink text-xl font-bold">Email verified!</h1>
			<p class="text-duvet-ink2 text-sm">Your email has been verified successfully.</p>
			<a href={route("/app.html")} class="auth-primary mt-2 text-sm"> Go to Duvet </a>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-4 py-8 text-center">
			<div class="bg-duvet-danger/20 text-duvet-danger flex h-14 w-14 items-center justify-center rounded-full">
				<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2">
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</div>
			<h1 class="text-duvet-ink text-xl font-bold">Verification failed</h1>
			<p class="text-duvet-ink2 text-sm">{errorMessage}</p>
			<a href={route("/sign-in.html")} class="auth-primary mt-2 text-sm"> Go to Sign In </a>
		</div>
	{/if}
</AuthScene>
