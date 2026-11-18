<script lang="ts">
	import { untrack } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import { Ban as BanIcon } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { CARD, NOTE, SKELETON } from "$lib/components/settings/recipes";
	import { FetchError, getApiError } from "$lib/api/api";
	import { getBotUser } from "$lib/api/developer";
	import { unbanUser } from "$lib/api/moderation";
	import { banLifted, banModerators, loadBans, spaceBans } from "$lib/bans";
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
	// The Space's own people, as reactorOf reads them, without the members list's module: it loads the gateway
	// connection, which a Space settings window must not (lib/app-windows.ts).
	const members = $derived(banModerators(space));
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

<p class={NOTE}>Banned people can't join the Space until they're unbanned.</p>
{#if !list || (list.bans.length === 0 && loading > 0)}
	<div class="flex flex-col gap-2">
		{#each Array(3) as _, index (index)}
			<div class="{SKELETON} h-16"></div>
		{/each}
	</div>
{:else if list.bans.length === 0 && !list.more}
	<div class="text-duvet-ink2 flex flex-col items-center justify-center py-14">
		<BanIcon class="mb-3 size-9" />
		<p class="text-sm">No bans</p>
	</div>
{:else}
	<ul class="{CARD} divide-duvet-line divide-y">
		{#each list.bans as ban (ban.user_id)}
			<li class="flex items-start gap-3 px-3.5 py-2.5">
				<UserAvatar src={getAvatarURL(ban.user_id, ban.user.avatar)} name={ban.user.username} size={32} />
				<div class="min-w-0 flex-1">
					<p class="flex min-w-0 items-baseline gap-1.5">
						<span class="truncate text-[13.5px] font-medium">{nameOf(ban)}</span>
						<span class="text-duvet-ink2 truncate text-xs">@{ban.user.username}</span>
					</p>
					{#if ban.reason}
						<p class="font-content mt-0.5 text-xs wrap-break-word whitespace-pre-wrap select-text">{ban.reason}</p>
					{:else}
						<p class="text-duvet-ink2 mt-0.5 text-xs italic">No reason given</p>
					{/if}
					<p class="text-duvet-ink2 mt-1 text-[11px]">
						Banned by {reactorOf(ban.banned_by, members, profiles).name}
						<span class="mx-1 opacity-60">&middot;</span>
						{new Date(ban.created_at).toLocaleString()}
					</p>
				</div>
				<Button variant="secondary" size="sm" disabled={unbanning.has(ban.user_id)} onclick={() => unban(ban)}>
					Unban
				</Button>
			</li>
		{/each}
	</ul>
	{#if list.more}
		<Button variant="secondary" class="w-full" disabled={loading > 0} onclick={() => load(spaceId, false)}>
			{loading > 0 ? "Loading…" : failed ? "Try again" : "Load more"}
		</Button>
	{/if}
{/if}
