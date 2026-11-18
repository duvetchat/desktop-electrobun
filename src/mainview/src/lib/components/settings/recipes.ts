// The Settings screens' recipes (#357, docs/redesign/DESIGN-MAP.md S-47): the classes and the small sums Settings, a
// Space's settings and a room's share. The primitives' own are in components/ui/recipes.ts.
import type { Component } from "svelte";

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

const FIELD_BASE =
	"bg-duvet-card text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-well ring-duvet-line w-full rounded-[11px] " +
	"text-[13.5px] ring-1 transition-shadow duration-[120ms] outline-none motion-reduce:transition-none " +
	"focus-visible:ring-duvet-accent focus-visible:ring-2 disabled:opacity-50 focus-override";

/** A text field: 38 tall, on the card's fill with a well and a hairline; focused, the accent's ring. */
export const FIELD = `${FIELD_BASE} h-[38px] px-3`;
/** A smaller field, for a row's own input (a name edited in place). */
export const FIELD_SM = `${FIELD_BASE} h-8 px-2.5`;
/** A text area: at least 84 tall, in the face people write in. */
export const FIELD_AREA = `${FIELD_BASE} font-content min-h-[84px] resize-none px-3 py-2 leading-[1.45]`;
/** A field that is wrong: the danger ring, focused or not. */
export const FIELD_WRONG = "ring-duvet-danger ring-2 focus-visible:ring-duvet-danger";

/** A select: 30 tall, on the secondary fill. */
export const SELECT =
	"bg-duvet-secondary-fill text-duvet-ink h-[30px] max-w-48 rounded-[9px] pr-7 pl-2.5 text-[12.5px] font-medium " +
	"outline-none focus-visible:ring-duvet-accent focus-visible:ring-2 focus-override";

/** A card: what a group's rows sit in. */
export const CARD = "bg-duvet-card shadow-duvet-raised overflow-hidden rounded-2xl";
/** A group's title, over its card. */
export const GROUP_TITLE = "text-duvet-ink2 px-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase";
/** A note under a card, or a section's opening line. */
export const NOTE = "text-duvet-ink2 px-1.5 text-xs leading-[1.45]";
/** A field's label in a form. */
export const LABEL = "text-duvet-ink2 mb-1.5 block text-[13px] font-medium";
/** A tag on a row: ACTIVE, Admin, hoisted. */
export const TAG = "rounded-md px-1.5 py-0.5 text-[10px] leading-none font-semibold";
/** A loading row's placeholder. */
export const SKELETON = "bg-duvet-secondary-fill animate-pulse rounded-xl";
/** A checkbox, as the browser draws it in the accent. */
export const CHECKBOX = "accent-duvet-accent size-4 shrink-0 rounded";

export type CalloutTone = "info" | "warn" | "good" | "danger";

const CALLOUT_TONE: Record<CalloutTone, string> = {
	info: "bg-duvet-secondary-fill text-duvet-ink",
	warn: "bg-duvet-warn/10 text-duvet-warn",
	good: "bg-duvet-alive/10 text-duvet-alive",
	danger: "bg-duvet-danger/10 text-duvet-danger",
};

/** A callout: a line that needs seeing, tinted by what it says. */
export function calloutClass(tone: CalloutTone = "info"): string {
	return `flex gap-3 rounded-xl px-3 py-2.5 text-[12.5px] leading-[1.45] ${CALLOUT_TONE[tone]}`;
}

/** How full a storage is, in percent of its limit: 0 to 100, whole. */
export function usagePercent(used: number, limit: number): number {
	if (!(limit > 0)) return 0;
	return Math.min(Math.max(Math.round((used / limit) * 100), 0), 100);
}

/** A usage bar's fill: amber past 70%, red past 90%. */
export function usageTone(percent: number): string {
	return percent > 90 ? "bg-duvet-danger" : percent > 70 ? "bg-duvet-warn" : "bg-duvet-ink2";
}

/** A file's size as the settings' lists write it: B, KB or MB, to a decimal. */
export function listFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
