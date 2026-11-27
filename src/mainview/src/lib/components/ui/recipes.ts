// The design system's recipes (#357, docs/redesign/DESIGN-MAP.md §1 and S-42 to S-47): the classes and the small sums
// the primitives in this folder share. Solid fills for controls, glass for what floats, circles for people only.

export type ButtonVariant = "primary" | "secondary" | "danger" | "warn" | "quiet";
export type ControlSize = "md" | "sm";

const BUTTON_BASE =
	"inline-flex shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap leading-none " +
	"transition-[box-shadow,transform,filter,background-color] duration-[120ms] motion-reduce:transition-none " +
	"disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none " +
	"aria-disabled:pointer-events-none aria-disabled:opacity-45 aria-disabled:shadow-none";

const BUTTON_SIZE: Record<ControlSize, string> = {
	md: "h-[34px] rounded-control px-3.5 text-[13px]",
	sm: "h-7 rounded-tile px-2.5 text-[12.5px]",
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
	warn:
		"bg-duvet-warn text-duvet-bg shadow-duvet-control hover:brightness-[1.06] " +
		"active:shadow-duvet-press active:translate-y-[0.5px]",
	quiet: "text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink active:bg-duvet-hover-strong",
};

/** A button's classes: primary (cobalt), secondary (a tinted fill), danger, or quiet (no fill until hovered). */
export function buttonClass(variant: ButtonVariant = "primary", size: ControlSize = "md"): string {
	return `${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]}`;
}

/** An icon button's classes: 30 px (26 small), idle in the second ink; `active` is the picked look; `danger` turns
 *  its hover to the destructive colour for a removal. */
export function iconButtonClass(size: ControlSize = "md", active = false, danger = false): string {
	const box = size === "sm" ? "size-[26px] rounded-lg" : "size-[30px] rounded-tile";
	const ink = danger
		? "hover:bg-duvet-danger/15! hover:text-duvet-danger!"
		: active
			? "bg-duvet-accent-tint text-duvet-accent-text"
			: "text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink active:bg-duvet-hover-strong";
	return (
		`relative inline-grid shrink-0 place-items-center transition-colors motion-reduce:transition-none duration-[120ms] ` +
		`disabled:pointer-events-none disabled:opacity-45 ${box} ${ink}`
	);
}

/** The focus mark a card, row or custom control draws when the keys reach it: the accent's line, 2 px off, with no
 *  browser outline of its own. */
export const FOCUS_RING =
	"focus-override focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-duvet-accent";

/** The same mark drawn inside the element, for a sidebar or tab row whose neighbours would clip it. */
export const FOCUS_RING_INSET =
	"focus-override focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-duvet-accent";

/** An icon's tile: the secondary fill under the accent's glyph, 30 px, 26 small, or 34 large. */
export function iconTileClass(size: "md" | "sm" | "lg" = "md", tone: "accent" | "ink" = "accent"): string {
	const box =
		size === "lg"
			? "size-[34px] rounded-tile"
			: size === "md"
				? "size-[30px] rounded-tile"
				: "size-[26px] rounded-tile";
	return `bg-duvet-secondary-fill grid shrink-0 place-items-center ${box} ${
		tone === "accent" ? "text-duvet-accent-text" : "text-duvet-ink2"
	}`;
}

/** A card's icon button, as a friend's row has beside their name: 36 px square on a raised card, its glyph turning to
 *  the destructive colour when it is a removal. */
export function cardIconButtonClass(danger = false): string {
	return (
		"bg-duvet-card text-duvet-ink2 shadow-duvet-raised relative flex size-9 shrink-0 items-center justify-center " +
		`rounded-row transition-colors motion-reduce:transition-none ${FOCUS_RING} ` +
		(danger ? "hover:text-duvet-danger" : "hover:text-duvet-ink")
	);
}

/** Glass: a tinted fill over a blur of what's behind, with its float shadow and 1 px inner edge. */
export const GLASS = "bg-duvet-glass shadow-duvet-glass backdrop-blur-[32px] backdrop-saturate-[1.8]";
/** The stronger glass of sheets and ⌘K. */
export const GLASS_STRONG = "bg-duvet-glass-strong shadow-duvet-glass backdrop-blur-[32px] backdrop-saturate-[1.8]";

/** What dims the page under a dialog, a sheet or the quick switcher. */
export const SCRIM = "bg-duvet-scrim animate-scrim-in fixed inset-0 z-[900]";

// One text field for the whole app (#357, the prototype's `.field > input`): on the card's fill, recessed (the well)
// inside a hairline, 11 px corners, 13.5 px text. Focused, the hairline turns to the accent inside a 4 px tint; a
// field marked wrong (aria-invalid) has the danger's line. Its ring is its focus mark, so it takes no global outline.
const FIELD_BASE =
	"bg-duvet-card text-duvet-ink placeholder:text-duvet-ink2 focus-override w-full rounded-control " +
	"shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-line)] " +
	"transition-shadow duration-[120ms] motion-reduce:transition-none " +
	"outline-none focus:shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-accent),0_0_0_4px_var(--duvet-accent-tint)] " +
	"aria-invalid:shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-danger)] disabled:opacity-50";

