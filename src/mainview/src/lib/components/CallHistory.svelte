<script lang="ts">
	import { untrack } from "svelte";
	import { get } from "svelte/store";
	import { Phone as PhoneIcon, PhoneMissed } from "@lucide/svelte";
	import GroupMark from "$lib/components/GroupMark.svelte";
	import MascotPeek from "$lib/components/MascotPeek.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";
	import type { Conversation } from "$lib/api/conversations";
	import { callBackAction, callHistory, callRow, callTime, loadCalls } from "$lib/call-history";
	import { callNoticeText } from "$lib/call-notices";
	import { t } from "$lib/i18n";
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
	// a time, the next one as the list's end comes into view. It is the list of the call history's popover
	// (CallHistoryPopover.svelte), and of the Friends page's Calls tab while that page has one.
	let {
		onOpen = (link) => jumpToMessageRequest.set({ id: crypto.randomUUID(), ...link }),
	}: {
		/** Opens a call's notice in its conversation, as a result of the search everywhere opens its message. */
		onOpen?: (link: MessageLink) => void;
	} = $props();

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
		const observer = new IntersectionObserver(([entry]) => (endInView = entry!.isIntersecting));
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
	<div class="flex flex-col items-center px-6 py-10 text-center" role="status">
		<MascotPeek class="w-[88px]" {mood} />
		<p class="text-duvet-ink mt-3 font-serif text-[17px] font-medium">{title}</p>
		<p class="text-duvet-ink2 mt-1 max-w-72 text-[13px]">{line}</p>
		{#if failed}
			<Button variant="secondary" size="sm" class="mt-4" onclick={load}>{t("call_history_try_again")}</Button>
		{/if}
	</div>
{/snippet}

{#if failed && rows.length === 0}
	{@render placeholder("shy", t("call_history_load_failed"), t("call_history_load_failed_line"))}
{:else if !list || (rows.length === 0 && list.more)}
	<ul use:watchEnd class="flex flex-col" aria-busy="true" aria-label={t("call_history_loading_label")}>
		{#each [0, 1, 2, 3] as i (i)}
			<li class="flex items-center gap-2.5 py-1.5 pr-1.5 pl-2">
				<div
					class="bg-duvet-secondary-fill size-8 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
				></div>
				<div class="flex flex-1 flex-col gap-1.5">
					<div class="bg-duvet-secondary-fill h-3 w-28 animate-pulse rounded motion-reduce:animate-none"></div>
					<div class="bg-duvet-secondary-fill h-2.5 w-48 animate-pulse rounded motion-reduce:animate-none"></div>
				</div>
			</li>
		{/each}
	</ul>
{:else if rows.length === 0}
	{@render placeholder("peek", t("call_history_empty"), t("call_history_empty_line"))}
{:else}
	<ul class="flex flex-col" aria-label={t("call_history_list_label")}>
		{#each rows as row (row.id)}
			{@const action = row.conversation
				? callBackAction(row.conversationId, $conversationsWithCalls, $ownCallsRinging, $activeCall)
				: null}
			<li
				class="hover:bg-duvet-hover flex items-center gap-1 rounded-xl py-1.5 pr-1.5 pl-2 transition-colors motion-reduce:transition-none"
			>
				<!-- Opens the conversation at the call's notice, as a result of the search everywhere does -->
				<button
					type="button"
					class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg text-left"
					onclick={() => onOpen({ spaceId: "", roomId: "", messageId: row.id, conversationId: row.conversationId })}
				>
					{#if row.group}
						<GroupMark size={32} />
					{:else}
						<UserAvatar src={row.avatar} name={row.title} size={32} />
					{/if}
					<span class="flex min-w-0 flex-1 flex-col gap-px">
						<!-- A missed call reads in the destructive colour, name and line, as its notice in the conversation -->
						<span
							class="truncate text-[13.5px] leading-[1.25] font-semibold {row.line.missed
								? 'text-duvet-danger'
								: 'text-duvet-ink'}">{row.title}</span
						>
						<span
							class="flex min-w-0 items-center gap-1 text-[11.5px] leading-[1.25] {row.line.missed
								? 'text-duvet-danger'
								: 'text-duvet-ink2'}"
						>
							{#if row.line.missed}
								<PhoneMissed class="shrink-0" size={12} aria-hidden="true" />
							{:else}
								<PhoneIcon class="shrink-0" size={12} aria-hidden="true" />
							{/if}
							<span class="truncate">{callNoticeText(row.line)}</span>
						</span>
					</span>
					<time
						class="text-duvet-ink2 shrink-0 text-[11.5px] tabular-nums"
						datetime={row.at}
						title={formatShortDateTime(row.at)}>{callTime(row.at)}</time
					>
				</button>
				<Tooltip text={action === "join" ? t("call_history_join_tip") : t("call_history_call_tip")} side="left">
					{#snippet trigger(props)}
						<IconButton
							{...props}
							label={action === "join"
								? t("call_history_join_label", { name: row.title })
								: t("call_history_call_label", { name: row.title })}
							disabled={!action}
							onclick={() => row.conversation && callBack(row.conversation)}
						>
							<PhoneIcon size={16} />
						</IconButton>
					{/snippet}
				</Tooltip>
			</li>
		{/each}
	</ul>
	{#if list.more}
		{#if failed}
			<div class="flex items-center justify-center gap-3 py-3" role="status">
				<span class="text-duvet-ink2 text-[13px]">{t("call_history_more_failed")}</span>
				<Button variant="secondary" size="sm" onclick={load}>{t("call_history_try_again")}</Button>
			</div>
		{:else}
			<p use:watchEnd class="text-duvet-ink2 py-3 text-center text-xs" role="status">
				{t("call_history_loading_more")}
			</p>
		{/if}
	{/if}
{/if}
