<script lang="ts">
	import { getApiError } from "$lib/api/api";
	import { createSpace } from "$lib/api/spaces";
	import JoinInviteModal from "$lib/components/JoinInviteModal.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Segmented from "$lib/components/ui/Segmented.svelte";
	import { FIELD_ERROR, FIELD_LABEL, fieldClass } from "$lib/overlay-forms";

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
			createError = getApiError(e, "Unknown error");
		} finally {
			creating = false;
		}
	}
</script>

<Sheet
	bind:open
	title="Add a Space"
	description="Create your own or join one with an invite code."
	closeLabel="Cancel"
	class="max-w-[440px]"
>
	<Segmented
		bind:value={modalTab}
		label="Create a Space or join one"
		options={[
			{ value: "create", label: "Create" },
			{ value: "join", label: "Join" },
		]}
	/>

	{#if modalTab === "create"}
		<div class="flex flex-col gap-1.5">
			<label for="server-name" class={FIELD_LABEL}>Space Name <span class="text-duvet-danger">*</span></label>
			<input
				id="server-name"
				type="text"
				bind:value={serverName}
				placeholder="My awesome Space"
				class={fieldClass()}
				maxlength={64}
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="server-desc" class={FIELD_LABEL}>Description <span class="font-normal">(optional)</span></label>
			<input
				id="server-desc"
				type="text"
				bind:value={serverDescription}
				placeholder="What's this Space about?"
				class={fieldClass()}
				maxlength={256}
			/>
		</div>
		{#if createError}
			<p class={FIELD_ERROR}>{createError}</p>
		{/if}
	{:else}
		<div class="flex flex-col gap-1.5">
			<label for="join-code" class={FIELD_LABEL}>Invite Code or Link</label>
			<input
				id="join-code"
				type="text"
				bind:value={joinInputValue}
				placeholder="abc123 or invite?code=abc123"
				class="{fieldClass()} font-mono text-[13px]"
			/>
		</div>
	{/if}

	{#snippet foot()}
		<span></span>
		<Button variant="quiet" onclick={() => (open = false)}>Cancel</Button>
		{#if modalTab === "create"}
			<Button onclick={handleCreate} disabled={creating || !serverName.trim()}>
				{creating ? "Creating…" : "Create"}
			</Button>
		{:else}
			<Button onclick={handleJoinSubmit} disabled={!joinInputValue.trim()}>Preview</Button>
		{/if}
	{/snippet}
</Sheet>

<JoinInviteModal bind:open={showJoinPreview} code={joinCode} />
