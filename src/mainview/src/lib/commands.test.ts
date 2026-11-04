import { describe, expect, test } from "bun:test";
import {
	commandEntries,
	commandOnceListed,
	commandQuery,
	commandUse,
	matchingCommands,
	usedOptions,
	type FieldValue,
	type CommandEntry,
} from "$lib/commands";
import { CommandOptionType as T, type ApplicationCommand, type CommandOption, type SpaceCommands } from "$lib/types";

const command = (...options: CommandOption[]): ApplicationCommand => ({
	id: "c1",
	type: 1,
	application_id: "a1",
	name: "roll",
	description: "Rolls dice",
	options,
	version: "2026-10-20T00:00:00Z",
});

// What a command without subcommands runs: itself.
const entryOf = (c: ApplicationCommand) => commandEntries(c)[0];

// The fields of a command row, by option name.
const fields = (values: Record<string, FieldValue>) => new Map(Object.entries(values));

describe("usedOptions", () => {
	test("sends the options given in the command's order, integers and numbers as numbers", () => {
		const cmd = command(
			{ type: T.Integer, name: "sides", description: "d", required: true },
			{ type: T.Number, name: "bonus", description: "d" },
			{ type: T.String, name: "note", description: "d" },
			{ type: T.Boolean, name: "secret", description: "d" },
			{ type: T.User, name: "for", description: "d" },
		);
		expect(
			usedOptions(entryOf(cmd), fields({ for: "u1", note: "", sides: " 20 ", bonus: "1.5", secret: true })),
		).toEqual({
			options: [
				{ name: "sides", type: T.Integer, value: 20 },
				{ name: "bonus", type: T.Number, value: 1.5 },
				{ name: "secret", type: T.Boolean, value: true },
				{ name: "for", type: T.User, value: "u1" },
			],
		});
	});

	test("asks for the required ones", () => {
		const cmd = command({ type: T.String, name: "text", description: "d", required: true });
		expect(usedOptions(entryOf(cmd), fields({}))).toEqual({ problem: "text is required" });
		expect(usedOptions(entryOf(cmd), fields({ text: "" }))).toEqual({ problem: "text is required" });
	});

	test("a required switch is false until it's turned on", () => {
		const cmd = command({ type: T.Boolean, name: "on", description: "d", required: true });
		expect(usedOptions(entryOf(cmd), fields({}))).toEqual({ options: [{ name: "on", type: T.Boolean, value: false }] });
	});

	test("checks integers", () => {
		const cmd = command({ type: T.Integer, name: "n", description: "d", min_value: 2, max_value: 100 });
		expect(usedOptions(entryOf(cmd), fields({ n: "2.5" }))).toEqual({ problem: "n must be an integer" });
		expect(usedOptions(entryOf(cmd), fields({ n: "1e3" }))).toEqual({ problem: "n must be an integer" });
		expect(usedOptions(entryOf(cmd), fields({ n: "1" }))).toEqual({ problem: "n must be at least 2" });
		expect(usedOptions(entryOf(cmd), fields({ n: "101" }))).toEqual({ problem: "n must be at most 100" });
		const unbounded = command({ type: T.Integer, name: "n", description: "d" });
		expect(usedOptions(entryOf(unbounded), fields({ n: "9007199254740992" }))).toEqual({
			problem: "n must be an integer",
		});
		expect(usedOptions(entryOf(unbounded), fields({ n: "-9007199254740991" }))).toEqual({
			options: [{ name: "n", type: T.Integer, value: -9007199254740991 }],
		});
	});

	test("checks numbers", () => {
		const cmd = command({ type: T.Number, name: "x", description: "d", min_value: -1.5 });
		expect(usedOptions(entryOf(cmd), fields({ x: "abc" }))).toEqual({ problem: "x must be a number" });
		expect(usedOptions(entryOf(cmd), fields({ x: "-2" }))).toEqual({ problem: "x must be at least -1.5" });
		expect(usedOptions(entryOf(cmd), fields({ x: "1e3" }))).toEqual({
			options: [{ name: "x", type: T.Number, value: 1000 }],
		});
		expect(usedOptions(entryOf(cmd), fields({ x: "1e300" }))).toEqual({ problem: "x must be a number" });
	});

	test("counts a text's characters, not its UTF-16 units", () => {
		const cmd = command({ type: T.String, name: "t", description: "d", min_length: 2, max_length: 3 });
		expect(usedOptions(entryOf(cmd), fields({ t: "😀😀😀" }))).toEqual({
			options: [{ name: "t", type: T.String, value: "😀😀😀" }],
		});
		expect(usedOptions(entryOf(cmd), fields({ t: "😀" }))).toEqual({ problem: "t takes 2 characters at least" });
		expect(usedOptions(entryOf(cmd), fields({ t: "abcd" }))).toEqual({ problem: "t takes 3 characters at most" });
		const unbounded = command({ type: T.String, name: "t", description: "d" });
		expect(usedOptions(entryOf(unbounded), fields({ t: "a".repeat(6001) }))).toEqual({
			problem: "t takes 6000 characters at most",
		});
	});

	test("a choice's empty string is a value, not an empty field", () => {
		const cmd = command({
			type: T.String,
			name: "pick",
			description: "d",
			required: true,
			choices: [
				{ name: "None", value: "" },
				{ name: "A", value: "a" },
			],
		});
		expect(usedOptions(entryOf(cmd), fields({ pick: "" }))).toEqual({
			options: [{ name: "pick", type: T.String, value: "" }],
		});
		expect(usedOptions(entryOf(cmd), fields({}))).toEqual({ problem: "pick is required" });
	});

	test("sends a choice's value as the command has it", () => {
		const cmd = command({
			type: T.Integer,
			name: "times",
			description: "d",
			choices: [
				{ name: "Once", value: 1 },
				{ name: "Twice", value: 2 },
			],
		});
		expect(usedOptions(entryOf(cmd), fields({ times: 2 }))).toEqual({
			options: [{ name: "times", type: T.Integer, value: 2 }],
		});
	});

	test("an option named as an object's built-in properties is a field like any other", () => {
		const cmd = command(
			{ type: T.String, name: "constructor", description: "d", required: true },
			{ type: T.String, name: "__proto__", description: "d" },
		);
		expect(usedOptions(entryOf(cmd), new Map())).toEqual({ problem: "constructor is required" });
		expect(
			usedOptions(
				entryOf(cmd),
				new Map([
					["constructor", "a"],
					["__proto__", "b"],
				]),
			),
		).toEqual({
			options: [
				{ name: "constructor", type: T.String, value: "a" },
				{ name: "__proto__", type: T.String, value: "b" },
			],
		});
	});
});

