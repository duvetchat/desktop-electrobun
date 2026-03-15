<script lang="ts">
import {
	User as UserIcon,
	X as XIcon,
	Check as CheckIcon,
} from "@lucide/svelte";
import { Dialog } from "bits-ui";
import { currentUser, channelMessages, gatewaySpaces, dmMessages, conversations } from "$lib/stores.svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { updateUser } from "$lib/api/user";

let {
	open = $bindable(false),
}: {
	open?: boolean;
} = $props();

type Section = "account";
let activeSection = $state<Section>("account");

// Form state
let username = $state("");
let alias = $state("");
let avatar = $state("");
let banner = $state("");
let saving = $state(false);
let saveError = $state<string | null>(null);
let saveSuccess = $state(false);

// Sync from currentUser when modal opens
$effect(() => {
	if (open && $currentUser) {
		username = $currentUser.username ?? "";
		alias = $currentUser.alias ?? "";
		avatar = $currentUser.avatar ?? "";
		banner = $currentUser.banner ?? "";
		saveError = null;
		saveSuccess = false;
	}
});

const hasChanges = $derived(
	$currentUser !== null && (
		username !== ($currentUser.username ?? "") ||
		alias !== ($currentUser.alias ?? "") ||
		avatar !== ($currentUser.avatar ?? "") ||
		banner !== ($currentUser.banner ?? "")
	)
);

async function handleSave() {
	if (!$currentUser || saving) return;
	saving = true;
	saveError = null;
	saveSuccess = false;

	try {
		const updated = await updateUser({
			username: username.trim() || $currentUser!.username,
			alias: alias.trim() || null,
			avatar: avatar.trim() || null,
			banner: banner.trim() || null,
		});

		currentUser.update((u) =>
			u
				? {
						...u,
						username: updated.username,
						alias: updated.alias ?? null,
						avatar: updated.avatar ?? null,
						banner: updated.banner ?? null,
					}
				: u,
		);

		const newName = updated.alias ?? updated.username;
		const newAvatar = updated.avatar ?? null;
		const userId = $currentUser?.id;

		if (userId) {
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => ({
					...s,
					users: s.users.map((u) =>
						u.id === userId
							? { ...u, username: updated.username, alias: updated.alias ?? null, avatar: newAvatar, banner: updated.banner ?? null }
							: u,
					),
				})),
			);

			channelMessages.update((rooms) => {
				const result: typeof rooms = {};
				for (const [roomId, msgs] of Object.entries(rooms)) {
					result[roomId] = msgs.map((m) =>
						m.author_id === userId
							? { ...m, author_name: newName, author_avatar_url: newAvatar }
							: m,
					);
				}
				return result;
			});

			dmMessages.update((convs) => {
				const result: typeof convs = {};
				for (const [convId, msgs] of Object.entries(convs)) {
					result[convId] = msgs.map((m) => {
						if (m.author_id !== userId || !m.users) return m;
						return {
							...m,
							users: { ...m.users, username: updated.username, alias: updated.alias ?? null, avatar: newAvatar, banner: updated.banner ?? null },
						};
					});
				}
				return result;
			});

			conversations.update((list) =>
				list.map((c) => ({
					...c,
					members: c.members.map((m) =>
						m.user_id === userId
							? { ...m, users: { ...m.users, username: updated.username, alias: updated.alias ?? null, avatar: newAvatar, banner: updated.banner ?? null } }
							: m,
					),
				})),
			);
		}

		saveSuccess = true;
		setTimeout(() => (saveSuccess = false), 2000);
	} catch (err) {
		saveError = err instanceof Error ? err.message : "Failed to save changes";
	} finally {
		saving = false;
	}
}

