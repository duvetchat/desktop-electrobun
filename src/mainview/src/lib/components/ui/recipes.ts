// The design system's recipes (#357, docs/redesign/DESIGN-MAP.md §1 and S-42 to S-47): the classes and the small sums
// the primitives in this folder share. Solid fills for controls, glass for what floats, circles for people only.

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export type ControlSize = "md" | "sm";

const BUTTON_BASE =
	"inline-flex shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap leading-none " +
	"transition-[box-shadow,transform,filter,background-color] duration-[120ms] motion-reduce:transition-none " +
	"disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none " +
	"aria-disabled:pointer-events-none aria-disabled:opacity-45 aria-disabled:shadow-none";

const BUTTON_SIZE: Record<ControlSize, string> = {
	md: "h-[34px] rounded-[11px] px-3.5 text-[13px]",
	sm: "h-7 rounded-[9px] px-2.5 text-[12.5px]",
};

// A filled control darkens evenly on hover, whatever its fill: an inset shadow of the hover ink.
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
	primary:
		"bg-duvet-accent text-duvet-on-accent shadow-duvet-control hover:brightness-[1.06] " +
		"active:shadow-duvet-press active:translate-y-[0.5px]",
	secondary:
		"bg-duvet-secondary-fill text-duvet-accent-text hover:shadow-[inset_0_0_0_100px_var(--duvet-hover)] " +
		"active:shadow-duvet-press",
	danger:
		"bg-duvet-danger text-duvet-on-danger shadow-duvet-control hover:brightness-[1.06] " +
		"active:shadow-duvet-press active:translate-y-[0.5px]",
	quiet: "text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink active:bg-duvet-hover-strong",
};

/** A button's classes: primary (cobalt), secondary (a tinted fill), danger, or quiet (no fill until hovered). */
export function buttonClass(variant: ButtonVariant = "primary", size: ControlSize = "md"): string {
	return `${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]}`;
}

/** An icon button's classes: 30 px (26 small), idle in the second ink; `active` is the picked look. */
export function iconButtonClass(size: ControlSize = "md", active = false): string {
	const box = size === "sm" ? "size-[26px] rounded-lg" : "size-[30px] rounded-[9px]";
	const ink = active
		? "bg-duvet-accent-tint text-duvet-accent-text"
		: "text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink active:bg-duvet-hover-strong";
	return (
		`relative inline-grid shrink-0 place-items-center transition-colors duration-[120ms] ` +
		`motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-45 ${box} ${ink}`
	);
}

/** Glass: a tinted fill over a blur of what's behind, with its float shadow and 1 px inner edge. */
export const GLASS = "bg-duvet-glass shadow-duvet-glass backdrop-blur-[32px] backdrop-saturate-[1.8]";
/** The stronger glass of sheets and ⌘K. */
export const GLASS_STRONG = "bg-duvet-glass-strong shadow-duvet-glass backdrop-blur-[32px] backdrop-saturate-[1.8]";

/** A pill's classes: a small raised chip; picked, it takes the chosen fill and ink. */
export function pillClass(picked = false): string {
	const state = picked
		? "bg-duvet-chosen text-duvet-chosen-ink"
		: "bg-duvet-pill text-duvet-ink shadow-duvet-raised hover:shadow-duvet-lifted";
	return (
		`inline-flex h-7 shrink-0 items-center gap-[5px] rounded-[9px] px-[11px] text-[12.5px] leading-none ` +
		`font-medium whitespace-nowrap transition-shadow duration-[120ms] motion-reduce:transition-none ${state}`
	);
}

/** A menu's panel: glass, 224 to 320 wide. */
export const MENU_PANEL = `${GLASS} z-[1000] min-w-56 max-w-80 rounded-[14px] p-1.5 outline-none animate-float-in`;

/** A menu item's classes; the one under the pointer or the keys, and an open submenu's, take the accent tint. */
export function menuItemClass(danger = false): string {
	return (
		"flex min-h-8 w-full items-center gap-2.5 rounded-[9px] py-1.5 pr-2.5 pl-2 text-left text-[13px] leading-[1.2] " +
		"font-medium outline-none select-none data-highlighted:bg-duvet-accent-tint data-[state=open]:bg-duvet-accent-tint " +
		"data-disabled:pointer-events-none data-disabled:opacity-45 " +
		(danger ? "text-duvet-danger" : "text-duvet-ink")
	);
}

/** A presence dot's diameter for an avatar's size: three tenths of it, 8 px at least. */
export function presenceSize(avatar: number): number {
	return Math.max(8, Math.round(avatar * 0.3));
}

/** A Space icon's corner radius for its size: a rounded square, never a circle. */
export function spaceIconRadius(size: number): number {
	return Math.round(size * 0.27);
}

/** The size of the letter on a Space icon without a picture. */
export function monogramSize(size: number): number {
	return Math.round(size * 0.46);
}

/** The letter on a Space icon without a picture: its name's first character, in upper case. */
export function monogram(name: string): string {
	const [first] = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.trim())];
	return (first?.segment ?? "").toLocaleUpperCase();
}

/** Where a segmented control's thumb sits: the picked option's place, the first's when none is picked. */
export function segmentIndex<T>(values: readonly T[], picked: T | undefined): number {
	return picked === undefined ? 0 : Math.max(0, values.indexOf(picked));
}
