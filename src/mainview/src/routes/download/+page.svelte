<script lang="ts">
	import { Download as DownloadIcon } from "@lucide/svelte";
	import AuthScene from "$lib/components/AuthScene.svelte";
	import { t } from "$lib/i18n";

	// Where people get the desktop app (#456): its Windows installer, from the rolling desktop-stable release of
	// duvetchat/releases that the app's updater follows. On the web only: the packaged app copies no such page.
	const WINDOWS_INSTALLER =
		"https://github.com/duvetchat/releases/releases/download/desktop-stable/stable-win-x64-Duvet-Setup.zip";
</script>

<svelte:head>
	<title>{t("public_download_page_title")}</title>
</svelte:head>

<AuthScene title={t("public_download_title")} lead={t("public_download_lead")}>
	<div class="flex flex-col gap-3">
		<a
			href={WINDOWS_INSTALLER}
			class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-semibold no-underline"
		>
			<DownloadIcon size={16} aria-hidden="true" />
			{t("public_download_windows")}
		</a>
		<p class="text-duvet-ink2 text-center text-[13px] leading-[1.4]">
			{t("public_download_other_systems")}
		</p>
	</div>
</AuthScene>
