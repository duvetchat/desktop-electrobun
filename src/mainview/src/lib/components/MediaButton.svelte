<script lang="ts">
	import type { Snippet } from "svelte";
	import { mergeProps } from "bits-ui";
	import Tooltip from "$lib/components/ui/Tooltip.svelte";

	// A media control: the microphone, deafen, the camera, a screen share, Leave. Mobile's VoiceButton
	// (mobile/lib/voice_room.dart) at the desktop's size: a rounded square (circles are for people) on a solid fill,
	// sunk into ink while it is on, and Leave filled with the destructive colour. It always has a tooltip, which says
	// what a press does, or why it does nothing.
	let {
		label,
		tip = label,
		keys = undefined,
		pressed = undefined,
		stateInName = false,
		tone = "plain",
		shape = "panel",
		disabled = false,
		onclick = undefined,
		triggerProps = {},
		side = "top",
		class: className = "",
		children,
	}: {
		/** Its name for a screen reader: what a press does ("Mute", "Unmute"). */
		label: string;
		/** The tooltip, when it says more than the label (why it's disabled, a setting's state). */
		tip?: string;
		/** Its shortcut, already written for this system. */
		keys?: string;
		/** For a switch: whether it is on. Left out for a plain button. */
		pressed?: boolean;
		/** The label already says the state, as it changes with it ("Mute" then "Unmute"): the button is then drawn
		 * pressed but not announced as pressed, which would say the state twice ("Unmute, pressed"). */
		stateInName?: boolean;
		/** leave is the destructive fill; the stage tones are for the dark call stage, whatever the theme; quiet is the
		 * sidebar's own bar: no fill until hovered or pressed. */
		tone?: "plain" | "quiet" | "leave" | "stage" | "stage-leave";
		/** panel: 30 tall, as wide as its place (the sidebar's block). square: 30 × 30. bar: 44 × 38 (a voice room's
		 * bar). stage: 42 × 36 (a call's). */
		shape?: "panel" | "square" | "bar" | "stage";
		/** It stays focusable and keeps its tooltip, which says why; a press does nothing. */
		disabled?: boolean;
		onclick?: (event: MouseEvent) => void;
		/** What a Menu, a ContextMenu or a Popover hands its opener. */
		triggerProps?: Record<string, unknown>;
		side?: "top" | "bottom" | "left" | "right";
		class?: string;
		children: Snippet;
	} = $props();

	const SHAPES = {
		panel: "h-[30px] w-full min-w-0 rounded-[10px]",
		square: "size-[30px] shrink-0 rounded-[10px]",
		bar: "h-[38px] w-11 shrink-0 rounded-xl",
		stage: "h-9 w-[42px] shrink-0 rounded-xl",
	};
	// Leave is wider than its neighbours in a bar: the one press that ends something.
	const wide = $derived(tone === "leave" && shape === "bar" ? "w-[54px]" : tone === "stage-leave" ? "w-[52px]" : "");

	// A filled control darkens evenly on hover, whatever its fill: an inset shadow of the hover ink.
	const look = $derived.by(() => {
		if (tone === "leave") return "bg-duvet-danger text-duvet-on-danger hover:brightness-[1.06]";
		if (tone === "stage-leave") return "bg-duvet-call-red text-fixed-white hover:brightness-[1.08]";
		if (tone === "stage") {
			return pressed
				? "bg-duvet-media-ink text-duvet-stage"
				: "bg-fixed-white/14 text-duvet-media-ink hover:bg-fixed-white/22";
		}
		if (tone === "quiet") {
			return pressed
				? "bg-duvet-ink text-duvet-bg shadow-duvet-press"
				: "text-duvet-ink2 hover:bg-duvet-sb-hover hover:text-duvet-ink";
		}
		return pressed
			? "bg-duvet-ink text-duvet-bg shadow-duvet-press"
			: "bg-duvet-secondary-fill text-duvet-ink hover:shadow-[inset_0_0_0_100px_var(--duvet-hover)]";
	});

	function press(event: MouseEvent) {
		if (disabled) {
			// Nor does it open a menu it is the opener of.
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		onclick?.(event);
	}
</script>

<Tooltip text={tip} {keys} {side}>
	{#snippet trigger(props)}
		<button
			{...mergeProps({ onclick: press }, triggerProps, props)}
			type="button"
			aria-label={label}
			aria-pressed={stateInName ? undefined : pressed}
			aria-disabled={disabled || undefined}
			class=" inline-grid place-items-center transition-[box-shadow,background-color,color,filter] duration-[120ms] motion-reduce:transition-none {SHAPES[
				shape
			]} {wide} {look} {disabled ? 'cursor-not-allowed opacity-45' : ''} {className}"
		>
			{@render children()}
		</button>
	{/snippet}
</Tooltip>
