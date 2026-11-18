<script lang="ts">
	import { Dialog } from "bits-ui";
	import { onMount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import ReactionEmoji from "$lib/components/ReactionEmoji.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { getBotUser } from "$lib/api/developer";
	import { onReactionChange, withReaction } from "$lib/reactions";
	import { reactorOf, reactorsToAsk, type ReactorProfile } from "$lib/reactors";
	import { reactorsRequest, type ReactorsRequest } from "$lib/stores.svelte";
	import type { MessageReaction } from "$lib/types";

	// Who reacted to a message, as a message's menu or a reaction's right click asks (reactorsRequest): its reactions with
	// their counts down the left, and for the one picked, who reacted with it, oldest first, each with their avatar, name
	// and username. The members the view knows name them; the API says who anyone else is (someone who left), asked about
	// each person shown once, a few at a time. The reactions follow the gateway's events while it's open, and it closes
	// when none is left.
	let open = $state(false);
	let request = $state.raw<ReactorsRequest | null>(null);
	let reactions = $state.raw<MessageReaction[]>([]);
	let picked = $state("");
	const current = $derived(reactions.find((r) => r.emoji_name === picked) ?? reactions[0]);

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

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-51 flex items-center justify-center p-4">
			<div
				class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float flex h-[min(28rem,80vh)] w-full max-w-md flex-col overflow-hidden border"
			>
				<div class="border-duvet-line flex items-center justify-between border-b px-5 py-4">
					<Dialog.Title class="text-duvet-ink text-base font-semibold">Reactions</Dialog.Title>
					<Dialog.Close
						class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink rounded-lg p-1.5 transition-colors"
						aria-label="Close"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
						>
					</Dialog.Close>
				</div>
				<div class="flex min-h-0 flex-1">
					<div
						class="border-duvet-line flex w-24 shrink-0 flex-col gap-1 overflow-y-auto border-r p-2"
						role="tablist"
						aria-orientation="vertical"
						aria-label="Reactions"
					>
						{#each reactions as reaction (reaction.emoji_name)}
							{@const selected = reaction === current}
							<button
								type="button"
								role="tab"
								aria-selected={selected}
								title={reaction.emoji_name}
								class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors {selected
									? 'bg-duvet-ink/10 text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink'}"
								onclick={() => (picked = reaction.emoji_name)}
							>
								<ReactionEmoji {reaction} customEmojiMap={request?.customEmojiMap} />
								<span class="font-medium tabular-nums">{reaction.count}</span>
							</button>
						{/each}
					</div>
					<div class="min-w-0 flex-1 overflow-y-auto p-2" role="tabpanel" aria-label="Who reacted">
						<ul class="flex flex-col gap-0.5">
							{#each people as person (person.id)}
								<li class="flex items-center gap-3 rounded-md px-2 py-1.5">
									<UserAvatar src={person.avatar} name={person.name} size={32} />
									<div class="flex min-w-0 flex-col">
										<span class="text-duvet-ink truncate text-sm font-semibold">{person.name}</span>
										{#if person.username}
											<span class="text-duvet-ink2 truncate text-xs">@{person.username}</span>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
