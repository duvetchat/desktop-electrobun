import { describe, expect, test } from "bun:test";
import { createRawSnippet } from "svelte";
import { tags, type Tag } from "../server-render";

// What the sign-in pages' own components (#357) draw, as the server renders them: the names a screen reader gets, the
// states a field or a result says it is in, and what the mascot does with where it's told to look. What the pages do
// with them is walked in a browser against the local stack (redesign-work/tools/p2-auth-shots.ts).
const load = async (name: string) => (await import(`./${name}.svelte`)).default;
const [AuthField, AuthMascot, AuthNote, AuthResult, AuthSubmit, PasswordEye] = await Promise.all(
	["AuthField", "AuthMascot", "AuthNote", "AuthResult", "AuthSubmit", "PasswordEye"].map(load),
);

const text = (label: string) => createRawSnippet(() => ({ render: () => `<span data-label>${label}</span>` }));
const named = (found: Tag[], name: string) => found.filter((tag) => tag.name === name);
const classes = (tag: Tag) => (tag.attributes.class ?? "").split(/\s+/);

describe("AuthField", () => {
	test("is a labelled input that passes on what the page asks of it", async () => {
		const found = await tags(AuthField, {
			id: "email",
			label: "Email",
			type: "email",
			autocomplete: "email",
			maxlength: 254,
			placeholder: "you@example.com",
			required: true,
		});
		const [label] = named(found, "label");
		const [input] = named(found, "input");
		expect(label!.attributes.for).toBe("email");
		expect(input!.attributes).toMatchObject({
			id: "email",
			type: "email",
			autocomplete: "email",
			maxlength: "254",
			placeholder: "you@example.com",
		});
		expect(input!.attributes.required).toBeDefined();
		expect(input!.attributes["aria-invalid"]).toBeUndefined();
		expect(input!.attributes["aria-describedby"]).toBeUndefined();
		// 38 tall, as the desktop's fields are, and its own focus ring instead of the global outline.
		expect(classes(input!)).toEqual(expect.arrayContaining(["h-[38px]", "focus-override"]));
	});

	test("says what's wrong with it, and names the line that says so", async () => {
		const found = await tags(AuthField, {
			id: "confirmPassword",
			label: "Confirm password",
			error: "Passwords don't match.",
		});
		const [input] = named(found, "input");
		const line = found.find((tag) => tag.attributes.id === "confirmPassword-error");
		expect(input!.attributes["aria-invalid"]).toBe("true");
		expect(input!.attributes["aria-describedby"]).toBe("confirmPassword-error");
		expect(line!.attributes.role).toBe("status");
		expect(classes(line!)).toContain("text-duvet-danger");
	});

	test("its rule turns to danger while it reads wrong, beside a description the page wrote elsewhere", async () => {
		const quiet = await tags(AuthField, { id: "username", label: "Username", hint: "2 to 32." });
		expect(classes(quiet.find((tag) => tag.attributes.id === "username-hint")!)).toContain("text-duvet-ink2");

		const wrong = await tags(AuthField, {
			id: "username",
			label: "Username",
			hint: "2 to 32.",
			invalid: true,
			"aria-describedby": "elsewhere",
		});
		expect(classes(wrong.find((tag) => tag.attributes.id === "username-hint")!)).toContain("text-duvet-danger");
		expect(named(wrong, "input")[0]!.attributes).toMatchObject({
			"aria-invalid": "true",
			"aria-describedby": "elsewhere username-hint",
		});
	});

	test("a step that isn't there yet can't be reached: the whole field is inert, its eye included", async () => {
		const [wrapper] = await tags(AuthField, { id: "password", label: "Password", inert: true, trailing: text("eye") });
		expect(wrapper!.name).toBe("div");
		expect(wrapper!.attributes.inert).toBeDefined();
		const [shown] = await tags(AuthField, { id: "password", label: "Password" });
		expect(shown!.attributes.inert).toBeUndefined();
	});
});

