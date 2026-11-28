<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";
	import Disclosure from "$lib/components/ui/Disclosure.svelte";
	import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
	import { calloutClass, NOTE, SKELETON, TAG } from "$lib/components/settings/recipes";
	import { t, type MessageKey } from "$lib/i18n";
	import { loadLicenses, type Licenses, type Notice, type Platform } from "$lib/licenses";

	// The Licenses page (#628): the notices of everything the app ships, by where it ships, each folded until it's
	// opened. Settings shows it as a section; anyone, with an account or not, at /licenses (routes/licenses). The notices
	// come from the build (lib/licenses.ts), fetched as the page shows: `licenses` hands them in instead.
	let { licenses = undefined }: { licenses?: Licenses } = $props();

	let loaded = $state.raw<Licenses | null>(null);
	let failed = $state(false);
	const shown = $derived(licenses ?? loaded);

	function load() {
		failed = false;
		loadLicenses().then(
			(value) => (loaded = value),
			(err: unknown) => {
				console.error("[licenses] The notices didn't load:", err);
				failed = true;
			},
		);
	}

	$effect(() => {
		if (!licenses) load();
	});

	const GROUPS: { key: Exclude<keyof Licenses, "core">; title: MessageKey }[] = [
		{ key: "page", title: "settings_licenses_page" },
		{ key: "bun", title: "settings_licenses_bun" },
		{ key: "runtime", title: "settings_licenses_runtime" },
		{ key: "assets", title: "settings_licenses_assets" },
	];
	// Systems' names, which aren't translated.
	const PLATFORMS: Record<Platform, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };
</script>

{#snippet notice(entry: Notice)}
	<Disclosure
		defaultOpen={false}
		class="hover:bg-duvet-ink/5 flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-[120ms] motion-reduce:transition-none"
		panelClass="px-4 pb-4"
	>
		{#snippet header()}
			<span class="min-w-0 flex-1">
				<span class="text-duvet-ink text-[14.5px] font-medium break-words">{entry.name}</span>
				{#if entry.version}
					<span class="text-duvet-ink2 ml-1.5 text-[13px] break-all">{entry.version}</span>
				{/if}
			</span>
			{#each entry.platforms ?? [] as platform (platform)}
				<span class="{TAG} bg-duvet-ink/10 text-duvet-ink2">{PLATFORMS[platform]}</span>
			{/each}
			{#if entry.license}
				<span class="{TAG} bg-duvet-ink/10 text-duvet-ink2 max-w-[40%] truncate">{entry.license}</span>
			{/if}
		{/snippet}
		<pre
			class="bg-duvet-sunk text-duvet-ink2 rounded-row max-h-[420px] overflow-auto p-3 font-mono text-[12px] leading-[1.55] break-words whitespace-pre-wrap select-text">{entry.text}</pre>
	</Disclosure>
{/snippet}

<div class="flex flex-col gap-7" data-licenses>
	<p class={NOTE}>{t("settings_licenses_lead")}</p>
	{#if shown}
		{#each GROUPS as group (group.key)}
			{#if shown[group.key].length > 0}
				<SettingsGroup title={t(group.title)}>
					{#each shown[group.key] as entry (`${entry.name}@${entry.version}`)}
						{@render notice(entry)}
					{/each}
				</SettingsGroup>
			{/if}
		{/each}
		<SettingsGroup title={t("settings_licenses_core")}>
			{#if shown.core}
				{@render notice({
					name: "duvetchat/e2e",
					version: shown.core.commit.slice(0, 7),
					license: "",
					text: shown.core.text,
				})}
			{:else}
				<p class="{calloutClass('warn')} m-3" role="status">{t("settings_licenses_core_missing")}</p>
			{/if}
		</SettingsGroup>
	{:else if failed}
		<div class="{calloutClass('danger')} items-center justify-between" role="alert">
			<p>{t("settings_licenses_failed")}</p>
			<Button variant="secondary" size="sm" onclick={load}>{t("dialog_try_again")}</Button>
		</div>
	{:else}
		<!-- The rows' places, as a list that says what it waits for (CallHistory's loading list). -->
		<ul class="flex flex-col gap-2" aria-busy="true" aria-label={t("settings_licenses_loading")}>
			{#each Array(6) as _, index (index)}
				<li class="{SKELETON} h-[52px]"></li>
			{/each}
		</ul>
	{/if}
</div>
