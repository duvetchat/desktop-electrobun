<script lang="ts">
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import { onMount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import ReactionEmoji from "$lib/components/ReactionEmoji.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { getBotUser } from "$lib/api/developer";
	import { onReactionChange, reactionKey, withReaction } from "$lib/reactions";
	import { reactorOf, reactorsToAsk, type ReactorProfile } from "$lib/reactors";
	import { reactorsRequest, type ReactorsRequest } from "$lib/stores.svelte";
	import type { MessageReaction } from "$lib/types";
	import { t } from "$lib/i18n";
	import { formatNumber } from "$lib/i18n/format";

	// Who reacted to a message, as a message's menu or a reaction's right click asks (reactorsRequest): its reactions with
	// their counts down the left, and for the one picked, who reacted with it, oldest first, each with their avatar, name
	// and username. The members the view knows name them; the API says who anyone else is (someone who left), asked about
	// each person shown once, a few at a time. The reactions follow the gateway's events while it's open, and it closes
	// when none is left.
	let open = $state(false);
	let request = $state.raw<ReactorsRequest | null>(null);
	let reactions = $state.raw<MessageReaction[]>([]);
	let picked = $state("");
	// The picked reaction, by its key (reactionKey): two custom emojis can share a name.
	const current = $derived(reactions.find((r) => reactionKey(r) === picked) ?? reactions[0]);

	// What the API said of each person it was asked about since the dialog opened: their profile, or null when it couldn't
	// say (a deleted user). An answer for an earlier opening goes nowhere.
	const profiles = new SvelteMap<string, ReactorProfile | null>();
	const requested = new Set<string>();
	const waiting: string[] = [];
	const AT_ONCE = 4;
	let opening = 0;
	let asking = 0;

	$effect(() => {
		const asked = $reactorsRequest;
		if (!asked) return;
		reactorsRequest.set(null);
		opening++;
		profiles.clear();
		requested.clear();
		waiting.length = 0;
		request = asked;
		reactions = asked.reactions;
		picked = asked.picked;
		open = true;
	});

	onMount(() =>
		onReactionChange((change) => {
			if (request && change.message_id === request.messageId) reactions = withReaction(reactions, change);
		}),
	);

	// Nothing left to show.
	$effect(() => {
		if (open && reactions.length === 0) open = false;
	});

	function askNext() {
		while (asking < AT_ONCE && waiting.length > 0) {
			const userId = waiting.shift()!;
			const askedIn = opening;
			asking++;
			// GET /api/users/{id}: anyone's public profile.
			getBotUser(userId)
				.then(
					(user) => {
						if (askedIn === opening) profiles.set(userId, user);
					},
					() => {
						if (askedIn === opening) profiles.set(userId, null);
					},
				)
				.finally(() => {
					asking--;
					askNext();
				});
		}
	}

	// The people shown that no member is.
	$effect(() => {
		if (!open) return;
		const unknown = reactorsToAsk(current?.users ?? [], request?.members ?? [], requested);
		for (const userId of unknown) requested.add(userId);
		waiting.push(...unknown);
		askNext();
	});

	const people = $derived((current?.users ?? []).map((userId) => reactorOf(userId, request?.members ?? [], profiles)));
</script>

<Sheet bind:open title={t("media_reactions_title")} class="h-[min(28rem,80vh)] max-w-[460px]">
	<div class="-mx-1 -mb-1 flex min-h-0 flex-1">
		<div
			class="border-duvet-line flex w-24 shrink-0 flex-col gap-0.5 overflow-y-auto border-r pr-2 pl-1"
			role="tablist"
			aria-orientation="vertical"
			aria-label={t("media_reactions_title")}
		>
			{#each reactions as reaction (reactionKey(reaction))}
				{@const selected = reaction === current}
				<button
					type="button"
					role="tab"
					aria-selected={selected}
					title={reaction.emoji_name}
					class="flex h-8 shrink-0 items-center gap-2 rounded-[9px] px-2 text-[13px] transition-colors motion-reduce:transition-none {selected
						? 'bg-duvet-accent-tint text-duvet-ink'
						: 'text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink'}"
					onclick={() => (picked = reactionKey(reaction))}
				>
					<ReactionEmoji {reaction} customEmojiMap={request?.customEmojiMap} />
					<span class="font-medium tabular-nums">{formatNumber(reaction.count)}</span>
				</button>
			{/each}
		</div>
		<div class="min-w-0 flex-1 overflow-y-auto pl-2" role="tabpanel" aria-label={t("media_reactions_who")}>
			<ul class="flex flex-col gap-0.5">
				{#each people as person (person.id)}
					<li class="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
						<UserAvatar src={person.avatar} name={person.name} size={32} />
						<div class="flex min-w-0 flex-col">
							<span class="text-duvet-ink truncate text-[13.5px] font-semibold">{person.name}</span>
							{#if person.username}
								<span class="text-duvet-ink2 truncate text-[11.5px]">@{person.username}</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</Sheet>
