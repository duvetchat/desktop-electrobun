// Prism (#357, mobile's widgets/prism.dart): the light a mention of the user throws on its bubble. Three soft lights:
// the main one sits on the mention, and the two side lights slide to the right as the bubble moves up the list. Their
// places are CSS variables on the bubble (--mx, --my, --ps, --cx, --wx), which its classes read.

type Box = { left: number; top: number; width: number; height: number };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The lights' scale for a bubble's width: full size from 270 px, never under four tenths. */
export function prismScale(bubbleWidth: number): number {
	return clamp(bubbleWidth / 270, 0.4, 1);
}

/** How far the side lights have slid: 0 with the bubble at the list's bottom, 1 at its top. */
export function prismSlide(bubbleCentreY: number, listTop: number, listHeight: number): number {
	if (listHeight <= 0) return 0;
	return 1 - clamp((bubbleCentreY - listTop) / listHeight, 0, 1);
}

/** Where the cool and the warm light sit along the bubble, in px from its left. */
export function prismSides(slide: number, scale: number): { cx: number; wx: number } {
	return { cx: (70 + slide * 150) * scale, wx: (30 + slide * 90) * scale };
}

/** The main light's centre within the bubble: the mention's, or a place near the text's start when there's none (a
 * reply that pinged the user names nobody in its text). */
export function mentionCentre(bubble: Box, mention: Box | null): { mx: number; my: number } {
	if (!mention) return { mx: 40, my: 20 };
	return {
		mx: mention.left - bubble.left + mention.width / 2,
		my: mention.top - bubble.top + mention.height / 2,
	};
}

const px = (value: number) => `${Math.round(value * 10) / 10}px`;

/** Sets a Prism bubble's side lights for where it is in its list. Called as the bubble is placed and as the list scrolls. */
export function slidePrism(bubble: HTMLElement, list: HTMLElement): void {
	const box = bubble.getBoundingClientRect();
	const view = list.getBoundingClientRect();
	const scale = prismScale(box.width);
	const { cx, wx } = prismSides(prismSlide(box.top + box.height / 2, view.top, view.height), scale);
	bubble.style.setProperty("--cx", px(cx));
	bubble.style.setProperty("--wx", px(wx));
}

/** Places all of a Prism bubble's lights: the main one on the mention of userId, and the side lights (slidePrism). */
export function placePrism(bubble: HTMLElement, list: HTMLElement, userId: string): void {
	const box = bubble.getBoundingClientRect();
	const mention = bubble.querySelector<HTMLElement>(`.msg-mention[data-user-id="${CSS.escape(userId)}"]`);
	const { mx, my } = mentionCentre(box, mention?.getBoundingClientRect() ?? null);
	bubble.style.setProperty("--mx", px(mx));
	bubble.style.setProperty("--my", px(my));
	bubble.style.setProperty("--ps", String(Math.round(prismScale(box.width) * 100) / 100));
	slidePrism(bubble, list);
}

// The classes that draw it. Tailwind reads them here, so each class is whole in one string. The bubble holds the light
// and the rim as its first children, under its text.

/** A Prism bubble's own classes, over a bubble's: the card's fill, with the violet shadow under it. The names in it
 * are read on the light where it is strongest, so they take the violet that holds there (--duvet-mention-lit). */
export const PRISM_BUBBLE =
	"bg-duvet-card text-duvet-ink isolate shadow-[var(--duvet-shadow-raised),var(--duvet-prism-shadow)] [--mention-ink:var(--duvet-mention-lit)]";

/** The three lights, which fade in after the bubble. */
export const PRISM_LIGHT = [
	"animate-prism-arrive pointer-events-none absolute inset-0 -z-10 rounded-[inherit]",
	"bg-[radial-gradient(calc(170px*var(--ps,1))_calc(80px*var(--ps,1))_at_var(--mx,40px)_var(--my,20px),var(--duvet-prism-gem),transparent),radial-gradient(calc(120px*var(--ps,1))_calc(50px*var(--ps,1))_at_var(--cx,140px)_70%,var(--duvet-prism-cool),transparent),radial-gradient(calc(90px*var(--ps,1))_calc(40px*var(--ps,1))_at_var(--wx,70px)_100%,var(--duvet-prism-warm),transparent)]",
].join(" ");

/** The rim: a 1 px edge that runs from violet to blue, cut out of a gradient with a mask. The cut ("exclude") is part
 * of the mask shorthand itself: as a class of its own it came before the shorthand in the stylesheet, which reset it,
 * and the whole gradient showed across the bubble instead of its edge. */
export const PRISM_RIM = [
	"pointer-events-none absolute inset-0 -z-10 rounded-[inherit] p-px",
	"bg-[linear-gradient(135deg,var(--duvet-rim-0)_0%,var(--duvet-rim-1)_42%,var(--duvet-rim-2)_70%,var(--duvet-rim-3)_100%)]",
	"[mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]",
].join(" ");

/** A flat row that mentions the user: the light as a wash behind the row, with no rim and nothing that moves. */
export const PRISM_WASH =
	"[--mention-ink:var(--duvet-mention-lit)] bg-[radial-gradient(420px_80px_at_60px_50%,var(--duvet-prism-gem),transparent),radial-gradient(260px_60px_at_220px_80%,var(--duvet-prism-cool),transparent)]";
