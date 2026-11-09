<script lang="ts">
	import { untrack } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import { Ban as BanIcon } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { spaceMembers } from "$lib/components/MemberList.svelte";
	import { FetchError, getApiError } from "$lib/api/api";
	import { getBotUser } from "$lib/api/developer";
	import { unbanUser } from "$lib/api/moderation";
	import { banLifted, loadBans, spaceBans } from "$lib/bans";
	import { getAvatarURL } from "$lib/common/common";
	import { reactorOf, reactorsToAsk, type ReactorProfile } from "$lib/reactors";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import type { GatewaySpace, SpaceBan } from "$lib/types";

	// A space's bans, for whoever may list them (Ban Members): each banned user with why, who banned them and when, and
	// Unban. A page at a time, by the banned users' IDs as the API lists them, from the first one each time the section
	// opens; SPACE_BAN_ADD and SPACE_BAN_REMOVE keep the list current meanwhile (lib/bans.ts).
	let { space }: { space: GatewaySpace } = $props();

	const spaceId = $derived(space.id);
	const list = $derived($spaceBans[spaceId]);
	let loading = $state(0);
	let failed = $state(false);
	const unbanning = new SvelteSet<string>();

	async function load(id: string, fresh: boolean) {
		loading++;
		failed = false;
		try {
			await loadBans(id, fresh);
		} catch (err) {
			failed = true;
			toast(getApiError(err, "Couldn't load the bans"), "error");
		} finally {
			loading--;
		}
	}

	// Anew each time it opens, and for another space: what it had may have missed events while it wasn't shown.
	$effect(() => {
		const id = spaceId;
		untrack(() => void load(id, true));
	});

	const nameOf = (ban: SpaceBan) => ban.user.alias ?? ban.user.username;

	function unban(ban: SpaceBan) {
		return confirmAction(`Unban ${nameOf(ban)}? They can join ${space.name} again.`, "Unban", async () => {
			unbanning.add(ban.user_id);
			try {
				await unbanUser(ban.space_id, ban.user_id);
				banLifted(ban);
				toast(`${nameOf(ban)} was unbanned`, "success");
			} catch (err) {
				// A ban lifted meanwhile from elsewhere is gone from the list too.
				if (err instanceof FetchError && err.response?.status === 404) banLifted(ban);
				toast(getApiError(err, "Couldn't unban them"), "error");
			} finally {
				unbanning.delete(ban.user_id);
			}
		});
	}

	// Who banned each of them: a member the space has loaded, or else as the API says (someone who left), asked about
	// each once, a few at a time, as the reactions dialog asks about who reacted.
	const members = $derived(spaceMembers(space));
	const profiles = new SvelteMap<string, ReactorProfile | null>();
	const requested = new Set<string>();
	const waiting: string[] = [];
	const AT_ONCE = 4;
	let asking = 0;

	function askNext() {
		while (asking < AT_ONCE && waiting.length > 0) {
			const userId = waiting.shift()!;
			asking++;
			// GET /api/users/{id}: anyone's public profile.
			getBotUser(userId)
				.then(
					(user) => profiles.set(userId, user),
					() => profiles.set(userId, null),
				)
				.finally(() => {
					asking--;
					askNext();
				});
		}
	}

	$effect(() => {
		const unknown = reactorsToAsk(
			(list?.bans ?? []).map((ban) => ban.banned_by),
			members,
			requested,
		);
		for (const userId of unknown) requested.add(userId);
		waiting.push(...unknown);
		askNext();
	});
</script>

<p class="mb-3 text-sm text-zinc-400">Banned users can't join the space until they're unbanned.</p>
{#if !list || (list.bans.length === 0 && loading > 0)}
	<div class="space-y-2">
		{#each Array(3) as _}
			<div class="h-16 animate-pulse rounded-lg bg-zinc-800/40"></div>
		{/each}
	</div>
{:else if list.bans.length === 0 && !list.more}
	<div class="flex flex-col items-center justify-center py-16 text-zinc-500">
		<BanIcon class="mb-3 size-10" />
		<p class="text-sm">No bans</p>
	</div>
{:else}
	<ul class="space-y-1">
		{#each list.bans as ban (ban.user_id)}
			<li class="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-800/30 px-3 py-2.5">
				<UserAvatar src={getAvatarURL(ban.user_id, ban.user.avatar)} name={ban.user.username} size={36} />
				<div class="min-w-0 flex-1">
					<p class="flex min-w-0 items-baseline gap-1.5">
						<span class="truncate text-sm font-medium text-zinc-200">{nameOf(ban)}</span>
						<span class="truncate text-xs text-zinc-500">@{ban.user.username}</span>
					</p>
					{#if ban.reason}
						<p class="mt-0.5 text-xs wrap-break-word whitespace-pre-wrap text-zinc-300 select-text">{ban.reason}</p>
					{:else}
						<p class="mt-0.5 text-xs text-zinc-500 italic">No reason given</p>
					{/if}
					<p class="text-xxs mt-1 text-zinc-500">
						Banned by {reactorOf(ban.banned_by, members, profiles).name}
						<span class="mx-1 text-zinc-600">&middot;</span>
						{new Date(ban.created_at).toLocaleString()}
					</p>
				</div>
				<button
					type="button"
					class="flex h-8 shrink-0 items-center rounded-md bg-zinc-800 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-red-600/20 hover:text-red-400 disabled:opacity-50"
					disabled={unbanning.has(ban.user_id)}
					onclick={() => unban(ban)}
				>
					Unban
				</button>
			</li>
		{/each}
	</ul>
	{#if list.more}
		<button
			type="button"
			class="mt-3 flex h-9 w-full items-center justify-center rounded-md bg-zinc-800 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
			disabled={loading > 0}
			onclick={() => load(spaceId, false)}
		>
			{loading > 0 ? "Loading…" : failed ? "Try again" : "Load more"}
		</button>
	{/if}
{/if}
