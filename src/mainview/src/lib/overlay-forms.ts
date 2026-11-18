// What the fields of a sheet or a dialog share (#357, docs/redesign/DESIGN-MAP.md S-44 to S-46): a field on the card's
// fill, recessed, 38 px tall with 11 px corners, ringed in the accent while it has the focus; its label over it; the
// line under it that says what's wrong; and the spinner of a button whose action is on its way.

const FIELD_BASE =
	"bg-duvet-card text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-well focus-override w-full rounded-[11px] " +
	"px-3 text-[13.5px] outline-none transition-shadow duration-[120ms] motion-reduce:transition-none " +
	"focus:shadow-[0_0_0_4px_var(--duvet-accent-tint),0_0_0_1px_var(--duvet-accent)] disabled:opacity-45";

/** A field's classes: one line (38 px), or `area` for several lines, which the user can't resize unless the caller
 *  says so. */
export function fieldClass(kind: "line" | "area" = "line"): string {
	return kind === "line" ? `${FIELD_BASE} h-[38px]` : `${FIELD_BASE} resize-none py-2 leading-[1.4]`;
}

/** A field's label, over it. */
export const FIELD_LABEL = "text-duvet-ink2 text-xs font-medium";

/** What's wrong with a field or a form, under it. */
export const FIELD_ERROR = "text-duvet-danger text-xs leading-[1.35]";

/** A failure that isn't a field's: a tinted block in the dialog. */
export const ERROR_NOTE = "bg-duvet-danger/10 text-duvet-danger rounded-[11px] px-3 py-2 text-[13px] leading-[1.35]";

/** A spinner in the ink of what holds it: a button's, or a panel's while it loads (`lg`). */
export function spinnerClass(size: "sm" | "lg" = "sm"): string {
	return `${size === "sm" ? "size-3.5" : "size-6"} shrink-0 animate-spin rounded-full border-2 border-current/25 border-t-current`;
}

/** The label of a button whose action is on its way: the action's name and an ellipsis, as the app writes work in
 *  progress ("Delete…"). */
export function busyLabel(label: string): string {
	return `${label.replace(/(\.{3}|…)$/, "")}…`;
}
