<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
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
		everyEmoji,
	} from "$lib/stores.svelte";
	import { gatewayMessageToMessage } from "$lib/types";
	import type { GatewaySpace, MemberOnSidebar, Message } from "$lib/types";
	import { hasPermission, Permission } from "$lib/permissions";
	import { mentionMapOf, sameNames } from "$lib/markdown";
	import { GLASS, iconButtonClass } from "$lib/components/ui/recipes";

	// The pin button of a pane's bar (or a conversation's header), and the list of its pinned messages, the
	// last pinned first. A message jumps to itself; who can pin unpins it from here too.
	let {
		space = null,
		channelId,
		conversation = false,
		members = [],
		toDirectMessage,
	}: {
		/** The channel's space. A conversation's list passes conversation instead. */
		space?: GatewaySpace | null;
		/** The room's or the conversation's ID. */
		channelId: string;
		conversation?: boolean;
		members?: MemberOnSidebar[];
		/** How a conversation's pins become messages. */
		toDirectMessage?: (m: DirectMessage) => Message | null;
	} = $props();

	let open = $state(false);
	let loading = $state(false);
	let failure = $state<string | null>(null);
	let roomPins = $state.raw<Message[]>([]);
	// A conversation's pins as the API lists them: they become messages as they draw, so the text this device's
	// database holds of each shows once it's read (toDirectMessage).
	let conversationPins = $state.raw<DirectMessage[]>([]);
	// A pin the conversation doesn't draw (#575) isn't listed.
	const pins = $derived(
		conversation && toDirectMessage ? conversationPins.flatMap((pin) => toDirectMessage(pin) ?? []) : roomPins,
	);
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
	// Every emoji of the user's Spaces: one they don't have draws from the API's /emojis.
	const customEmojiMap = $derived($everyEmoji);
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
				conversationPins = await getConversationPins(channelId, ctl.signal);
			} else {
				const rows = await getRoomPins(channelId, ctl.signal);
				roomPins = rows.map((m) => gatewayMessageToMessage(m, $gatewaySpaces));
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
			if (conversation) conversationPins = conversationPins.filter((p) => p.id !== m.id);
			else roomPins = roomPins.filter((p) => p.id !== m.id);
		} catch (err) {
			toast(getApiError(err, "Couldn't unpin the message"), "error");
		}
	}

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger class={iconButtonClass("md", open)} title="Pinned messages" aria-label="Pinned messages">
		<PinIcon size={16} />
	</Popover.Trigger>
	<Popover.Portal>
		<!-- It follows its button on every frame: opened from a focused search box, which then shrinks back and moves the
		     button, it was left behind otherwise (#80). -->
		{#if layer}
			<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
			<div class="fixed top-0 left-0" style={layerStyle(layer)}>
				<Popover.Content
					side="bottom"
					align="end"
					sideOffset={8}
					collisionPadding={10}
					updatePositionStrategy="always"
					role="dialog"
					aria-label="Pinned messages"
					class="{GLASS} animate-float-in text-duvet-ink z-[1000] flex max-h-[min(560px,72vh)] w-[min(360px,calc(100vw-20px))] origin-(--bits-floating-transform-origin) flex-col overflow-hidden rounded-[20px] font-normal outline-none"
				>
					<div class="flex shrink-0 items-baseline gap-2 px-4 pt-3.5 pb-1.5">
						<span class="text-duvet-ink text-[13.5px] font-semibold">Pinned messages</span>
						{#if pins.length > 0}
							<span class="text-duvet-ink2 text-xs">{pins.length}</span>
						{/if}
					</div>
					<div class="flex flex-col gap-0.5 overflow-y-auto px-1.5 pb-2" onclickcapture={(e) => mentionProfile.open(e)}>
						{#if failure}
							<p class="text-duvet-danger px-2 py-8 text-center text-xs">{failure}</p>
						{:else if pins.length === 0}
							<p class="text-duvet-ink2 px-2 py-8 text-center text-xs">
								{loading ? "Loading…" : `This ${conversation ? "chat" : "room"} has no pinned messages yet`}
							</p>
						{/if}
						{#each pins as m (m.id)}
							<div
								class="group hover:bg-duvet-hover focus-within:bg-duvet-hover relative flex shrink-0 flex-col gap-1 rounded-xl p-2 transition-colors motion-reduce:transition-none"
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
								<div
									class="absolute top-1.5 right-1.5 hidden items-center gap-1 group-focus-within:flex group-hover:flex"
								>
									<button
										class="bg-duvet-card text-duvet-accent-text shadow-duvet-raised hover:shadow-duvet-lifted rounded-chip h-[22px] px-2 text-[11.5px] font-medium"
										onclick={() => jump(m)}
									>
										Jump
									</button>
									{#if canPin}
										<button
											class="bg-duvet-card text-duvet-ink2 shadow-duvet-raised hover:text-duvet-danger rounded-chip grid size-[22px] place-items-center"
											title="Unpin message"
											aria-label="Unpin message"
											onclick={() => unpin(m)}
										>
											<XIcon size={14} />
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</Popover.Content>
			</div>
		{/if}
	</Popover.Portal>
</Popover.Root>

<ImagePreview src={previewSrc} alt={previewAlt} bind:open={previewOpen} />
<MentionProfile bind:this={mentionProfile} {members} {space} />
