import { CommandOptionType, type ApplicationCommand, type CommandOption, type SpaceCommands } from "$lib/types";

/** The space's commands the "/" menu offers for what follows the slash: those whose name starts with it, in order. */
export function matchingCommands(list: SpaceCommands, query: string): ApplicationCommand[] {
	const prefix = query.toLowerCase();
	return list.commands.filter((c) => c.name.startsWith(prefix));
}

/**
 * What Enter picks for a command's name typed before the space's commands came: once they do, the first that
 * matches, as the menu would have offered it, or null when none does or they don't come, and the text goes as a
 * message.
 */
export async function commandOnceListed(
	list: Promise<SpaceCommands>,
	query: string,
): Promise<ApplicationCommand | null> {
	try {
		return matchingCommands(await list, query)[0] ?? null;
	} catch {
		return null; // the menu, which asked for the list, logs why it failed
	}
}

/** A command option's field: its text, a choice's value, a member's, role's or room's ID, or a switch's state. */
export type FieldValue = string | number | boolean;

/** An option as a command's use sends it. */
export interface UsedOption {
	name: string;
	type: number;
	value: FieldValue;
}

// The number in an integer or number option's text, within what the API takes (an integer within
// ±(2^53 - 1), a number within ±2^53), or null.
function parseNumber(o: CommandOption, text: string): number | null {
	const t = text.trim();
	const n = t === "" ? NaN : Number(t);
	if (o.type === CommandOptionType.Integer) return /^-?\d+$/.test(t) && Number.isSafeInteger(n) ? n : null;
	return Number.isFinite(n) && Math.abs(n) <= 2 ** 53 ? n : null;
}

// What o's field sends, or why it can't be sent. A choice's value is the command's own.
function check(o: CommandOption, v: FieldValue): { value: FieldValue } | { problem: string } {
	if (typeof v !== "string" || o.choices?.length) return { value: v };
	if (o.type === CommandOptionType.Integer || o.type === CommandOptionType.Number) {
		const n = parseNumber(o, v);
		if (n === null)
			return { problem: o.type === CommandOptionType.Integer ? "must be an integer" : "must be a number" };
		if (o.min_value !== undefined && n < o.min_value) return { problem: `must be at least ${o.min_value}` };
		if (o.max_value !== undefined && n > o.max_value) return { problem: `must be at most ${o.max_value}` };
		return { value: n };
	}
	if (o.type === CommandOptionType.String) {
		const length = [...v].length;
		const max = o.max_length ?? 6000;
		if (o.min_length !== undefined && length < o.min_length)
			return { problem: `takes ${o.min_length} characters at least` };
		if (length > max) return { problem: `takes ${max} characters at most` };
	}
	return { value: v };
}

/**
 * The options a use of the command sends from its fields, or the first rule a field breaks, as the API checks
 * them: the required ones given (a switch is false until it's turned on), a text's length in characters, and a
 * number's kind and bounds. An empty field gives nothing. The fields are a map by option name: an option may be
 * named constructor or __proto__, which a plain object would read from its prototype.
 */
export function usedOptions(
	command: ApplicationCommand,
	fields: ReadonlyMap<string, FieldValue>,
): { options: UsedOption[] } | { problem: string } {
	const options: UsedOption[] = [];
	for (const o of command.options) {
		const v = fields.get(o.name) ?? (o.type === CommandOptionType.Boolean && o.required ? false : undefined);
		// An empty text field gives nothing, but a choice whose value is "" was picked.
		if (v === undefined || (v === "" && !o.choices?.length)) {
			if (o.required) return { problem: `${o.name} is required` };
			continue;
		}
		const checked = check(o, v);
		if ("problem" in checked) return { problem: `${o.name} ${checked.problem}` };
		options.push({ name: o.name, type: o.type, value: checked.value });
	}
	return { options };
}
