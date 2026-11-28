<script lang="ts">
	import { ArrowLeft as BackIcon } from "@lucide/svelte";
	import Licenses from "$lib/components/Licenses.svelte";
	import { route } from "$lib/common/common";
	import { t } from "$lib/i18n";

	// The Licenses page for anyone, with an account or not (#628), which the sign-in pages link at their foot
	// (AuthScene.svelte): duvet.chat/licenses on the web, licenses.html in the desktop app, which copies it
	// (electrobun.config.ts). Settings shows the same notices as a section of its own.
	function goBack() {
		if (history.length > 1) history.back();
		else window.location.href = route("/sign-in.html");
	}
</script>

<svelte:head>
	<title>{t("public_licenses_page_title")}</title>
</svelte:head>

<main class="bg-duvet-bg text-duvet-ink h-full overflow-y-auto">
	<div class="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-8 min-[640px]:px-8">
		<button type="button" class="auth-link flex items-center gap-1.5 self-start text-[13px]" onclick={goBack}>
			<BackIcon size={14} aria-hidden="true" />
			{t("public_licenses_back")}
		</button>
		<h1 class="text-[32px] leading-[1.1] font-bold tracking-[-0.02em]">{t("public_licenses_title")}</h1>
		<Licenses />
	</div>
</main>