const named = (name: string): ApplicationCommand => ({ ...command(), id: name, name });
const space: SpaceCommands = { applications: [], commands: [named("ping"), named("poll"), named("roll")] };

describe("matchingCommands", () => {
	test("offers the commands whose name starts with what follows the slash, in order", () => {
		expect(matchingCommands(space, "p").map((e) => e.name)).toEqual(["ping", "poll"]);
		expect(matchingCommands(space, "PO").map((e) => e.name)).toEqual(["poll"]);
		expect(matchingCommands(space, "").map((e) => e.name)).toEqual(["ping", "poll", "roll"]);
		expect(matchingCommands(space, "x")).toEqual([]);
	});
});

describe("commandOnceListed", () => {
	test("waits for the list, then gives the first match", async () => {
		let deliver!: (list: SpaceCommands) => void;
		const list = new Promise<SpaceCommands>((resolve) => (deliver = resolve));
		let picked: CommandEntry | null | undefined;
		const done = commandOnceListed(list, "p").then((c) => (picked = c));
		await Bun.sleep(10);
		expect(picked).toBeUndefined(); // nothing yet: the list hasn't come
		deliver(space);
		await done;
		expect(picked?.name).toBe("ping");
		expect(picked?.command.id).toBe("ping");
	});

	test("gives null when nothing matches, or the list doesn't come: the text goes as a message", async () => {
		expect(await commandOnceListed(Promise.resolve(space), "zzz")).toBeNull();
		expect(await commandOnceListed(Promise.reject(new Error("offline")), "p")).toBeNull();
	});
});

// A command with subcommands, one of them in a group, as the API lists it (api#163).
const perms: ApplicationCommand = {
	...command(),
	id: "perms",
	name: "perms",
	description: "Permissions",
	options: [
		{
			type: T.SubcommandGroup,
			name: "user",
			description: "A member's",
			options: [
				{
					type: T.Subcommand,
					name: "get",
					description: "Shows a member's",
					options: [{ type: T.User, name: "who", description: "d", required: true }],
				},
				{ type: T.Subcommand, name: "reset", description: "Resets a member's" },
			],
		},
		{
			type: T.Subcommand,
			name: "list",
			description: "Lists them",
			options: [{ type: T.Integer, name: "page", description: "d", min_value: 1 }],
		},
	],
};
const withSubcommands: SpaceCommands = { applications: [], commands: [named("ping"), perms, named("poll")] };

