import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { tags, type Tag } from "./server-render";
import { GHOST_BODY } from "$lib/ghost";
import type { TypingUser } from "$lib/stores.svelte";

// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { currentUser, typingUsers } = await import("$lib/stores.svelte");
const { default: AuthMascot } = await import("./auth/AuthMascot.svelte");
const { default: GhostMark } = await import("./GhostMark.svelte");
const { default: TypingIndicator } = await import("./TypingIndicator.svelte");

// #418: who's typing shows as on mobile (mobile/lib/chat/bubble.dart's _TypingLine): the Duvet ghost, its violet
// typing dots, then the sentence, where the desktop had the typers' avatars and three grey dots. What the component
// draws, as the server renders it; how it looks in the app was pictured against the local stack.
const css = readFileSync(join(import.meta.dir, "..", "..", "app.css"), "utf8");
const CHAT = "chat";
const ME = "id-me";
const user = (name: string, recording = false, ago = 0): TypingUser => ({
	user_id: `id-${name}`,
	username: name,
	alias: null,
	avatar: null,
	timestamp: Date.now() - ago,
	recording,
});
const classes = (tag: Tag | undefined) => (tag?.attributes.class ?? "").split(/\s+/);

/** What the indicator draws while these people type or record in the chat: its elements, and its HTML. */
async function drawn(users: TypingUser[]) {
	typingUsers.set({ [CHAT]: users });
	const found = await tags(TypingIndicator, { channelId: CHAT });
	const html = render(TypingIndicator, { props: { channelId: CHAT } }).body;
	const pillAt = found.findIndex((tag) => classes(tag).includes("rounded-full") && classes(tag).includes("h-5"));
	return {
		found,
		html,
		status: found.find((tag) => tag.attributes.role === "status"),
		/** What the line for screen readers says. */
		said: /<span class="sr-only" role="status">([^<]*)<\/span>/.exec(html)?.[1],
		pill: found[pillAt],
		/** The pill's own elements, in order. */
		inside: pillAt < 0 ? [] : found.slice(pillAt + 1),
		dots: found.filter((tag) => classes(tag).includes("animate-ghost-dot")),
	};
}

beforeEach(() => {
	currentUser.set(null);
});