function handleReset() {
	if (!$currentUser) return;
	username = $currentUser.username ?? "";
	alias = $currentUser.alias ?? "";
	avatar = $currentUser.avatar ?? "";
	banner = $currentUser.banner ?? "";
	saveError = null;
}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-500 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content
			class="fixed inset-0 z-501 flex items-center justify-center p-4"
		>
			<div
				class="flex h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl text-zinc-100"
			>
				<!-- Left sidebar -->
				<aside class="w-52 shrink-0 bg-zinc-950 flex flex-col py-6 border-r border-zinc-800">
					<div class="px-4 mb-3">
						<p class="text-xxs font-bold tracking-widest uppercase text-zinc-400 px-2 mb-1">
							User Settings
						</p>
					</div>
					<nav class="flex flex-col gap-0.5 px-2">
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors text-left
								{activeSection === 'account'
								? 'bg-zinc-800 text-white'
								: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "account")}
						>
							<UserIcon class="size-4 shrink-0" />
							My Account
						</button>
					</nav>
				</aside>

				<!-- Main content -->
				<div class="flex flex-1 flex-col min-w-0">
					<!-- Header -->
					<div class="flex items-center justify-between border-b border-zinc-800 px-6 py-4 shrink-0">
						<h2 class="text-base font-semibold text-white">
							{#if activeSection === "account"}My Account{/if}
						</h2>
						<Dialog.Close
							class="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
						>
							<XIcon class="size-4" />
						</Dialog.Close>
					</div>

					<!-- Scrollable content -->
					<div class="flex-1 overflow-y-auto px-6 py-6 space-y-6">
						{#if activeSection === "account"}
							<!-- Profile preview card -->
							<div class="rounded-xl overflow-hidden border border-zinc-800">
								<!-- Banner -->
								<div
									class="h-20 bg-linear-to-r from-stone-700 to-stone-600 relative"
									style={banner.trim() ? `background-image: url('${banner.trim()}'); background-size: cover; background-position: center;` : ""}
								></div>
								<!-- Avatar + name row -->
								<div class="bg-zinc-800/60 px-4 pb-4">
									<div class="flex items-end gap-3 -mt-6 mb-3">
										<div class="ring-4 ring-zinc-800 rounded-full">
											<UserAvatar
												src={avatar.trim() || $currentUser?.avatar}
												name={alias.trim() || $currentUser?.username || ""}
												size={48}
											/>
										</div>
									</div>
									<p class="font-semibold text-white text-sm">
										{alias.trim() || username || ""}
									</p>
									<p class="text-xs text-zinc-400 mt-0.5">
										{username || $currentUser?.username || ""}
									</p>
								</div>
							</div>

							<!-- Form fields -->
							<div class="space-y-5">
								<!-- Display name -->
								<div>
									<label
										for="alias"
										class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
									>
										Display Name
									</label>
									<input
										id="alias"
										type="text"
										bind:value={alias}
										maxlength={32}
										placeholder={$currentUser?.username ?? ""}
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition-colors focus-override"
									/>
									<p class="mt-1 text-xs text-zinc-500">
										This is how others see you. Leave empty to use your username.
									</p>
								</div>

								<!-- Username -->
								<div>
									<label
										for="username"
										class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
									>
										Username
									</label>
									<input
										id="username"
										type="text"
										bind:value={username}
										maxlength={32}
										placeholder="username"
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition-colors focus-override"
									/>
								</div>

								<!-- Avatar URL -->
								<div>
									<label
										for="avatar"
										class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
									>
										Avatar URL
									</label>
									<input
										id="avatar"
										type="url"
										bind:value={avatar}
										placeholder="https://example.com/avatar.png"
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition-colors focus-override"
									/>
								</div>

								<!-- Banner URL -->
								<div>
									<label
										for="banner"
										class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
									>
										Banner URL
									</label>
									<input
										id="banner"
										type="url"
										bind:value={banner}
										placeholder="https://example.com/banner.png"
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition-colors focus-override"
									/>
								</div>
							</div>
						{/if}
					</div>

					<!-- Save bar (appears when there are unsaved changes) -->
					{#if hasChanges || saveError}
						<div class="shrink-0 border-t border-zinc-800 bg-zinc-900/80 px-6 py-3 flex items-center justify-between gap-4">
							<div class="flex items-center gap-2 min-w-0">
								{#if saveError}
									<p class="text-sm text-red-400 truncate">{saveError}</p>
								{:else}
									<p class="text-sm text-zinc-400">You have unsaved changes.</p>
								{/if}
							</div>
							<div class="flex items-center gap-2 shrink-0">
								<button
									onclick={handleReset}
									disabled={saving}
									class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
								>
									Reset
								</button>
								<button
									onclick={handleSave}
									disabled={saving}
									class="flex items-center gap-1.5 rounded-md bg-stone-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-stone-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{#if saveSuccess}
										<CheckIcon class="size-4" />
										Saved
									{:else if saving}
										Saving…
									{:else}
										Save Changes
									{/if}
								</button>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
