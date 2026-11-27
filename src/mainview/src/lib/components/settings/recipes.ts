// The Settings screens' recipes (#357, docs/redesign/DESIGN-MAP.md S-47): the classes and the small sums Settings, a
// Space's settings and a room's share. The primitives' own are in components/ui/recipes.ts.
import type { Component } from "svelte";
import { fieldClass, iconTileClass } from "$lib/components/ui/recipes";
import { t } from "$lib/i18n";
import { formatNumber } from "$lib/i18n/format";

/** A section of a settings screen, as its side panel lists it. */
export interface SettingsNavItem<Section extends string = string> {
	id: Section;
	label: string;
	icon: Component<{ size?: number | string; class?: string }>;
	/** Its tile's colour: any CSS colour. */
	tile: string;
	/** A number on its right (invites waiting), when above 0. */
	count?: number;
}

/** The side panel's sections, in groups; a group may have a title. */
export interface SettingsNavGroup<Section extends string = string> {
	title?: string;
	items: SettingsNavItem<Section>[];
}

/** The groups with only the sections whose label has what's typed in the side panel's search; all of them for nothing
 * typed. A group left empty goes. */
export function filterNav<Section extends string>(
	groups: readonly SettingsNavGroup<Section>[],
	query: string,
): SettingsNavGroup<Section>[] {
	const wanted = query.trim().toLocaleLowerCase();
	return groups
		.map((group) => ({
			...group,
			items: wanted ? group.items.filter((item) => item.label.toLocaleLowerCase().includes(wanted)) : group.items,
		}))
		.filter((group) => group.items.length > 0);
}

/** A section's label, for the toolbar's title. */
export function navLabel<Section extends string>(
	groups: readonly SettingsNavGroup<Section>[],
	id: Section,
): string | undefined {
	for (const group of groups) for (const item of group.items) if (item.id === id) return item.label;
	return undefined;
}

/** A side panel's item, at rest, picked or dangerous (the way out). */
const NAV_ITEM =
	"flex h-10 w-full shrink-0 items-center gap-2.5 rounded-tile px-2.5 text-left text-[14px] font-medium " +
	"transition-colors duration-[120ms] motion-reduce:transition-none";

export function navItemClass(picked = false, danger = false): string {
	const state = danger
		? "text-duvet-danger hover:bg-duvet-danger/10"
		: picked
			? "bg-duvet-accent-tint text-duvet-ink"
			: "text-duvet-ink hover:bg-duvet-sb-hover";
	return `${NAV_ITEM} ${state}`;
}

/** A section's 28 px tile, in its own colour behind a white glyph. */
export const NAV_TILE = "text-fixed-white grid size-[28px] shrink-0 place-items-center rounded-tile";
/** The slot of an icon in the side panel's foot, which has no tile. */
export const NAV_ICON_SLOT = "grid size-[28px] shrink-0 place-items-center";

/** A text field: the app's one (lib/components/ui/recipes.ts), 44 tall for Settings. */
export const FIELD = fieldClass("line", "lg");
/** A smaller field, for a row's own input (a name edited in place). */
export const FIELD_SM = fieldClass("sm");
/** A text area: at least 110 tall, in the face people write in. */
export const FIELD_AREA = `${fieldClass("area", "lg")} font-content min-h-[110px] leading-[1.5]`;
/** A field that is wrong: the danger ring, focused or not. */
export const FIELD_WRONG = "ring-duvet-danger ring-2 focus-visible:ring-duvet-danger";

/** A select: 36 tall, on the secondary fill. */
export const SELECT =
	"bg-duvet-secondary-fill text-duvet-ink h-9 max-w-56 rounded-tile pr-8 pl-3 text-[13.5px] font-medium " +
	"outline-none focus-visible:ring-duvet-accent focus-visible:ring-2 focus-override";

/** A card: what a group's rows sit in. */
export const CARD = "bg-duvet-card shadow-duvet-raised overflow-hidden rounded-card";
/** A bar that appears over a settings page while something waits: a move, or unsaved changes. */
export const ACTION_BAR =
	"bg-duvet-card shadow-duvet-lifted mx-8 mb-4 flex items-center justify-between gap-4 rounded-card " +
	"py-3 pr-3 pl-5 text-[14px] font-medium";
