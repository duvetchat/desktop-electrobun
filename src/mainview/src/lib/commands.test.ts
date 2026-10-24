import { describe, expect, test } from "bun:test";
import { commandOnceListed, matchingCommands, usedOptions, type FieldValue } from "$lib/commands";
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
		expect(usedOptions(cmd, fields({ for: "u1", note: "", sides: " 20 ", bonus: "1.5", secret: true }))).toEqual({
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
		expect(usedOptions(cmd, fields({}))).toEqual({ problem: "text is required" });
		expect(usedOptions(cmd, fields({ text: "" }))).toEqual({ problem: "text is required" });
	});

	test("a required switch is false until it's turned on", () => {
		const cmd = command({ type: T.Boolean, name: "on", description: "d", required: true });
		expect(usedOptions(cmd, fields({}))).toEqual({ options: [{ name: "on", type: T.Boolean, value: false }] });
	});

	test("checks integers", () => {
		const cmd = command({ type: T.Integer, name: "n", description: "d", min_value: 2, max_value: 100 });
		expect(usedOptions(cmd, fields({ n: "2.5" }))).toEqual({ problem: "n must be an integer" });
		expect(usedOptions(cmd, fields({ n: "1e3" }))).toEqual({ problem: "n must be an integer" });
		expect(usedOptions(cmd, fields({ n: "1" }))).toEqual({ problem: "n must be at least 2" });
		expect(usedOptions(cmd, fields({ n: "101" }))).toEqual({ problem: "n must be at most 100" });
		const unbounded = command({ type: T.Integer, name: "n", description: "d" });
		expect(usedOptions(unbounded, fields({ n: "9007199254740992" }))).toEqual({ problem: "n must be an integer" });
		expect(usedOptions(unbounded, fields({ n: "-9007199254740991" }))).toEqual({
			options: [{ name: "n", type: T.Integer, value: -9007199254740991 }],
		});
	});

	test("checks numbers", () => {
		const cmd = command({ type: T.Number, name: "x", description: "d", min_value: -1.5 });
		expect(usedOptions(cmd, fields({ x: "abc" }))).toEqual({ problem: "x must be a number" });
		expect(usedOptions(cmd, fields({ x: "-2" }))).toEqual({ problem: "x must be at least -1.5" });
		expect(usedOptions(cmd, fields({ x: "1e3" }))).toEqual({ options: [{ name: "x", type: T.Number, value: 1000 }] });
		expect(usedOptions(cmd, fields({ x: "1e300" }))).toEqual({ problem: "x must be a number" });
	});

	test("counts a text's characters, not its UTF-16 units", () => {
		const cmd = command({ type: T.String, name: "t", description: "d", min_length: 2, max_length: 3 });
		expect(usedOptions(cmd, fields({ t: "😀😀😀" }))).toEqual({
			options: [{ name: "t", type: T.String, value: "😀😀😀" }],
		});
		expect(usedOptions(cmd, fields({ t: "😀" }))).toEqual({ problem: "t takes 2 characters at least" });
		expect(usedOptions(cmd, fields({ t: "abcd" }))).toEqual({ problem: "t takes 3 characters at most" });
		const unbounded = command({ type: T.String, name: "t", description: "d" });
		expect(usedOptions(unbounded, fields({ t: "a".repeat(6001) }))).toEqual({
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
		expect(usedOptions(cmd, fields({ pick: "" }))).toEqual({ options: [{ name: "pick", type: T.String, value: "" }] });
		expect(usedOptions(cmd, fields({}))).toEqual({ problem: "pick is required" });
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
		expect(usedOptions(cmd, fields({ times: 2 }))).toEqual({ options: [{ name: "times", type: T.Integer, value: 2 }] });
	});

	test("an option named as an object's built-in properties is a field like any other", () => {
		const cmd = command(
			{ type: T.String, name: "constructor", description: "d", required: true },
			{ type: T.String, name: "__proto__", description: "d" },
		);
		expect(usedOptions(cmd, new Map())).toEqual({ problem: "constructor is required" });
		expect(
			usedOptions(
				cmd,
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
		expect(matchingCommands(space, "p").map((c) => c.name)).toEqual(["ping", "poll"]);
		expect(matchingCommands(space, "PO").map((c) => c.name)).toEqual(["poll"]);
		expect(matchingCommands(space, "").map((c) => c.name)).toEqual(["ping", "poll", "roll"]);
		expect(matchingCommands(space, "x")).toEqual([]);
	});
});

describe("commandOnceListed", () => {
	test("waits for the list, then gives the first match", async () => {
		let deliver!: (list: SpaceCommands) => void;
		const list = new Promise<SpaceCommands>((resolve) => (deliver = resolve));
		let picked: ApplicationCommand | null | undefined;
		const done = commandOnceListed(list, "p").then((c) => (picked = c));
		await Bun.sleep(10);
		expect(picked).toBeUndefined(); // nothing yet: the list hasn't come
		deliver(space);
		await done;
		expect(picked?.name).toBe("ping");
	});

	test("gives null when nothing matches, or the list doesn't come: the text goes as a message", async () => {
		expect(await commandOnceListed(Promise.resolve(space), "zzz")).toBeNull();
		expect(await commandOnceListed(Promise.reject(new Error("offline")), "p")).toBeNull();
	});
});
