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

/** What the lights need of a bubble, and of the list it is in. */
export interface Boxed {
	getBoundingClientRect(): Box;
}
export interface Lit extends Boxed {
	querySelector(selector: string): Boxed | null;
	style: { setProperty(name: string, value: string): unknown };
}

const sidesIn = (box: Box, view: Box) =>
	prismSides(prismSlide(box.top + box.height / 2, view.top, view.height), prismScale(box.width));

// Both of these read every box first and write afterwards: a write between two reads makes the browser work the
// page's styles and layout out again for each bubble.

/**
 * Sets the side lights of the Prism bubbles in the list's view for where each is in it. Called as the list scrolls,
 * once a frame. A bubble outside the view is left alone: its lights are set as it scrolls in.
 */
export function slidePrismsIn(bubbles: Iterable<Lit>, list: Boxed): void {
	const view = list.getBoundingClientRect();
	const moves: { bubble: Lit; cx: number; wx: number }[] = [];
	for (const bubble of bubbles) {
		const box = bubble.getBoundingClientRect();
		if (box.top + box.height < view.top || box.top > view.top + view.height) continue;
		moves.push({ bubble, ...sidesIn(box, view) });
	}
	for (const { bubble, cx, wx } of moves) {
		bubble.style.setProperty("--cx", px(cx));
		bubble.style.setProperty("--wx", px(wx));
	}
}

/**
 * Places all the lights of each Prism bubble, given with the id of the user its text mentions: the main one on that
 * mention, and the side lights. Called as a bubble is laid out and when its size changes, in view or not.
 */
export function placePrismsIn(bubbles: Iterable<readonly [Lit, string]>, list: Boxed): void {
	const view = list.getBoundingClientRect();
	const places: { bubble: Lit; mx: number; my: number; ps: number; cx: number; wx: number }[] = [];
	for (const [bubble, userId] of bubbles) {
		const box = bubble.getBoundingClientRect();
		const mention = bubble.querySelector(`.msg-mention[data-user-id="${CSS.escape(userId)}"]`);
		places.push({
			bubble,
			...mentionCentre(box, mention?.getBoundingClientRect() ?? null),
			ps: Math.round(prismScale(box.width) * 100) / 100,
			...sidesIn(box, view),
		});
	}
	for (const { bubble, mx, my, ps, cx, wx } of places) {
		bubble.style.setProperty("--mx", px(mx));
		bubble.style.setProperty("--my", px(my));
		bubble.style.setProperty("--ps", String(ps));
		bubble.style.setProperty("--cx", px(cx));
		bubble.style.setProperty("--wx", px(wx));
	}
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