/** A row's own classes: its words and control in one line, or a control stacked under them. */
const ROW = "flex min-h-[60px] gap-x-4 gap-y-2.5 px-4 py-3";

export function rowClass(stacked = false): string {
	return `${ROW} ${stacked ? "flex-col justify-center" : "items-center"}`;
}

/** A row's icon tile: 34 px, the secondary fill under the accent's glyph. */
export const ROW_TILE = iconTileClass("lg");
/** A group's title, over its card. */
export const GROUP_TITLE = "text-duvet-ink2 px-2 text-[12px] font-semibold tracking-[0.06em] uppercase";
/** A note under a card, or a section's opening line. */
export const NOTE = "text-duvet-ink2 px-2 text-[13px] leading-[1.5] hyphens-auto";
/** A field's label in a form. */
export const LABEL = "text-duvet-ink2 mb-2 block text-[14px] font-medium";
/** A tag on a row: ACTIVE, Admin, hoisted. On one line and whole beside a name that's cut: a language may write it in
 *  two words (Finnish's Ei käytössä) (#562). */
export const TAG = "shrink-0 rounded-md px-2 py-1 text-[11px] leading-none font-semibold whitespace-nowrap";
/** A loading row's placeholder. */
export const SKELETON = "bg-duvet-secondary-fill animate-pulse rounded-row";
/** A checkbox, as the browser draws it in the accent. */
export const CHECKBOX = "accent-duvet-accent size-[18px] shrink-0 rounded";

export type CalloutTone = "info" | "warn" | "good" | "danger";

const CALLOUT_TONE: Record<CalloutTone, string> = {
	info: "bg-duvet-secondary-fill text-duvet-ink",
	warn: "bg-duvet-warn/10 text-duvet-warn",
	good: "bg-duvet-alive/10 text-duvet-alive-text",
	danger: "bg-duvet-danger/10 text-duvet-danger",
};

/** A callout: a line that needs seeing, tinted by what it says. */
export function calloutClass(tone: CalloutTone = "info"): string {
	return `flex gap-3 rounded-row px-3.5 py-3 text-[13.5px] leading-[1.5] ${CALLOUT_TONE[tone]}`;
}

/** How full a storage is, in percent of its limit: 0 to 100, whole. */
export function usagePercent(used: number, limit: number): number {
	if (!(limit > 0)) return 0;
	return Math.min(Math.max(Math.round((used / limit) * 100), 0), 100);
}

/** A usage bar's fill: azure under 20%, green to 60%, amber to 90%, red beyond. */
export function usageTone(percent: number): string {
	return percent > 90
		? "bg-duvet-danger"
		: percent >= 60
			? "bg-duvet-warn"
			: percent >= 20
				? "bg-duvet-alive"
				: "bg-duvet-azure";
}

const oneDecimal: Intl.NumberFormatOptions = { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false };

/** A file's size as the settings' lists write it: B, KB or MB, to a decimal, in the app's language's digits and units
 * (lib/i18n/format.ts's, whose megabytes have two decimals). */
export function listFileSize(bytes: number): string {
	if (bytes < 1024) return t("format_size_bytes", { size: formatNumber(bytes, { useGrouping: false }) });
	if (bytes < 1024 * 1024) return t("format_size_kb", { size: formatNumber(bytes / 1024, oneDecimal) });
	return t("format_size_mb", { size: formatNumber(bytes / (1024 * 1024), oneDecimal) });
}

/** A role colour as a hex string, from the number the API keeps; the accent's violet for none. */
export function roleHex(color: number | null | undefined): string {
	if (color === null || color === undefined) return "#7b83f5";
	return `#${(color >>> 0).toString(16).padStart(6, "0")}`;
}

/** A role's colour as CSS: none is the second ink, one stop a solid, two or three a gradient. */
export function roleBackground(role: {
	color_from: number | null | undefined;
	color_via: number | null | undefined;
	color_to: number | null | undefined;
}): string {
	if (role.color_from === null || role.color_from === undefined) return "var(--duvet-ink2)";
	const from = roleHex(role.color_from);
	if (role.color_to === null || role.color_to === undefined) return from;
	const to = roleHex(role.color_to);
	if (role.color_via !== null && role.color_via !== undefined) {
		return `linear-gradient(90deg, ${from}, ${roleHex(role.color_via)}, ${to})`;
	}
	return `linear-gradient(90deg, ${from}, ${to})`;
}