describe("AuthMascot", () => {
	const look = (svg: Tag) => /--look:\s*(-?[\d.]+)px/.exec(svg.attributes.style ?? "")?.[1];

	test("is decoration, in its mood, looking where it's told within its eyes' reach", async () => {
		const [svg] = await tags(AuthMascot, { mood: "shy", look: 0.5, size: 96 });
		expect(svg!.name).toBe("svg");
		expect(svg!.attributes).toMatchObject({ "aria-hidden": "true", "data-mood": "shy", width: "96", height: "96" });
		expect(Number(look(svg!))).toBeCloseTo(1.3);

		expect(Number(look((await tags(AuthMascot, { look: 9 }))[0]!))).toBeCloseTo(2.6);
		expect(Number(look((await tags(AuthMascot, { look: -9 }))[0]!))).toBeCloseTo(-2.6);
		expect((await tags(AuthMascot, {}))[0]!.attributes["data-mood"]).toBe("awake");
	});

	test("has two eyes, which shut by their mood and hold still under reduced motion", async () => {
		const eyes = named(await tags(AuthMascot, {}), "ellipse").filter((tag) => classes(tag).includes("fill-[#7a6ad8]"));
		expect(eyes).toHaveLength(2);
		for (const eye of eyes) {
			expect(classes(eye)).toEqual(
				expect.arrayContaining(["in-data-[mood=shy]:scale-y-[0.14]", "motion-reduce:transition-none"]),
			);
		}
		// Peeking, the left one stays shut and the right one opens.
		expect(classes(eyes[0]!)).toContain("in-data-[mood=peek]:scale-y-[0.14]");
		expect(classes(eyes[1]!)).not.toContain("in-data-[mood=peek]:scale-y-[0.14]");
	});

	test("takes each theme's fills from mobile's art", async () => {
		const found = await tags(AuthMascot, {});
		const body = found.find((tag) => classes(tag).includes("fill-[#c9cbe0]"));
		expect(classes(body!)).toContain("in-[.duvet-light]:fill-[#dcd6ff]");
	});
});

describe("AuthNote", () => {
	test("a refusal is announced at once; an email on its way, politely", async () => {
		const [refusal] = await tags(AuthNote, { children: text("invalid email or password") });
		expect(refusal!.attributes.role).toBe("alert");
		expect(classes(refusal!)).toContain("text-duvet-danger");
		const [sent] = await tags(AuthNote, { tone: "sent", children: text("on its way") });
		expect(sent!.attributes.role).toBe("status");
		expect(classes(sent!)).not.toContain("text-duvet-danger");
	});
});

describe("AuthResult", () => {
	test("while it loads it is busy, and its one line is a status", async () => {
		const found = await tags(AuthResult, { state: "loading", text: "Verifying your email..." });
		expect(found[0]!.attributes).toMatchObject({ "data-auth-result": "loading", "aria-busy": "true" });
		expect(named(found, "h1")).toHaveLength(0);
		expect(named(found, "p")[0]!.attributes.role).toBe("status");
	});

	test("once it's known it has a heading, in the colour of how it went, and the way on", async () => {
		for (const [state, ink] of [
			["success", "text-duvet-alive"],
			["error", "text-duvet-danger"],
			["warning", "text-duvet-warn"],
		] as const) {
			const found = await tags(AuthResult, { state, title: "Title", text: "What happened.", children: text("Go on") });
			expect(found[0]!.attributes["data-auth-result"]).toBe(state);
			expect(found[0]!.attributes["aria-busy"]).toBe("false");
			expect(classes(found[1]!)).toContain(ink);
			expect(named(found, "h1")).toHaveLength(1);
			expect(found.some((tag) => tag.attributes["data-label"] !== undefined)).toBe(true);
		}
	});
});

describe("AuthSubmit", () => {
	test("is its form's submit button, as wide as the column", async () => {
		const [button] = await tags(AuthSubmit, { children: text("Sign in") });
		expect(button!.name).toBe("button");
		expect(button!.attributes.type).toBe("submit");
		expect(button!.attributes.disabled).toBeUndefined();
		expect(classes(button!)).toEqual(expect.arrayContaining(["bg-duvet-accent", "w-full", "h-10!"]));
	});

	test("busy, it can't be pressed again and says so", async () => {
		const found = await tags(AuthSubmit, { busy: true, children: text("Signing in...") });
		expect(found[0]!.attributes.disabled).toBeDefined();
		expect(found[0]!.attributes["aria-busy"]).toBe("true");
		// The spinner, before its words.
		expect(classes(found[1]!)).toContain("animate-spin");
		const [waiting] = await tags(AuthSubmit, { disabled: true, children: text("Create my account") });
		expect(waiting!.attributes.disabled).toBeDefined();
	});

	test("with an address it is a link, and with a press of its own a plain button", async () => {
		const [link] = await tags(AuthSubmit, { href: "/sign-in.html", children: text("Sign in") });
		expect(link!.name).toBe("a");
		expect(link!.attributes.href).toBe("/sign-in.html");
		expect(classes(link!)).toContain("no-underline!");
		const [plain] = await tags(AuthSubmit, { onclick: () => {}, variant: "quiet", children: text("Not now") });
		expect(plain!.attributes.type).toBe("button");
		expect(classes(plain!)).not.toContain("bg-duvet-accent");
	});
});

describe("PasswordEye", () => {
	test("says what a press will do, and whether the password shows", async () => {
		const [hidden] = await tags(PasswordEye, {});
		expect(hidden!.attributes).toMatchObject({
			type: "button",
			"aria-label": "Show password",
			"aria-pressed": "false",
		});
		const [shown] = await tags(PasswordEye, { shown: true });
		expect(shown!.attributes).toMatchObject({ "aria-label": "Hide password", "aria-pressed": "true" });
		expect((await tags(PasswordEye, { disabled: true }))[0]!.attributes.disabled).toBeDefined();
	});
});
