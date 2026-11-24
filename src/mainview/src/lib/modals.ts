import { t } from "$lib/i18n";
import { ComponentType, type Component, type Modal } from "$lib/types";

/** A modal field's value: a text, what a select or a checkbox group chose, a radio group's choice, or a checkbox's state. */
export type ModalValue = string | string[] | boolean | null;

/** A modal component as its submit sends it (interactions.Answer in the API): a label with its input and what was entered. */
export interface ModalAnswer {
	type: number;
	id?: number;
	custom_id?: string;
	value?: string | boolean | null;
	values?: string[];
	component?: ModalAnswer;
}

const maxText = 4000;

/** Each label of a modal with the input it holds. */
export function modalInputs(modal: Modal): { label: Component; input: Component }[] {
	return modal.components.flatMap((c) =>
		c.type === ComponentType.Label && c.component?.custom_id ? [{ label: c, input: c.component }] : [],
	);
}

/** Whether an input must be answered: unless it says otherwise. A checkbox always has a value. */
export const isRequired = (input: Component) => input.type !== ComponentType.Checkbox && input.required !== false;

// How many a select or a checkbox group chooses: 1 and 1 unless it says, or for a group 1 and all its options.
function bounds(input: Component): { min: number; max: number } {
	const max = input.type === ComponentType.CheckboxGroup ? (input.options?.length ?? 1) : 1;
	return { min: input.min_values ?? 1, max: input.max_values ?? max };
}

/** What each input starts with, by custom_id: a text input's value, the choices that are default, a checkbox's state. */
export function initialValues(modal: Modal): Record<string, ModalValue> {
	const values: Record<string, ModalValue> = {};
	for (const { input } of modalInputs(modal)) {
		const id = input.custom_id!;
		switch (input.type) {
			case ComponentType.TextInput:
				values[id] = input.value ?? "";
				break;
			case ComponentType.RadioGroup:
				values[id] = input.options?.find((o) => o.default)?.value ?? null;
				break;
			case ComponentType.Checkbox:
				values[id] = !!input.default;
				break;
			case ComponentType.StringSelect:
			case ComponentType.CheckboxGroup:
				values[id] = (input.options ?? []).filter((o) => o.default).map((o) => o.value);
				break;
			default:
				values[id] = (input.default_values ?? []).map((d) => d.id);
		}
	}
	return values;
}

// Why an input's value can't be sent, as the API checks it, or null.
function problemOf(input: Component, value: ModalValue): string | null {
	switch (input.type) {
		case ComponentType.Checkbox:
			return null;
		case ComponentType.TextInput: {
			// In characters, as the API counts them: an emoji of two UTF-16 units is one.
			const length = [...(typeof value === "string" ? value : "")].length;
			const min = input.min_length ?? 0;
			const max = input.max_length ?? maxText;
			if (length === 0) return isRequired(input) ? t("dialog_field_required") : null;
			if (length < min) return t("dialog_field_too_short", { min });
			if (length > max) return t("dialog_field_too_long", { max });
			return null;
		}
		case ComponentType.RadioGroup:
			return value === null && isRequired(input) ? t("dialog_field_required") : null;
		default: {
			const count = Array.isArray(value) ? value.length : 0;
			if (count === 0) return isRequired(input) ? t("dialog_field_required") : null;
			const { min, max } = bounds(input);
			if (count >= min && count <= max) return null;
			return min === max
				? t("dialog_field_choose_count", { count: min })
				: t("dialog_field_choose_range", { min, max });
		}
	}
}

/**
 * The components a modal's submit sends from its fields (each label with its input and what was entered), or the
 * problem of each field that breaks the input's rules, by custom_id, as the API checks them.
 */
export function modalAnswers(
	modal: Modal,
	values: Record<string, ModalValue | undefined>,
): { components: ModalAnswer[] } | { problems: Record<string, string> } {
	const components: ModalAnswer[] = [];
	const problems: Record<string, string> = {};
	for (const { label, input } of modalInputs(modal)) {
		const id = input.custom_id!;
		const value = values[id] ?? null;
		const problem = problemOf(input, value);
		if (problem) {
			problems[id] = problem;
			continue;
		}
		const answer: ModalAnswer = { type: input.type, id: input.id, custom_id: id };
		switch (input.type) {
			case ComponentType.TextInput:
				answer.value = typeof value === "string" ? value : "";
				break;
			case ComponentType.RadioGroup:
				answer.value = typeof value === "string" ? value : null;
				break;
			case ComponentType.Checkbox:
				answer.value = value === true;
				break;
			default:
				answer.values = Array.isArray(value) ? value : [];
		}
		components.push({ type: ComponentType.Label, id: label.id, component: answer });
	}
	return Object.keys(problems).length ? { problems } : { components };
}
