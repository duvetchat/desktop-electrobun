<script lang="ts">
	import { untrack } from "svelte";
	import { get } from "svelte/store";
	import { Phone as PhoneIcon } from "@lucide/svelte";
	import MascotPeek from "$lib/components/MascotPeek.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import type { Conversation } from "$lib/api/conversations";
	import { callBackAction, callHistory, callRow, callTime, loadCalls } from "$lib/call-history";
	import { callNoticeText } from "$lib/call-notices";
	import {
		activeCall,
		conversations,
		conversationsWithCalls,
		currentUser,
		jumpToMessageRequest,
		ownCallsRinging,
	} from "$lib/stores.svelte";
	import type { MessageLink } from "$lib/urls";
	import { formatShortDateTime } from "$lib/utils/time";
	import { joinConversationCall, startConversationCall } from "$lib/voice";

	// The user's calls, the newest first: the call notices of the conversations they're in (lib/call-history.ts), a page at
	// a time, the next one as the list's end comes into view.
	let {
		onOpen = (link) => jumpToMessageRequest.set({ id: crypto.randomUUID(), ...link }),
	}: {
		/** Opens a call's notice in its conversation, as a result of the search everywhere opens its message. */
		onOpen?: (link: MessageLink) => void;
	} = $props();

	const focusRing =
		"focus-override focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-duvet-accent";

	const list = $derived($callHistory);
	const rows = $derived.by(() => {
		const me = $currentUser?.id;
		const byId = new Map($conversations.map((c) => [c.id, c]));
		return (list?.calls ?? []).flatMap((notice) => {
			const conversation = byId.get(notice.conversation_id ?? "");
			const row = callRow(notice, conversation, me);
			return row ? [{ ...row, conversation }] : [];
		});
	});

	let loading = $state(false);
	let failed = $state(false);
	let endInView = $state(false);

	async function load() {
		loading = true;
		failed = false;
		try {
			await loadCalls();
		} catch (err) {
			// Production's API answers 404 until it has the route: the list says it couldn't, with Try again.
			console.error("[Calls] Failed to load:", err);
			failed = true;
		} finally {
			loading = false;
		}
	}

	// The first page as the tab first shows, and the next ones while the list's end is in view. After a failure, only Try
	// again asks.
	$effect(() => {
		if (loading || failed) return;
		if (list === null || (list.more && endInView)) untrack(() => void load());
	});

	// Whether the list's end is on screen: the row that says the next page is loading.
	function watchEnd(node: HTMLElement) {
		const observer = new IntersectionObserver(([entry]) => (endInView = entry.isIntersecting));
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
				endInView = false;
			},
		};
	}

	function callBack(conversation: Conversation) {
		const action = callBackAction(conversation.id, get(conversationsWithCalls), get(ownCallsRinging), get(activeCall));
		if (action === "join") joinConversationCall(conversation);
		else if (action === "call") startConversationCall(conversation);
	}
</script>

{#snippet placeholder(mood: "awake" | "shy" | "peek", title: string, line: string)}
	<div class="flex flex-col items-center px-6 py-16 text-center" role="status">
		<MascotPeek class="w-24" {mood} />
		<p class="text-duvet-ink mt-4 text-base font-bold">{title}</p>
		<p class="text-duvet-ink2 mt-1 max-w-80 text-sm">{line}</p>
		{#if failed}
			<button
				type="button"
				class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised hover:text-duvet-ink mt-5 flex h-8 items-center rounded-xl px-3 text-[13px] font-bold transition-colors motion-reduce:transition-none {focusRing}"
				onclick={load}
			>
				Try again
			</button>
		{/if}
	</div>
{/snippet}

{#if failed && rows.length === 0}
	{@render placeholder("shy", "Couldn't load your calls", "Your calls show here once they load.")}
{:else if !list || (rows.length === 0 && list.more)}
	<ul use:watchEnd class="flex flex-col gap-px" aria-busy="true" aria-label="Loading your calls">
		{#each [0, 1, 2, 3] as i (i)}
			<li class="flex items-center gap-3 px-2 py-2">
				<div class="bg-duvet-card size-10 shrink-0 animate-pulse rounded-full"></div>
				<div class="flex flex-1 flex-col gap-2">
					<div class="bg-duvet-card h-3 w-32 animate-pulse rounded"></div>
					<div class="bg-duvet-card h-3 w-56 animate-pulse rounded"></div>
				</div>
			</li>
		{/each}
	</ul>
{:else if rows.length === 0}
	{@render placeholder("peek", "No calls yet", "Calls in your direct messages and groups show here.")}
{:else}
	<ul class="flex flex-col gap-px" aria-label="Calls">
		{#each rows as row (row.id)}
			{@const action = row.conversation
				? callBackAction(row.conversationId, $conversationsWithCalls, $ownCallsRinging, $activeCall)
				: null}
			<li
				class="rounded-row hover:bg-duvet-card/70 flex items-center gap-3 px-2 py-2 transition-colors motion-reduce:transition-none"
			>
				<!-- Opens the conversation at the call's notice, as a result of the search everywhere does -->
				<button
					type="button"
					class="rounded-row flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left {focusRing}"
					onclick={() => onOpen({ spaceId: "", roomId: "", messageId: row.id, conversationId: row.conversationId })}
				>
					<UserAvatar src={row.avatar} name={row.title} size={40} />
					<span class="flex min-w-0 flex-1 flex-col leading-tight">
						<!-- A missed call reads as an unread chat does: by its weight -->
						<span class="text-duvet-ink truncate text-sm {row.line.missed ? 'font-bold' : 'font-medium'}"
							>{row.title}</span
						>
						<span class="text-duvet-ink2 flex min-w-0 items-center gap-1 text-xs">
							<!-- Red for a call the user missed, as its notice in the conversation -->
							<PhoneIcon class="size-3 shrink-0 {row.line.missed ? 'text-red-400' : ''}" aria-hidden="true" />
							<span class="truncate">{callNoticeText(row.line)}</span>
						</span>
					</span>
					<time class="text-duvet-ink2 shrink-0 text-xs" datetime={row.at} title={formatShortDateTime(row.at)}
						>{callTime(row.at)}</time
					>
				</button>
				<button
					type="button"
					class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised hover:text-duvet-ink flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none {focusRing}"
					aria-label={action === "join" ? `Join the call in ${row.title}` : `Call ${row.title}`}
					title={action === "join" ? "Join the call" : "Call"}
					disabled={!action}
					onclick={() => row.conversation && callBack(row.conversation)}
				>
					<PhoneIcon class="size-4" />
				</button>
			</li>
		{/each}
	</ul>
	{#if list.more}
		{#if failed}
			<div class="flex items-center justify-center gap-3 py-4" role="status">
				<span class="text-duvet-ink2 text-sm">Couldn't load more calls</span>
				<button
					type="button"
					class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised hover:text-duvet-ink flex h-8 items-center rounded-xl px-3 text-[13px] font-bold transition-colors motion-reduce:transition-none {focusRing}"
					onclick={load}
				>
					Try again
				</button>
			</div>
		{:else}
			<p use:watchEnd class="text-duvet-ink2 py-4 text-center text-xs" role="status">Loading…</p>
		{/if}
	{/if}
{/if}
