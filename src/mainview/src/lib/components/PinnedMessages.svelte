<script lang="ts">
	import { Pin as PinIcon, X as XIcon } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import { untrack } from "svelte";
	import MentionProfile from "$lib/components/MentionProfile.svelte";
	import MessagePreview from "$lib/components/MessagePreview.svelte";
	import ImagePreview from "$lib/components/ImagePreview.svelte";
	import { getRoomPins, unpinRoomMessage } from "$lib/api/messages";
	import { getConversationPins, unpinConversationMessage, type DirectMessage } from "$lib/api/conversations";
	import { getApiError } from "$lib/api/api";
	import { toast } from "$lib/stores/toast.svelte";
	import { gatewaySpaces, jumpToMessageRequest, pinUpdates, pinsPanelRequest } from "$lib/stores.svelte";
	import { gatewayMessageToMessage } from "$lib/types";
	import type { GatewaySpace, MemberOnSidebar, Message, SpaceEmoji } from "$lib/types";
	import { hasPermission, Permission } from "$lib/permissions";
	import { customEmojiMapOf, mentionMapOf } from "$lib/markdown";

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
	let pins = $state<Message[]>([]);
	let controller: AbortController | null = null;

	// In a space, those with PinMessages in the room (its owner and Administrators have it); in a
	// conversation, every member.
	const canPin = $derived.by(() => {
		if (conversation) return true;
		const s = space;
		const room = s?.rooms.find((r) => r.id === channelId);
		return !!s && !!room && hasPermission(s, room, Permission.PinMessages);
	});
	const mentionMap = $derived(mentionMapOf(members));
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
			class="z-50 flex max-h-[70vh] w-104 flex-col overflow-hidden rounded-lg border border-stone-800 bg-stone-950 font-normal shadow-2xl"
		>
			<div class="flex h-10 shrink-0 items-center gap-2 border-b border-stone-800 px-3">
				<PinIcon class="size-4 text-stone-400" />
				<span class="text-sm font-semibold text-stone-100">Pinned messages</span>
			</div>
			<div class="flex flex-col gap-1.5 overflow-y-auto p-2" onclickcapture={(e) => mentionProfile.open(e)}>
				{#if failure}
					<p class="px-2 py-8 text-center text-xs text-red-400">{failure}</p>
				{:else if pins.length === 0}
					<p class="px-2 py-8 text-center text-xs text-stone-500">
						{loading ? "Loading…" : `This ${conversation ? "conversation" : "channel"} has no pinned messages yet`}
					</p>
				{/if}
				{#each pins as m (m.id)}
					<div
						class="group relative flex shrink-0 flex-col gap-1 rounded-md border border-stone-800/80 bg-stone-900/60 px-3 py-2"
					>
						<MessagePreview message={m} {mentionMap} {customEmojiMap} onPreview={openPreview} />
						<div class="absolute top-1.5 right-1.5 hidden items-center gap-1 group-focus-within:flex group-hover:flex">
							<button
								class="rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-stone-200 hover:bg-stone-700"
								onclick={() => jump(m)}
							>
								Jump
							</button>
							{#if canPin}
								<button
									class="flex size-5.5 items-center justify-center rounded bg-stone-800 text-stone-300 hover:bg-stone-700 hover:text-red-400"
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