/** A text field's classes: one line (38 px, or 44 large), a smaller line for a row's own input (32 px), or `area` for
 *  several lines, which the user can't resize unless the caller says so. Sheets, dialogs, Settings and the sign-in
 *  pages all draw this one; Settings asks for the larger size. */
export function fieldClass(kind: "line" | "sm" | "area" = "line", size: "md" | "lg" = "md"): string {
	if (kind === "sm") return `${FIELD_BASE} h-8 px-2.5 text-[13px]`;
	const text = size === "lg" ? "text-[14.5px]" : "text-[13.5px]";
	if (kind === "area") return `${FIELD_BASE} ${text} resize-none px-3 py-2 leading-[1.4]`;
	return size === "lg" ? `${FIELD_BASE} h-11 px-3.5 ${text}` : `${FIELD_BASE} h-[38px] px-3 ${text}`;
}

/** A count on a row, a tab or a button (unread mentions, requests waiting): a small round badge, 18 px, or 16 px
 *  (`sm`) where the row is tight (a tab, a result, a section of Settings). On the accent unless the caller draws its
 *  own fill (`filled` false). */
export function countBadgeClass(size: "md" | "sm" = "md", filled = true): string {
	const shape = size === "md" ? "h-[18px] min-w-[18px] px-1.5" : "h-4 min-w-4 px-1";
	const fill = filled ? " bg-duvet-accent text-duvet-on-accent" : "";
	return `flex shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold tabular-nums ${shape}${fill}`;
}

/** An overline: the small uppercase label over a group of rows (a profile's About, a picker's category, a section). */
export const OVERLINE = "text-duvet-ink2 text-[10.5px] font-semibold tracking-[0.06em] uppercase";

/** A pill's classes: a small raised chip; picked, it takes the chosen fill and ink. */
export function pillClass(picked = false): string {
	const state = picked
		? "bg-duvet-chosen text-duvet-chosen-ink"
		: "bg-duvet-pill text-duvet-ink shadow-duvet-raised hover:shadow-duvet-lifted";
	return (
		`inline-flex h-7 shrink-0 items-center gap-[5px] rounded-tile px-[11px] text-[12.5px] leading-none ` +
		`font-medium whitespace-nowrap transition-shadow duration-[120ms] motion-reduce:transition-none ${state}`
	);
}

/** A menu's panel: glass, 224 to 320 wide. */
export const MENU_PANEL = `${GLASS} z-[1000] min-w-56 max-w-80 rounded-panel p-1.5 outline-none animate-float-in`;

/** A menu item's classes; the one under the pointer or the keys, and an open submenu's, take the accent tint. */
export function menuItemClass(danger = false): string {
	return (
		"flex min-h-8 w-full items-center gap-2.5 rounded-tile py-1.5 pr-2.5 pl-2 text-left text-[13px] leading-[1.2] " +
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

/**
 * The letter on a Space icon without a picture: its name's first character, in upper case.
 *
 * Upper case as the system's locale writes it, not the app's language (#464): a Space's name is its owner's own words,
 * in no language the app can know, and none of the app's languages has casing rules of its own, while the system's
 * may (Turkish writes İ for i). Graphemes don't depend on a locale.
 */
export function monogram(name: string): string {
	const [first] = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.trim())];
	return (first?.segment ?? "").toLocaleUpperCase();
}

/** Where a segmented control's thumb sits: the picked option's place, the first's when none is picked. */
export function segmentIndex<T>(values: readonly T[], picked: T | undefined): number {
	return picked === undefined ? 0 : Math.max(0, values.indexOf(picked));
}

/**
 * How far a segmented control's clipped label scrolls, and how long each way takes (#562): `words` is the width of
 * its words on one line, `box` the width its option leaves them. Words that fit, give or take half a pixel for widths
 * rounded differently, don't scroll. Those that don't travel at 30 px a second for the middle 60% of the run, resting
 * at either end for the rest, and never take under 2.5 seconds a way.
 */
export function marqueeRun(words: number, box: number): { shift: number; seconds: number } {
	const over = words - box;
	if (over <= 0.5) return { shift: 0, seconds: 0 };
	const shift = Math.ceil(over);
	return { shift, seconds: Math.max(2.5, Math.round((shift / 30 / 0.6) * 10) / 10) };
}

/**
 * A segmented control's option's tooltip (#562): its title, if any, and, while its label is clipped, the label whole
 * above it.
 */
export function segmentTitle(option: { label: string; title?: string }, clipped: boolean): string | undefined {
	if (!clipped) return option.title;
	return option.title ? `${option.label}\n${option.title}` : option.label;
}