describe("who's typing", () => {
	test("the ghost leads the pill, then its dots and the sentence, with nobody's picture", async () => {
		const { inside, dots, html } = await drawn([user("ana")]);
		expect(inside[0]!.name).toBe("svg");
		expect(inside[0]!.attributes).toMatchObject({ "data-ghost-mark": "", height: "20" });
		// Then the dots, before the words.
		const dotsAt = inside.findIndex((tag) => "data-typing-dots" in tag.attributes);
		const wordsAt = inside.findIndex((tag) => classes(tag).includes("truncate"));
		expect(dotsAt).toBeGreaterThan(0);
		expect(wordsAt).toBeGreaterThan(dotsAt);
		expect(dots).toHaveLength(3);
		expect(html).toContain("ana is typing");
		// No avatar: a picture, or the face drawn for who has none.
		expect(inside.filter((tag) => tag.name === "img" || "data-facehash" in tag.attributes)).toEqual([]);
		expect(readFileSync(join(import.meta.dir, "TypingIndicator.svelte"), "utf8")).not.toContain("UserAvatar");
	});

	test("the dots are mobile's: violet, 6 px, each at its brightest a third of the loop after the last", async () => {
		const { dots } = await drawn([user("ana")]);
		for (const dot of dots) {
			expect(classes(dot)).toEqual(expect.arrayContaining(["bg-duvet-chosen-ink", "size-1.5", "rounded-full"]));
		}
		// The second is two thirds through its loop when the first starts, the third one third: -0.8 s and -0.4 s of
		// 1.2 s. A wait of 0.4 s and 0.8 s would hold them at their still look first.
		const delay = (dot: Tag) => classes(dot).find((name) => name.startsWith("[animation-delay:")) ?? null;
		expect(dots.map(delay)).toEqual([null, "[animation-delay:-0.8s]", "[animation-delay:-0.4s]"]);
		// TypingDots in mobile/lib/widgets/ghost_art.dart: 1200 ms, from 0.35 up to 1 and back in the loop's first half.
		expect(css).toContain("--animate-ghost-dot: ghost-dot 1.2s linear infinite;");
		expect(css).toMatch(
			/@keyframes ghost-dot \{\s*0%,\s*50%,\s*100% \{\s*opacity: 0\.35;\s*\}\s*25% \{\s*opacity: 1;\s*\}\s*\}/,
		);
		// The violet is mobile's violetText (theme.dart), dark and light.
		expect(/:root \{[\s\S]*?--duvet-chosen-ink: (#[0-9a-f]{6});/.exec(css)?.[1]).toBe("#b3a6ff");
		expect(/\.duvet-light \{[\s\S]*?--duvet-chosen-ink: (#[0-9a-f]{6});/.exec(css)?.[1]).toBe("#6a58d6");
	});

	test("with reduced motion the dots stay still, one bright and two fainter, as mobile's do", async () => {
		const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
		expect(reduced).toContain("--animate-ghost-dot: none;");
		// What each dot is styled as, which shows once nothing animates it: mobile's 1, 0.6 and 0.35.
		const { dots } = await drawn([user("ana")]);
		const opacity = (dot: Tag) => classes(dot).find((name) => name.startsWith("opacity-")) ?? null;
		expect(dots.map(opacity)).toEqual([null, "opacity-60", "opacity-35"]);
	});

	test("a screen reader hears the sentence once, from a line that is there before anyone types", async () => {
		const nobody = await drawn([]);
		expect(nobody.status).toBeDefined();
		expect(nobody.said).toBe("");
		expect(nobody.pill).toBeUndefined();

		const both = await drawn([user("ana"), user("bob", true)]);
		expect(both.said).toBe("ana is typing… · bob is recording a voice note");
		expect(classes(both.status)).toContain("sr-only");
		// The pill, its ghost and its dots are for the eye alone.
		expect(both.pill!.attributes["aria-hidden"]).toBe("true");
		expect(both.inside[0]!.attributes["aria-hidden"]).toBe("true");
	});

	test("recording a voice message keeps its microphone, and has no typing dots of its own", async () => {
		const mic = (tag: Tag) => tag.name === "svg" && classes(tag).includes("lucide-mic");
		const recording = await drawn([user("bob", true)]);
		expect("data-ghost-mark" in recording.inside[0]!.attributes).toBe(true);
		expect(recording.dots).toEqual([]);
		expect(recording.inside.filter(mic)).toHaveLength(1);
		expect(recording.html).toContain("bob is recording a voice note");

		const both = await drawn([user("ana"), user("bob", true)]);
		expect(both.dots).toHaveLength(3);
		expect(both.inside.filter(mic)).toHaveLength(1);
		expect((await drawn([user("ana")])).inside.filter(mic)).toEqual([]);
	});

	test("never the user themselves, nor a notice that got old", async () => {
		currentUser.set({
			id: ME,
			username: "me",
			email_verified: true,
			alias: null,
			avatar: null,
			banner: null,
			custom: "",
			flags: 0,
			badges: 0,
			is_bot: false,
			created_at: "",
			updated_at: "",
		});
		const own = await drawn([user("me")]);
		expect(own.pill).toBeUndefined();
		expect(own.said).toBe("");
		expect((await drawn([user("ana", false, 5000)])).pill).toBeUndefined();
		expect((await drawn([user("me"), user("ana")])).said).toBe("ana is typing…");
	});
});

describe("the ghost mark", () => {
	const paths = (found: Tag[]) => found.filter((tag) => tag.name === "path");

	test("is mobile's: 64 wide for 72 tall, by its height, and decoration", async () => {
		const [svg] = await tags(GhostMark, { size: 20 });
		expect(svg!.name).toBe("svg");
		expect(svg!.attributes).toMatchObject({ height: "20", "aria-hidden": "true" });
		expect(Number(svg!.attributes.width)).toBeCloseTo((20 * 64) / 72);
		expect(svg!.attributes.viewBox ?? svg!.attributes.viewbox).toBe("20 20 64 72");
		expect((await tags(GhostMark, {}))[0]!.attributes.height).toBe("24");
	});

	test("draws the mascot's own outline, in each theme's art colours", async () => {
		const found = await tags(GhostMark, {});
		// Its clip, its cast shadow, its shade and its body: one outline four times.
		expect(paths(found).map((path) => path.attributes.d)).toEqual([GHOST_BODY, GHOST_BODY, GHOST_BODY, GHOST_BODY]);
		expect(paths(await tags(AuthMascot, {})).filter((path) => path.attributes.d === GHOST_BODY)).toHaveLength(4);
		// GhostMark's fills in mobile/lib/widgets/ghost_art.dart, dark and light.
		const fills = paths(found)
			.map((path) => classes(path).filter((name) => name.includes("fill-[")))
			.filter((names) => names.length > 0);
		expect(fills).toEqual([
			["fill-[#1c1d28]", "in-[.duvet-light]:fill-[#d3dfff]"],
			["fill-[#c9cbe0]", "in-[.duvet-light]:fill-[#dcd6ff]"],
			["fill-[#f7f6f3]", "in-[.duvet-light]:fill-[#ffffff]"],
		]);
		const eyes = found.filter((tag) => tag.name === "ellipse");
		expect(eyes.map((eye) => classes(eye))).toEqual([["fill-[#7a6ad8]"], ["fill-[#7a6ad8]"]]);
	});

	test("clips its body's light to an outline of its own", async () => {
		const found = await tags(GhostMark, {});
		const clip = found.find((tag) => tag.name.toLowerCase() === "clippath");
		const clipped = found.find((tag) => "clip-path" in tag.attributes);
		expect(clip!.attributes.id).toMatch(/.-ghost$/);
		expect(clipped!.attributes["clip-path"]).toBe(`url(#${clip!.attributes.id})`);
	});
});
