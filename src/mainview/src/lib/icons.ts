import type { IconNode } from "@lucide/svelte";

// The app's icons are Lucide's (@lucide/svelte), under the design's glyph names (docs/redesign/DESIGN-MAP.md §3).
// Mobile draws them from Lucide 1.70.0 (lucide_icons_flutter 4.0.3), and three of its glyphs differ from the ones the
// installed @lucide/svelte has: the faces' eyes are short dashes over a wider mouth, and the circle's tick is larger.
// These are 1.70.0's drawings (ISC, © Lucide Icons and Contributors), which components/ui/icons draw with Lucide's
// own Icon, so the desktop matches mobile. icons.test.ts says when the installed package has caught up and they can go.

/** `smile`: Space settings' "Emojis and stickers". */
export const smile: IconNode = [
	["path", { d: "M15 10V9" }],
	["path", { d: "M16.472 15a6 6 0 01-8.943 0" }],
	["path", { d: "M9 10V9" }],
	["circle", { cx: "12", cy: "12", r: "10" }],
];

/** `smile-plus`: Add reaction, the composer's emoji button. */
export const smilePlus: IconNode = [
	["path", { d: "M13.267 2.08a10 10 0 108.653 8.653" }],
	["path", { d: "M15 10V9" }],
	["path", { d: "M16 5h6" }],
	["path", { d: "M16.472 15a6 6 0 01-8.943 0" }],
	["path", { d: "M19 2v6" }],
	["path", { d: "M9 10V9" }],
];

/** `circle-check`: a passing check on a card. */
export const circleCheck: IconNode = [
	["circle", { cx: "12", cy: "12", r: "10" }],
	["path", { d: "m16 9-5.5 5.5L8 12" }],
];

/**
 * The glyphs to take from components/ui/icons rather than from @lucide/svelte, by the package's export names. `Text`
 * is here for another reason: the package keeps it only as a deprecated alias, and the design's `text` glyph is
 * `TextAlignStart`.
 */
export const NOT_FROM_THE_PACKAGE: Record<string, string> = {
	Smile: "$lib/components/ui/icons/Smile.svelte",
	SmilePlus: "$lib/components/ui/icons/SmilePlus.svelte",
	CircleCheck: "$lib/components/ui/icons/CircleCheck.svelte",
	Text: "TextAlignStart, from @lucide/svelte",
};
