import { describe, expect, test } from "bun:test";
import { usedOptions } from "$lib/commands";
import { CommandOptionType as T, type ApplicationCommand, type CommandOption } from "$lib/types";

const command = (...options: CommandOption[]): ApplicationCommand => ({
	id: "c1",
	type: 1,
	application_id: "a1",
	name: "roll",
	description: "Rolls dice",
	options,
	version: "2026-10-20T00:00:00Z",
});

describe("usedOptions", () => {
	test("sends the options given in the command's order, integers and numbers as numbers", () => {
		const cmd = command(
			{ type: T.Integer, name: "sides", description: "d", required: true },
			{ type: T.Number, name: "bonus", description: "d" },
			{ type: T.String, name: "note", description: "d" },
			{ type: T.Boolean, name: "secret", description: "d" },
			{ type: T.User, name: "for", description: "d" },
		);
		expect(usedOptions(cmd, { for: "u1", note: "", sides: " 20 ", bonus: "1.5", secret: true })).toEqual({
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
		expect(usedOptions(cmd, {})).toEqual({ problem: "text is required" });
		expect(usedOptions(cmd, { text: "" })).toEqual({ problem: "text is required" });
	});

	test("a required switch is false until it's turned on", () => {
		const cmd = command({ type: T.Boolean, name: "on", description: "d", required: true });
		expect(usedOptions(cmd, {})).toEqual({ options: [{ name: "on", type: T.Boolean, value: false }] });
	});

	test("checks integers", () => {
		const cmd = command({ type: T.Integer, name: "n", description: "d", min_value: 2, max_value: 100 });
		expect(usedOptions(cmd, { n: "2.5" })).toEqual({ problem: "n must be an integer" });
		expect(usedOptions(cmd, { n: "1e3" })).toEqual({ problem: "n must be an integer" });
		expect(usedOptions(cmd, { n: "1" })).toEqual({ problem: "n must be at least 2" });
		expect(usedOptions(cmd, { n: "101" })).toEqual({ problem: "n must be at most 100" });
		const unbounded = command({ type: T.Integer, name: "n", description: "d" });
		expect(usedOptions(unbounded, { n: "9007199254740992" })).toEqual({ problem: "n must be an integer" });
		expect(usedOptions(unbounded, { n: "-9007199254740991" })).toEqual({
			options: [{ name: "n", type: T.Integer, value: -9007199254740991 }],
		});
	});

	test("checks numbers", () => {
		const cmd = command({ type: T.Number, name: "x", description: "d", min_value: -1.5 });
		expect(usedOptions(cmd, { x: "abc" })).toEqual({ problem: "x must be a number" });
		expect(usedOptions(cmd, { x: "-2" })).toEqual({ problem: "x must be at least -1.5" });
		expect(usedOptions(cmd, { x: "1e3" })).toEqual({ options: [{ name: "x", type: T.Number, value: 1000 }] });
		expect(usedOptions(cmd, { x: "1e300" })).toEqual({ problem: "x must be a number" });
	});

	test("counts a text's characters, not its UTF-16 units", () => {
		const cmd = command({ type: T.String, name: "t", description: "d", min_length: 2, max_length: 3 });
		expect(usedOptions(cmd, { t: "😀😀😀" })).toEqual({ options: [{ name: "t", type: T.String, value: "😀😀😀" }] });
		expect(usedOptions(cmd, { t: "😀" })).toEqual({ problem: "t takes 2 characters at least" });
		expect(usedOptions(cmd, { t: "abcd" })).toEqual({ problem: "t takes 3 characters at most" });
		const unbounded = command({ type: T.String, name: "t", description: "d" });
		expect(usedOptions(unbounded, { t: "a".repeat(6001) })).toEqual({ problem: "t takes 6000 characters at most" });
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
		expect(usedOptions(cmd, { pick: "" })).toEqual({ options: [{ name: "pick", type: T.String, value: "" }] });
		expect(usedOptions(cmd, {})).toEqual({ problem: "pick is required" });
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
		expect(usedOptions(cmd, { times: 2 })).toEqual({ options: [{ name: "times", type: T.Integer, value: 2 }] });
	});
});
