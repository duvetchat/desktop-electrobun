import { describe, expect, test } from "bun:test";
import { initialValues, modalAnswers } from "$lib/modals";
import { ComponentType as T, type Component, type Modal } from "$lib/types";

let nextId = 1;
const label = (input: Component): Component => ({
	type: T.Label,
	id: nextId++,
	label: "Question",
	component: { id: nextId++, ...input },
});
const modal = (...components: Component[]): Modal => ({ custom_id: "form", title: "Form", components });
const options = (...values: string[]) => values.map((value) => ({ label: value.toUpperCase(), value }));

describe("initialValues", () => {
	test("starts each input with what the bot gave it", () => {
		const m = modal(
			{ type: T.TextDisplay, id: 1, content: "Hi" },
			label({ type: T.TextInput, custom_id: "name", style: 1, value: "Bob" }),
			label({ type: T.TextInput, custom_id: "empty", style: 2 }),
			label({
				type: T.StringSelect,
				custom_id: "bug",
				options: [
					{ label: "Ant", value: "ant", default: true },
					{ label: "Bee", value: "bee" },
				],
			}),
			label({ type: T.UserSelect, custom_id: "who", default_values: [{ id: "u1", type: "user" }] }),
		);
		expect(initialValues(m)).toEqual({ name: "Bob", empty: "", bug: ["ant"], who: ["u1"] });
		const groups = modal(
			label({
				type: T.RadioGroup,
				custom_id: "class",
				options: [
					{ label: "A", value: "a" },
					{ label: "B", value: "b", default: true },
				],
			}),
			label({ type: T.RadioGroup, custom_id: "none", options: options("a", "b") }),
			label({
				type: T.CheckboxGroup,
				custom_id: "days",
				options: [
					{ label: "Mon", value: "mon", default: true },
					{ label: "Tue", value: "tue" },
				],
			}),
			label({ type: T.Checkbox, custom_id: "agree", default: true }),
			label({ type: T.Checkbox, custom_id: "off" }),
		);
		expect(initialValues(groups)).toEqual({ class: "b", none: null, days: ["mon"], agree: true, off: false });
	});
});

describe("modalAnswers", () => {
	test("sends each label with its input and what was entered, as the API takes it", () => {
		const m = modal(
			{ type: T.TextDisplay, id: 1, content: "Hi" },
			{ type: T.Label, id: 2, label: "Name", component: { type: T.TextInput, id: 3, custom_id: "name", style: 1 } },
			{
				type: T.Label,
				id: 4,
				label: "Who",
				component: { type: T.UserSelect, id: 5, custom_id: "who", required: false, min_values: 0 },
			},
			{
				type: T.Label,
				id: 6,
				label: "Class",
				component: { type: T.RadioGroup, id: 7, custom_id: "class", required: false, options: options("a", "b") },
			},
			{ type: T.Label, id: 8, label: "Agree", component: { type: T.Checkbox, id: 9, custom_id: "agree" } },
		);
		expect(modalAnswers(m, { name: "Bob", who: [], class: null, agree: true })).toEqual({
			components: [
				{ type: T.Label, id: 2, component: { type: T.TextInput, id: 3, custom_id: "name", value: "Bob" } },
				{ type: T.Label, id: 4, component: { type: T.UserSelect, id: 5, custom_id: "who", values: [] } },
				{ type: T.Label, id: 6, component: { type: T.RadioGroup, id: 7, custom_id: "class", value: null } },
				{ type: T.Label, id: 8, component: { type: T.Checkbox, id: 9, custom_id: "agree", value: true } },
			],
		});
	});

	test("asks for the required ones, and only those", () => {
		const m = modal(
			label({ type: T.TextInput, custom_id: "name", style: 1 }),
			label({ type: T.TextInput, custom_id: "about", style: 2, required: false }),
			label({ type: T.StringSelect, custom_id: "bug", options: options("ant", "bee") }),
			label({ type: T.RadioGroup, custom_id: "class", options: options("a", "b") }),
			label({ type: T.CheckboxGroup, custom_id: "days", options: options("mon", "tue") }),
			label({ type: T.Checkbox, custom_id: "agree" }),
		);
		expect(modalAnswers(m, initialValues(m))).toEqual({
			problems: {
				name: "This field is required",
				bug: "This field is required",
				class: "This field is required",
				days: "This field is required",
			},
		});
	});

	test("a text's length, in characters, within its bounds", () => {
		const m = modal(
			label({ type: T.TextInput, custom_id: "name", style: 1, min_length: 2, max_length: 5, required: false }),
		);
		expect(modalAnswers(m, { name: "B" })).toEqual({ problems: { name: "Must be at least 2 characters" } });
		expect(modalAnswers(m, { name: "Bartholomew" })).toEqual({ problems: { name: "Must be at most 5 characters" } });
		expect("problems" in modalAnswers(m, { name: "" })).toBe(false); // optional: empty is fine
		expect("problems" in modalAnswers(m, { name: "😀😀😀😀😀" })).toBe(false); // five characters, ten UTF-16 units
		const long = modal(label({ type: T.TextInput, custom_id: "text", style: 2 }));
		expect(modalAnswers(long, { text: "x".repeat(4001) })).toEqual({
			problems: { text: "Must be at most 4000 characters" },
		});
	});

	test("how many a select or a checkbox group chooses", () => {
		const m = modal(
			label({ type: T.RoleSelect, custom_id: "roles", min_values: 2, max_values: 3 }),
			label({
				type: T.CheckboxGroup,
				custom_id: "days",
				required: false,
				min_values: 2,
				options: options("mon", "tue", "wed"),
			}),
		);
		expect(modalAnswers(m, { roles: ["r1"], days: ["mon"] })).toEqual({
			problems: { roles: "Choose 2 to 3", days: "Choose 2 to 3" },
		});
		expect(modalAnswers(m, { roles: ["r1", "r2"], days: [] })).toEqual({
			components: [
				{
					type: T.Label,
					id: expect.any(Number),
					component: { type: T.RoleSelect, id: expect.any(Number), custom_id: "roles", values: ["r1", "r2"] },
				},
				{
					type: T.Label,
					id: expect.any(Number),
					component: { type: T.CheckboxGroup, id: expect.any(Number), custom_id: "days", values: [] },
				},
			],
		});
	});
});
