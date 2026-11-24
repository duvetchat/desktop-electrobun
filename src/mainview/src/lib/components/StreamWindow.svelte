<script lang="ts" module>
	// Where the window was dragged, as its distance from the app's bottom right corner, for the session: the app page
	// mounts it again on every READY.
	let kept = { right: 16, bottom: 16 };
</script>

<script lang="ts">
	import { X } from "@lucide/svelte";
	import { onDestroy, onMount } from "svelte";
	import StreamViewers from "$lib/components/StreamViewers.svelte";
	import { streamWindowBox } from "$lib/corner";
	import { chatsOnScreen } from "$lib/on-screen";
	import {
		currentUser,
		incomingVideo,
		isScreenSharing,
		voiceLocalVideoStream,
		voiceRemoteVideoStreams,
		watchedStreams,
		watchingNow,
	} from "$lib/stores.svelte";
	import { startMediaBridge } from "$lib/media-popout.svelte";
	import { openVoicePlaceWith } from "$lib/media-source";
	import { stopScreenShare } from "$lib/voice";
	import { currentVoicePlace, type VoicePlace } from "$lib/voice-place";
	import { stopWatching, streamToShow, viewersOf } from "$lib/watching";

	// A stream the user shares or watches, while the view of its room or call isn't on screen (desktop#299): their own
	// screen first, else the last one they opened. A click goes back to the view, a drag moves it, and its ✕ stops it.
	let { onOpen }: { onOpen: (place: VoicePlace) => void } = $props();

	// The app page's way of opening a voice room's view or a call's chat is given to this window, which is there as long
	// as the app is: it hands it on to the call panel's first line, and to the pop-out's (lib/media-source.ts).
	// The media controls' pop-out needs the same life: the main window's side of it starts and stops here, so the
	// controls can pop out whether or not the sidebar shows (lib/media-popout.svelte.ts).
	onMount(() => {
		openVoicePlaceWith(onOpen);
		const stopBridge = startMediaBridge();
		return () => {
			stopBridge();
			openVoicePlaceWith(null);
		};
	});

	const WIDTH = 320;
	const HEIGHT = 180;
	// A press that moves farther than this is a drag, not a click.
	const CLICK_SLOP = 4;

	const place = $derived($currentVoicePlace);
	const shown = $derived.by(() => {
		if (!place || $chatsOnScreen.has(place.id)) return null;
		const available = new Set(
			$incomingVideo
				? place.states.filter((s) => s.screen_sharing && $voiceRemoteVideoStreams[s.user_id]).map((s) => s.user_id)
				: [],
		);
		return streamToShow($isScreenSharing && !!$voiceLocalVideoStream, $watchedStreams, available);
	});
	const stream = $derived(
		!shown ? null : shown.own ? $voiceLocalVideoStream : ($voiceRemoteVideoStreams[shown.userId] ?? null),
	);
	const sharerId = $derived(!shown ? null : shown.own ? ($currentUser?.id ?? null) : shown.userId);
	const title = $derived(
		!shown || !place ? "" : shown.own ? "Your screen" : `${place.person(shown.userId).name}'s screen`,
	);
	const viewers = $derived.by(() => {
		if (!place || !sharerId) return [];
		const me = $currentUser ? { id: $currentUser.id, watching: $watchingNow } : null;
		return viewersOf(sharerId, place.states, me).map((id) => place.person(id));
	});

	let viewWidth = $state(0);
	let viewHeight = $state(0);
	let spot = $state.raw(kept);
	// Inside the app's window, which can shrink after a drag.
	const right = $derived(clamp(spot.right, viewWidth - WIDTH));
	const bottom = $derived(clamp(spot.bottom, viewHeight - HEIGHT));

	function clamp(value: number, max: number): number {
		return Math.min(Math.max(value, 0), Math.max(max, 0));
	}

	// Where it is while it shows, so a call card goes right above it when it covers the card's place (lib/corner.ts).
	$effect(() => {
		streamWindowBox.set(shown && place ? { right, bottom, width: WIDTH, height: HEIGHT } : null);
	});
	onDestroy(() => streamWindowBox.set(null));

	let video = $state<HTMLVideoElement | null>(null);
	$effect(() => {
		if (video && video.srcObject !== stream) video.srcObject = stream;
	});

	let drag: { pointer: number; x: number; y: number; right: number; bottom: number; moved: boolean } | null = null;

	function onpointerdown(e: PointerEvent) {
		if (e.button !== 0 || (e.target as Element).closest("button")) return;
		drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY, right, bottom, moved: false };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onpointermove(e: PointerEvent) {
		if (!drag || drag.pointer !== e.pointerId) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) <= CLICK_SLOP) return;
		drag.moved = true;
		spot = kept = {
			right: clamp(drag.right - dx, viewWidth - WIDTH),
			bottom: clamp(drag.bottom - dy, viewHeight - HEIGHT),
		};
	}

	function onpointerup(e: PointerEvent) {
		if (!drag || drag.pointer !== e.pointerId) return;
		const clicked = !drag.moved;
		drag = null;
		if (clicked && place) onOpen(place);
	}

	function onpointercancel() {
		drag = null;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ") || !place) return;
		e.preventDefault();
		onOpen(place);
	}

	// Your own screen stops being shared; someone else's stops being watched, at once.
	function stop() {
		if (!shown || !place) return;
		if (shown.own) stopScreenShare(place.id);
		else stopWatching(shown.userId);
	}
</script>

<svelte:window bind:innerWidth={viewWidth} bind:innerHeight={viewHeight} />

{#if shown && place}
	<div
		role="button"
		tabindex="0"
		aria-label={`${title} in ${place.name}`}
		class="group bg-duvet-stage shadow-duvet-float inset-ring-fixed-white/8 fixed z-40 h-45 w-80 cursor-pointer touch-none overflow-hidden rounded-2xl inset-ring-1 select-none"
		style="right: {right}px; bottom: {bottom}px;"
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		{onpointercancel}
		{onkeydown}
	>
		<video bind:this={video} autoplay muted playsinline class="pointer-events-none size-full object-contain"></video>
		<div
			class="absolute inset-x-0 top-0 flex items-center gap-1.5 p-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
		>
			<StreamViewers {viewers} meId={$currentUser?.id} />
			<span
				class="bg-duvet-media-scrim text-duvet-media-ink min-w-0 truncate rounded-[10px] px-2.5 py-[5px] text-xs leading-[1.2] font-semibold backdrop-blur-[14px]"
				>{title}</span
			>
			<span class="flex-1"></span>
			<button
				type="button"
				aria-label={shown.own ? "Stop sharing" : "Stop watching"}
				title={shown.own ? "Stop sharing" : "Stop watching"}
				class="bg-duvet-media-scrim text-duvet-media-ink hover:bg-duvet-call-red hover:text-fixed-white rounded-tile grid size-[26px] shrink-0 place-items-center backdrop-blur-[14px] transition-colors motion-reduce:transition-none"
				onclick={stop}
			>
				<X size={14} />
			</button>
		</div>
	</div>
{/if}
