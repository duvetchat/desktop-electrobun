<script lang="ts">
	import { getApiError } from "$lib/api/api";
	import { createSpace } from "$lib/api/spaces";
	import JoinInviteModal from "$lib/components/JoinInviteModal.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Segmented from "$lib/components/ui/Segmented.svelte";
	import { FIELD_ERROR, FIELD_LABEL, fieldClass } from "$lib/overlay-forms";
	import Rich from "$lib/components/Rich.svelte";
	import { t } from "$lib/i18n";

	/** Creating a space, or joining one with an invite code or link, which shows the invite's preview first. */
	let { open = $bindable(false) }: { open?: boolean } = $props();

	// ── Create server modal ────────────────────────────────────────────────────
	let modalTab = $state<"create" | "join">("create");
	let serverName = $state("");
	let serverDescription = $state("");
	let creating = $state(false);
	let createError = $state("");

	// ── Join server modal ──────────────────────────────────────────────────────
	let joinInputValue = $state("");
	let showJoinPreview = $state(false);
	let joinCode = $state<string | null>(null);

	function extractCode(input: string): string {
		const value = input.trim();
		if (!value) return "";

		const htmlMatch = value.match(/[?&]code=([^&#\s]+)/);
		if (htmlMatch?.[1]) return decodeURIComponent(htmlMatch[1]);

		const pathMatch = value.match(/\/invite\/([^/?#\s]+)/);
		if (pathMatch?.[1]) return pathMatch[1];

		const hashMatch = value.match(/#invite:([^\s]+)/);
		if (hashMatch?.[1]) return decodeURIComponent(hashMatch[1]);

		return value;
	}

	// Each time it opens, it opens on Create, empty.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			modalTab = "create";
			serverName = "";
			serverDescription = "";
			createError = "";
			joinInputValue = "";
		}
		wasOpen = open;
	});

	function handleJoinSubmit() {
		const code = extractCode(joinInputValue);
		if (!code) return;
		joinCode = code;
		open = false;
		showJoinPreview = true;
	}

	async function handleCreate() {
		if (!serverName.trim()) return;
		creating = true;
		createError = "";
		try {
			await createSpace(serverName.trim(), serverDescription.trim() || undefined);
			open = false;
		} catch (e) {
			createError = getApiError(e, t("dialog_unknown_error"));
		} finally {
			creating = false;
		}
	}
</script>

{#snippet optional(text: string)}<span class="font-normal">{text}</span>{/snippet}

<Sheet
	bind:open
	title={t("people_add_space_title")}
	description={t("people_add_space_description")}
	closeLabel={t("dialog_cancel")}
	class="max-w-[440px]"
>
	<Segmented
		bind:value={modalTab}
		label={t("people_add_space_mode")}
		options={[
			{ value: "create", label: t("people_add_space_tab_create") },
			{ value: "join", label: t("people_add_space_tab_join") },
		]}
	/>

	{#if modalTab === "create"}
		<div class="flex flex-col gap-1.5">
			<label for="server-name" class={FIELD_LABEL}
				>{t("people_add_space_name_label")} <span class="text-duvet-danger">*</span></label
			>
			<input
				id="server-name"
				type="text"
				bind:value={serverName}
				placeholder={t("people_add_space_name_placeholder")}
				class={fieldClass()}
				maxlength={64}
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="server-desc" class={FIELD_LABEL}
				><Rich key="people_add_space_description_label" tags={{ optional }} /></label
			>
			<input
				id="server-desc"
				type="text"
				bind:value={serverDescription}
				placeholder={t("people_add_space_description_placeholder")}
				class={fieldClass()}
				maxlength={256}
			/>
		</div>
		{#if createError}
			<p class={FIELD_ERROR}>{createError}</p>
		{/if}
	{:else}
		<div class="flex flex-col gap-1.5">
			<label for="join-code" class={FIELD_LABEL}>{t("people_add_space_code_label")}</label>
			<input
				id="join-code"
				type="text"
				bind:value={joinInputValue}
				placeholder={t("people_add_space_code_placeholder")}
				class="{fieldClass()} font-mono text-[13px]"
			/>
		</div>
	{/if}

	{#snippet foot()}
		<span></span>
		<Button variant="quiet" onclick={() => (open = false)}>{t("dialog_cancel")}</Button>
		{#if modalTab === "create"}
			<Button onclick={handleCreate} disabled={creating || !serverName.trim()}>
				{creating ? t("people_add_space_creating") : t("people_add_space_create")}
			</Button>
		{:else}
			<Button onclick={handleJoinSubmit} disabled={!joinInputValue.trim()}>{t("people_add_space_preview")}</Button>
		{/if}
	{/snippet}
</Sheet>

<JoinInviteModal bind:open={showJoinPreview} code={joinCode} />
