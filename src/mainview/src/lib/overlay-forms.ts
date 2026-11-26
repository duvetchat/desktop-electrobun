import { fieldClass } from "$lib/components/ui/recipes";
import { t } from "$lib/i18n";

// What the fields of a sheet or a dialog share (#357, docs/redesign/DESIGN-MAP.md S-44 to S-46): the app's text field
// (lib/components/ui/recipes.ts); its label over it; the line under it that says what's wrong; and the spinner of a
// button whose action is on its way.

/** A field's classes: the app's one text field (lib/components/ui/recipes.ts). */
export { fieldClass };

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
 *  progress ("Delete…"), in the app's language. */
export function busyLabel(label: string): string {
	return t("dialog_busy_label", { action: label.replace(/(\.{3}|…)$/, "") });
}