describe("commandEntries", () => {
	test("offers a command without subcommands as itself, with its options", () => {
		const roll = command({ type: T.Integer, name: "sides", description: "d" });
		expect(commandEntries(roll)).toEqual([
			{ command: roll, name: "roll", description: "Rolls dice", options: roll.options },
		]);
	});

	test("offers each subcommand a command has, by its whole name, with its own options", () => {
		const entries = commandEntries(perms);
		expect(entries.map((e) => [e.name, e.description, e.options.map((o) => o.name)])).toEqual([
			["perms user get", "Shows a member's", ["who"]],
			["perms user reset", "Resets a member's", []],
			["perms list", "Lists them", ["page"]],
		]);
		expect(entries[0].group?.name).toBe("user");
		expect(entries[0].subcommand?.name).toBe("get");
		expect(entries[2].group).toBeUndefined();
	});
});

describe("matchingCommands with subcommands", () => {
	test("offers each path that runs, for the command's name or for its words so far", () => {
		expect(matchingCommands(withSubcommands, "p").map((e) => e.name)).toEqual([
			"ping",
			"perms user get",
			"perms user reset",
			"perms list",
			"poll",
		]);
		expect(matchingCommands(withSubcommands, "perms u").map((e) => e.name)).toEqual([
			"perms user get",
			"perms user reset",
		]);
		expect(matchingCommands(withSubcommands, "perms user get").map((e) => e.name)).toEqual(["perms user get"]);
		expect(matchingCommands(withSubcommands, "perms user get x")).toEqual([]);
	});
});

describe("commandQuery", () => {
	test("is the command's name typed after the slash, the list there or not, as before subcommands", () => {
		expect(commandQuery("/", null)).toBe("");
		expect(commandQuery("/pi", null)).toBe("pi");
		expect(commandQuery("/ping\n", withSubcommands)).toBe("ping");
	});

	test("is no command for what a message says after a command's name, or for a message", () => {
		for (const raw of ["/ping hello", "/poll a b", "/shrug :smile", "hello", " /ping", "/ping  x", "/ping\nx"]) {
			expect(commandQuery(raw, withSubcommands)).toBeNull();
		}
	});

	test("takes the words of a command with subcommands, once the space's commands came", () => {
		expect(commandQuery("/perms ", withSubcommands)).toBe("perms ");
		expect(commandQuery("/perms user g", withSubcommands)).toBe("perms user g");
		expect(commandQuery("/Perms user get", withSubcommands)).toBe("Perms user get");
		expect(commandQuery("/perms user get someone", withSubcommands)).toBeNull();
		expect(commandQuery("/perms user", null)).toBeNull();
	});
});

describe("commandUse", () => {
	test("sends a command without subcommands as before: its options at the top", () => {
		const roll = command({ type: T.Integer, name: "sides", description: "d", required: true });
		const used = usedOptions(entryOf(roll), fields({ sides: "20" }));
		expect("options" in used && commandUse(entryOf(roll), used.options)).toEqual({
			id: "c1",
			name: "roll",
			type: 1,
			options: [{ name: "sides", type: T.Integer, value: 20 }],
		});
	});

	test("sends a subcommand's options under it, in its group", () => {
		const [get, reset, list] = commandEntries(perms);
		const used = usedOptions(get, fields({ who: "u1" }));
		expect("options" in used && commandUse(get, used.options)).toEqual({
			id: "perms",
			name: "perms",
			type: 1,
			options: [
				{
					name: "user",
					type: T.SubcommandGroup,
					options: [{ name: "get", type: T.Subcommand, options: [{ name: "who", type: T.User, value: "u1" }] }],
				},
			],
		});
		expect(commandUse(reset, [])).toEqual({
			id: "perms",
			name: "perms",
			type: 1,
			options: [
				{ name: "user", type: T.SubcommandGroup, options: [{ name: "reset", type: T.Subcommand, options: [] }] },
			],
		});
		expect(commandUse(list, [{ name: "page", type: T.Integer, value: 2 }]).options).toEqual([
			{ name: "list", type: T.Subcommand, options: [{ name: "page", type: T.Integer, value: 2 }] },
		]);
	});

	test("checks the subcommand's options, not the command's", () => {
		const [get, , list] = commandEntries(perms);
		expect(usedOptions(get, fields({}))).toEqual({ problem: "who is required" });
		expect(usedOptions(list, fields({ page: "0" }))).toEqual({ problem: "page must be at least 1" });
		expect(usedOptions(list, fields({}))).toEqual({ options: [] });
	});
});
