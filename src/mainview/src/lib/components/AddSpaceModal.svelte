<script lang="ts">
	import { getApiError } from "$lib/api/api";
	import { Dialog, Tabs } from "bits-ui";
	import { createSpace } from "$lib/api/spaces";
	import JoinInviteModal from "$lib/components/JoinInviteModal.svelte";

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

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<div
				class="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl"
			>
				<Dialog.Title class="text-center text-lg font-bold text-white">Add a Server</Dialog.Title>
				<p class="-mt-2 text-center text-sm text-zinc-300">Create your own or join one with an invite code.</p>

				<Tabs.Root bind:value={modalTab}>
					<Tabs.List class="grid grid-cols-2 gap-2 rounded-lg bg-stone-800/80 p-1">
						<Tabs.Trigger
							value="create"
							class="data-[state=active]:bg-fill-600 data-[state=active]:text-fixed-white rounded-md px-3 py-2 text-sm font-semibold text-zinc-300"
						>
							Create
						</Tabs.Trigger>
						<Tabs.Trigger
							value="join"
							class="data-[state=active]:bg-fill-600 data-[state=active]:text-fixed-white rounded-md px-3 py-2 text-sm font-semibold text-zinc-300"
						>
							Join
						</Tabs.Trigger>
					</Tabs.List>

					<Tabs.Content value="create" class="mt-4 space-y-3">
						<div class="flex flex-col gap-1">
							<label for="server-name" class="text-xs font-semibold tracking-wider text-zinc-400 uppercase"
								>Server Name <span class="text-red-400">*</span></label
							>
							<input
								id="server-name"
								type="text"
								bind:value={serverName}
								placeholder="My awesome server"
								class="rounded-md bg-zinc-800 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-stone-500"
								maxlength={64}
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label for="server-desc" class="text-xs font-semibold tracking-wider text-zinc-400 uppercase"
								>Description <span class="text-zinc-500">(optional)</span></label
							>
							<input
								id="server-desc"
								type="text"
								bind:value={serverDescription}
								placeholder="What's this server about?"
								class="rounded-md bg-zinc-800 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-stone-500"
								maxlength={256}
							/>
						</div>
						{#if createError}
							<p class="text-xs text-red-400">{createError}</p>
						{/if}
						<div class="flex justify-end">
							<button
								onclick={handleCreate}
								disabled={creating || !serverName.trim()}
								class="bg-fill-600 text-fixed-white hover:bg-fill-500 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
								>{creating ? "Creating…" : "Create"}</button
							>
						</div>
					</Tabs.Content>

					<Tabs.Content value="join" class="mt-4 space-y-3">
						<div class="flex flex-col gap-1">
							<label for="join-code" class="text-xs font-semibold tracking-wider text-zinc-400 uppercase"
								>Invite Code or Link</label
							>
							<input
								id="join-code"
								type="text"
								bind:value={joinInputValue}
								placeholder="abc123 or invite?code=abc123"
								class="rounded-md bg-zinc-800 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-stone-500"
							/>
						</div>
						<div class="flex justify-end">
							<button
								onclick={handleJoinSubmit}
								disabled={!joinInputValue.trim()}
								class="bg-fill-600 text-fixed-white hover:bg-fill-500 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
								>Preview</button
							>
						</div>
					</Tabs.Content>
				</Tabs.Root>

				<div class="mt-1 flex justify-center">
					<Dialog.Close
						class="rounded-md px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
						>Cancel</Dialog.Close
					>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<JoinInviteModal bind:open={showJoinPreview} code={joinCode} />
