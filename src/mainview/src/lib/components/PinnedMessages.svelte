<script lang="ts">
	import { Pin as PinIcon, X as XIcon } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import { onMount, untrack } from "svelte";
	import MentionProfile from "$lib/components/MentionProfile.svelte";
	import MessagePreview from "$lib/components/MessagePreview.svelte";
	import ImagePreview from "$lib/components/ImagePreview.svelte";
	import { getRoomPins, unpinRoomMessage } from "$lib/api/messages";
	import { getConversationPins, unpinConversationMessage, type DirectMessage } from "$lib/api/conversations";
	import { getApiError } from "$lib/api/api";
	import { toast } from "$lib/stores/toast.svelte";
	import {
		gatewaySpaces,
		jumpToMessageRequest,
		onOpenElsewhere,
		pinUpdates,
		pinsPanelRequest,
	} from "$lib/stores.svelte";
	import { gatewayMessageToMessage } from "$lib/types";
	import type { GatewaySpace, MemberOnSidebar, Message, SpaceEmoji } from "$lib/types";
	import { hasPermission, Permission } from "$lib/permissions";
	import { customEmojiMapOf, mentionMapOf, sameNames } from "$lib/markdown";

	// The pin button of a pane's bar (or a conversation's header), and the list of its pinned messages, the
	// last pinned first. A message jumps to itself; who can pin unpins it from here too.
	let {
		space = null,
		channelId,
		conversation = false,
		members = [],
		customEmojis = [],
		toDirectMessage,
	}: {
		/** The channel's space. A conversation's list passes conversation instead. */
		space?: GatewaySpace | null;
		/** The room's or the conversation's ID. */
		channelId: string;
		conversation?: boolean;
		members?: MemberOnSidebar[];
		customEmojis?: SpaceEmoji[];
		/** How a conversation's pins become messages. */
		toDirectMessage?: (m: DirectMessage) => Message;
	} = $props();

	let open = $state(false);
	let loading = $state(false);
	let failure = $state<string | null>(null);
	let pins = $state.raw<Message[]>([]);
	let controller: AbortController | null = null;

	// In a space, those with PinMessages in the room (its owner and Administrators have it); in a
	// conversation, every member.
	const canPin = $derived.by(() => {
		if (conversation) return true;
		const s = space;
		const room = s?.rooms.find((r) => r.id === channelId);
		return !!s && !!room && hasPermission(s, room, Permission.PinMessages);
	});
	// The names mentions show: a new map only when one of them changes, not with every change of the members (a
	// presence, a voice state), which drew every message's text again (#324).
	let mentionNames: Record<string, string> = {};
	const mentionMap = $derived.by(() => {
		const next = mentionMapOf(members);
		if (!sameNames(next, mentionNames)) mentionNames = next;
		return mentionNames;
	});
	const customEmojiMap = $derived(customEmojiMapOf(customEmojis));
	let mentionProfile: MentionProfile;

	// A pinned image opens over the app; the list closes first, as a click outside it would close it.
	let previewSrc = $state("");
	let previewAlt = $state("");
	let previewOpen = $state(false);
	function openPreview(src: string, alt = "") {
		open = false;
		previewSrc = src;
		previewAlt = alt;
		previewOpen = true;
	}

	async function load() {
		controller?.abort();
		const ctl = (controller = new AbortController());
		loading = true;
		failure = null;
		try {
			if (conversation) {
				const convert = toDirectMessage;
				const rows = await getConversationPins(channelId, ctl.signal);
				pins = convert ? rows.map(convert) : [];
			} else {
				const rows = await getRoomPins(channelId, ctl.signal);
				pins = rows.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
			}
		} catch (err) {
			if (ctl.signal.aborted) return;
			failure = getApiError(err, "Couldn't load the pinned messages");
		} finally {
			if (controller === ctl) loading = false;
		}
	}

	// Opening loads the list, and a pin or unpin here reloads it while it's open.
	$effect(() => {
		if (open) untrack(() => void load());
		else controller?.abort();
	});
	$effect(() => {
		const update = $pinUpdates;
		if (update?.channelId === channelId && untrack(() => open)) untrack(() => void load());
	});
	// What a pin opens elsewhere (its quote's message, a link's chip or card, an invite, who reacted) closes the list, as
	// its Jump does.
	onMount(() => onOpenElsewhere(() => (open = false)));
	// A pin notice's "pinned messages" link opens the list.
	$effect(() => {
		const req = $pinsPanelRequest;
		if (req?.channelId !== channelId) return;
		pinsPanelRequest.set(null);
		open = true;
	});

	function jump(m: Message) {
		jumpToMessageRequest.set(
			conversation
				? { id: crypto.randomUUID(), spaceId: "", roomId: "", messageId: m.id, conversationId: channelId }
				: { id: crypto.randomUUID(), spaceId: space?.id ?? "", roomId: channelId, messageId: m.id },
		);
		open = false;
	}

	async function unpin(m: Message) {
		try {
			await (conversation ? unpinConversationMessage : unpinRoomMessage)(channelId, m.id);
			pins = pins.filter((p) => p.id !== m.id);
		} catch (err) {
			toast(getApiError(err, "Couldn't unpin the message"), "error");
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="hover:bg-duvet-card hover:text-duvet-ink focus-visible:outline-duvet-accent flex items-center justify-center rounded-lg p-1.5 transition-colors focus-visible:outline-2 motion-reduce:transition-none {open
			? 'bg-duvet-card text-duvet-ink'
			: 'text-duvet-ink2'}"
		title="Pinned messages"
		aria-label="Pinned messages"
	>
		<PinIcon class="size-4" />
	</Popover.Trigger>
	<Popover.Portal>
		<!-- It follows its button on every frame: opened from a focused search box, which then shrinks back and moves the
		     button, it was left behind otherwise (#80). -->
		<Popover.Content
			side="bottom"
			align="end"
			sideOffset={8}
			updatePositionStrategy="always"
			class="rounded-card border-duvet-line bg-duvet-sunk shadow-duvet-float z-50 flex max-h-[70vh] w-104 flex-col overflow-hidden border font-normal"
		>
			<div class="border-duvet-line flex h-10 shrink-0 items-center gap-2 border-b px-3">
				<PinIcon class="text-duvet-ink2 size-4" />
				<span class="text-duvet-ink text-sm font-semibold">Pinned messages</span>
			</div>
			<div class="flex flex-col gap-1.5 overflow-y-auto p-2" onclickcapture={(e) => mentionProfile.open(e)}>
				{#if failure}
					<p class="text-duvet-danger px-2 py-8 text-center text-xs">{failure}</p>
				{:else if pins.length === 0}
					<p class="text-duvet-ink2 px-2 py-8 text-center text-xs">
						{loading ? "Loading…" : `This ${conversation ? "conversation" : "room"} has no pinned messages yet`}
					</p>
				{/if}
				{#each pins as m (m.id)}
					<div
						class="group border-duvet-line bg-duvet-bg/60 relative flex shrink-0 flex-col gap-1 rounded-md border px-3 py-2"
					>
						<MessagePreview
							message={m}
							spaceId={conversation ? "" : (space?.id ?? "")}
							{channelId}
							{members}
							{mentionMap}
							{customEmojiMap}
							onPreview={openPreview}
						/>
						<div class="absolute top-1.5 right-1.5 hidden items-center gap-1 group-focus-within:flex group-hover:flex">
							<button
								class="bg-duvet-card text-duvet-ink hover:bg-duvet-ink/10 rounded px-2 py-0.5 text-xs font-medium"
								onclick={() => jump(m)}
							>
								Jump
							</button>
							{#if canPin}
								<button
									class="bg-duvet-card text-duvet-ink hover:bg-duvet-ink/10 hover:text-duvet-danger flex size-5.5 items-center justify-center rounded"
									title="Unpin message"
									aria-label="Unpin message"
									onclick={() => unpin(m)}
								>
									<XIcon class="size-3.5" />
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<ImagePreview src={previewSrc} alt={previewAlt} bind:open={previewOpen} />
<MentionProfile bind:this={mentionProfile} {members} {space} />
