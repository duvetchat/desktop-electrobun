import type { CommandUse } from "$lib/api/interactions";
import { t } from "$lib/i18n";
import { formatNumber } from "$lib/i18n/format";
import { CommandOptionType, type ApplicationCommand, type CommandOption, type SpaceCommands } from "$lib/types";

/**
 * Something the "/" menu offers to run: a command, or for one with subcommands, each of them, in its group when it's
 * in one. name is what runs, the command's name then its group's and its subcommand's, apart by spaces
 * ("perms user get"), and options are what it takes: the command's, or the subcommand's.
 */
export interface CommandEntry {
	command: ApplicationCommand;
	group?: CommandOption;
	subcommand?: CommandOption;
	name: string;
	description: string;
	options: CommandOption[];
}

const isSubcommand = (o: CommandOption) => o.type === CommandOptionType.Subcommand;
const isGroup = (o: CommandOption) => o.type === CommandOptionType.SubcommandGroup;

/**
 * What command can run: the command itself, or when its options are subcommands and groups of them (the API lets a
 * command have only those, or none), each subcommand, in the order the command has them.
 */
export function commandEntries(command: ApplicationCommand): CommandEntry[] {
	if (!command.options.some((o) => isSubcommand(o) || isGroup(o))) {
		return [{ command, name: command.name, description: command.description, options: command.options }];
	}
	const entry = (subcommand: CommandOption, group?: CommandOption): CommandEntry => ({
		command,
		group,
		subcommand,
		name: [command.name, group?.name, subcommand.name].filter(Boolean).join(" "),
		description: subcommand.description,
		options: subcommand.options ?? [],
	});
	return command.options.flatMap((o) =>
		isSubcommand(o) ? [entry(o)] : isGroup(o) ? (o.options ?? []).filter(isSubcommand).map((s) => entry(s, o)) : [],
	);
}

/**
 * What the "/" menu offers for what follows the slash: what the space's commands run (commandEntries) whose name
 * starts with it, in order. A command without subcommands is one entry, its name.
 */
export function matchingCommands(list: SpaceCommands, query: string): CommandEntry[] {
	const prefix = query.toLowerCase();
	return list.commands.flatMap(commandEntries).filter((e) => e.name.startsWith(prefix));
}

/**
 * What follows the slash while the whole message names something to run, for the "/" menu, or null when it doesn't:
 * "/" and a word, or, for a command of list with subcommands (the space's commands, once they came), its name and
 * then up to two more words for its group and its subcommand ("/perms user g"). Text after any other command's name
 * is a message, as it was before subcommands, and so is a line break after any: the message box reads none the user
 * didn't type (lib/message-box.ts).
 */
export function commandQuery(raw: string, list: SpaceCommands | null): string | null {
	const name = /^\/(\S*)$/u.exec(raw);
	if (name) return name[1]!;
	const path = /^\/(\S+)((?: \S*){1,2})$/u.exec(raw);
	const command = path && list?.commands.find((c) => c.name === path[1]!.toLowerCase());
	return command && command.options.some((o) => isSubcommand(o) || isGroup(o)) ? path[1]! + path[2]! : null;
}

/**
 * What Enter picks for a command's name typed before the space's commands came: once they do, the first that
 * matches, as the menu would have offered it, or null when none does or they don't come, and the text goes as a
 * message.
 */
export async function commandOnceListed(list: Promise<SpaceCommands>, query: string): Promise<CommandEntry | null> {
	try {
		return matchingCommands(await list, query)[0] ?? null;
	} catch {
		return null; // the menu, which asked for the list, logs why it failed
	}
}

/** A command option's field: its text, a choice's value, a member's, role's or room's ID, or a switch's state. */
export type FieldValue = string | number | boolean;

/** An option as a command's use sends it: one with its value, or a subcommand or a group with what it runs. */
export interface UsedOption {
	name: string;
	type: number;
	value?: FieldValue;
	options?: UsedOption[];
}

// The number in an integer or number option's text, within what the API takes (an integer within
// ±(2^53 - 1), a number within ±2^53), or null.
function parseNumber(o: CommandOption, text: string): number | null {
	const trimmed = text.trim();
	const n = trimmed === "" ? NaN : Number(trimmed);
	if (o.type === CommandOptionType.Integer) return /^-?\d+$/.test(trimmed) && Number.isSafeInteger(n) ? n : null;
	return Number.isFinite(n) && Math.abs(n) <= 2 ** 53 ? n : null;
}

// A bound of a number option, in the locale's digits, as the bot gave it: every decimal it has.
const bound = (n: number) => formatNumber(n, { maximumFractionDigits: 20 });

// What o's field sends, or why it can't be sent, as a whole sentence that names it. A choice's value is the command's
// own.
function check(o: CommandOption, v: FieldValue): { value: FieldValue } | { problem: string } {
	const option = o.name;
	if (typeof v !== "string" || o.choices?.length) return { value: v };
	if (o.type === CommandOptionType.Integer || o.type === CommandOptionType.Number) {
		const n = parseNumber(o, v);
		if (n === null)
			return {
				problem:
					o.type === CommandOptionType.Integer
						? t("chat_command_option_integer", { option })
						: t("chat_command_option_number", { option }),
			};
		if (o.min_value !== undefined && n < o.min_value)
			return { problem: t("chat_command_option_min", { option, min: bound(o.min_value) }) };
		if (o.max_value !== undefined && n > o.max_value)
			return { problem: t("chat_command_option_max", { option, max: bound(o.max_value) }) };
		return { value: n };
	}
	if (o.type === CommandOptionType.String) {
		const length = [...v].length;
		const max = o.max_length ?? 6000;
		if (o.min_length !== undefined && length < o.min_length)
			return { problem: t("chat_command_option_min_length", { option, count: o.min_length }) };
		if (length > max) return { problem: t("chat_command_option_max_length", { option, count: max }) };
	}
	return { value: v };
}

/**
 * The options a use of what entry runs sends from its fields, or the first rule a field breaks, as the API checks
 * them: the required ones given (a switch is false until it's turned on), a text's length in characters, and a
 * number's kind and bounds. An empty field gives nothing. The fields are a map by option name: an option may be
 * named constructor or __proto__, which a plain object would read from its prototype.
 */
export function usedOptions(
	entry: CommandEntry,
	fields: ReadonlyMap<string, FieldValue>,
): { options: UsedOption[] } | { problem: string } {
	const options: UsedOption[] = [];
	for (const o of entry.options) {
		const v = fields.get(o.name) ?? (o.type === CommandOptionType.Boolean && o.required ? false : undefined);
		// An empty text field gives nothing, but a choice whose value is "" was picked.
		if (v === undefined || (v === "" && !o.choices?.length)) {
			if (o.required) return { problem: t("chat_command_option_required", { option: o.name }) };
			continue;
		}
		const checked = check(o, v);
		if ("problem" in checked) return checked;
		options.push({ name: o.name, type: o.type, value: checked.value });
	}
	return { options };
}

/**
 * The use of what entry runs with options, its used options, as the API takes it: a subcommand's options under it,
 * and the subcommand under its group when it's in one.
 */
export function commandUse(entry: CommandEntry, options: UsedOption[]): CommandUse {
	let used = options;
	if (entry.subcommand) used = [{ name: entry.subcommand.name, type: CommandOptionType.Subcommand, options: used }];
	if (entry.group) used = [{ name: entry.group.name, type: CommandOptionType.SubcommandGroup, options: used }];
	return { id: entry.command.id, name: entry.command.name, type: 1, options: used };
}
