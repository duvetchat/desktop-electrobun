import { describe, expect, test } from "bun:test";
import { createRawSnippet } from "svelte";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { statusDotClass } from "$lib/status";
import { tags, type Tag } from "../server-render";
import { buttonClass, iconButtonClass, pillClass } from "./recipes";

// What each primitive of the design system (#357) draws, as the server renders it. What they do once open (keys,
// placement, focus, what closes them) is bits-ui's own, checked in a browser on the foundation's gallery page.
const load = async (name: string) => (await import(`./${name}.svelte`)).default;
const [Avatar, Button, ContextMenu, Dialog, Glass, IconButton, Kbd, Menu, Pill, Popover, Segmented, Sheet] =
	await Promise.all(
		[
			"Avatar",
			"Button",
			"ContextMenu",
			"Dialog",
			"Glass",
			"IconButton",
			"Kbd",
			"Menu",
			"Pill",
			"Popover",
			"Segmented",
			"Sheet",
		].map(load),
	);
const [SpaceIcon, Toggle, Tooltip] = await Promise.all(["SpaceIcon", "Toggle", "Tooltip"].map(load));

const text = (label: string) => createRawSnippet(() => ({ render: () => `<span data-label>${label}</span>` }));
// What opens a floating primitive: a button that takes the props it is handed, as a caller's would.
const opener = createRawSnippet<[Record<string, unknown>]>((props) => ({
	render: () =>
		`<button data-opener ${Object.entries(props())
			.filter(([, value]) => typeof value === "string" || typeof value === "boolean")
			.map(([name, value]) => `${name}="${String(value)}"`)
			.join(" ")}>Open</button>`,
}));
const classes = (tag: Tag) => (tag.attributes.class ?? "").split(/\s+/);
const styles = (tag: Tag) =>
	Object.fromEntries(
		(tag.attributes.style ?? "")
			.split(";")
			.map((declaration) => declaration.split(":").map((part) => part.trim()))
			.filter(([name]) => name),
	);

describe("Button", () => {
	test("is a button in its variant's and size's classes, with what the caller adds", async () => {
		const [button, label] = await tags(Button, {
			variant: "secondary",
			size: "sm",
			class: "w-full",
			children: text("Copy link"),
		});
		expect(button!.name).toBe("button");
		expect(button!.attributes.type).toBe("button");
		expect(classes(button!)).toEqual(expect.arrayContaining([...buttonClass("secondary", "sm").split(" "), "w-full"]));
		expect(label!.attributes["data-label"]).toBeDefined();
	});

	test("is primary and 34 px unless told otherwise", async () => {
		const [button] = await tags(Button, { children: text("Send") });
		expect(classes(button!)).toEqual(expect.arrayContaining(buttonClass("primary", "md").split(" ")));
	});

	test("with an href, is a link", async () => {
		const [link] = await tags(Button, { href: "https://duvet.chat", children: text("Open") });
		expect(link!.name).toBe("a");
		expect(link!.attributes.href).toBe("https://duvet.chat");
	});

	test("disabled, says so", async () => {
		const [button] = await tags(Button, { disabled: true, children: text("Send") });
		expect(button!.attributes.disabled).toBeDefined();
	});
});

describe("IconButton", () => {
	test("is named for a screen reader by its label", async () => {
		const [button, ...rest] = await tags(IconButton, { label: "Pinned messages", children: text("") });
		expect(button!.name).toBe("button");
		expect(button!.attributes["aria-label"]).toBe("Pinned messages");
		expect(classes(button!)).toEqual(expect.arrayContaining(iconButtonClass("md", false).split(" ")));
		// Its icon, and no badge.
		expect(rest).toHaveLength(1);
	});

	test("active and small, draws so", async () => {
		const [button] = await tags(IconButton, { label: "Members", size: "sm", active: true, children: text("") });
		expect(classes(button!)).toEqual(expect.arrayContaining(iconButtonClass("sm", true).split(" ")));
	});

	test("with a badge, has the accent's dot on its corner, hidden from a screen reader", async () => {
		const [, , badge] = await tags(IconButton, { label: "Notifications", badge: true, children: text("") });
		expect(classes(badge!)).toEqual(expect.arrayContaining(["bg-duvet-accent", "rounded-full", "size-[7px]"]));
		expect(badge!.attributes["aria-hidden"]).toBe("true");
	});
});

describe("Kbd and Glass", () => {
	test("a key cap is a kbd, 18 px tall on the key fill", async () => {
		const [kbd] = await tags(Kbd, { children: text("⌘K") });
		expect(kbd!.name).toBe("kbd");
		expect(classes(kbd!)).toEqual(
			expect.arrayContaining(["bg-duvet-kbd", "text-duvet-ink2", "h-[18px]", "rounded-[5px]"]),
		);
	});

	test("glass is a div in the glass recipe, the strong one when asked, with the caller's shape", async () => {
		const [glass] = await tags(Glass, { class: "rounded-[18px]", children: text("A bar") });
		expect(glass!.name).toBe("div");
		expect(classes(glass!)).toEqual(
			expect.arrayContaining(["bg-duvet-glass", "backdrop-blur-[32px]", "rounded-[18px]"]),
		);
		const [strong] = await tags(Glass, { strong: true, children: text("A sheet") });
		expect(classes(strong!)).toContain("bg-duvet-glass-strong");
	});
});

describe("Pill", () => {
	test("is a toggle button that says whether it's picked", async () => {
		const [on] = await tags(Pill, { pressed: true, children: text("Images") });
		expect(on!.name).toBe("button");
		expect(on!.attributes["aria-pressed"]).toBe("true");
		expect(classes(on!)).toEqual(expect.arrayContaining(pillClass(true).split(" ")));
		const [off] = await tags(Pill, { children: text("Links") });
		expect(off!.attributes["aria-pressed"]).toBe("false");
		expect(classes(off!)).toEqual(expect.arrayContaining(pillClass(false).split(" ")));
	});

	test("static, is a label and no button", async () => {
		const [pill] = await tags(Pill, { static: true, pressed: true, children: text("Crew") });
		expect(pill!.name).toBe("span");
		expect(pill!.attributes["aria-pressed"]).toBeUndefined();
		expect(classes(pill!)).toEqual(expect.arrayContaining(pillClass(true).split(" ")));
	});
});

describe("Toggle", () => {
	test("is a switch, named, that says whether it's on", async () => {
		const [on, knob] = await tags(Toggle, { checked: true, label: "Noise suppression" });
		expect(on!.attributes.role).toBe("switch");
		expect(on!.attributes["aria-checked"]).toBe("true");
		expect(on!.attributes["aria-label"]).toBe("Noise suppression");
		expect(classes(on!)).toEqual(
			expect.arrayContaining(["bg-duvet-toggle-off", "data-[state=checked]:bg-duvet-accent", "h-6", "w-10"]),
		);
		// The knob slides 16 px on the overshoot, and not at all under reduced motion.
		expect(classes(knob!)).toEqual(
			expect.arrayContaining([
				"bg-fixed-white",
				"size-[18px]",
				"data-[state=checked]:translate-x-4",
				"ease-overshoot",
				"duration-[250ms]",
				"motion-reduce:transition-none",
			]),
		);
		const [off] = await tags(Toggle, { label: "Faces in voice" });
		expect(off!.attributes["aria-checked"]).toBe("false");
	});

	test("disabled, says so", async () => {
		const [toggle] = await tags(Toggle, { checked: true, disabled: true, label: "Locked" });
		expect(toggle!.attributes.disabled).toBeDefined();
	});
});

describe("Segmented", () => {
	const options = [
		{ value: "all", label: "All" },
		{ value: "chats", label: "Chats" },
		{ value: "spaces", label: "Spaces" },
	];

	test("is a named radio group with a radio per option, the pick checked", async () => {
		const found = await tags(Segmented, { options, value: "chats", label: "Show in the sidebar" });
		const [group] = found;
		expect(group!.attributes.role).toBe("radiogroup");
		expect(group!.attributes["aria-label"]).toBe("Show in the sidebar");
		const radios = found.filter((tag) => tag.attributes.role === "radio");
		expect(radios.map((radio) => radio.attributes["aria-checked"])).toEqual(["false", "true", "false"]);
	});

	test("tells its thumb how many options there are and which is picked", async () => {
		const [group, thumb] = await tags(Segmented, { options, value: "spaces", label: "Show in the sidebar" });
		expect(styles(group!)).toMatchObject({ "--n": "3", "--i": "2" });
		expect(thumb!.attributes["aria-hidden"]).toBe("true");
		// A third of the track wide, moved by its own width per place, on the spring.
		expect(classes(thumb!)).toEqual(
			expect.arrayContaining([
				"w-[calc((100%-6px)/var(--n))]",
				"translate-x-[calc(var(--i)*100%)]",
				"ease-spring",
				"duration-[250ms]",
				"motion-reduce:transition-none",
				"bg-duvet-seg-thumb",
			]),
		);
	});

	test("keeps each option's icon whole in a tight column, its words giving way (#426)", async () => {
		const icon = (await import("@lucide/svelte/icons/layout-grid")).default;
		const found = await tags(Segmented, {
			options: options.map((option) => ({ ...option, icon })),
			value: "all",
			label: "Show in the sidebar",
		});
		// The option's row would take the width it lacks from the one item that can shrink, the icon: at the sidebar's
		// narrowest a column is 68.7 px, and Spaces' icon was drawn 0 px wide.
		const icons = found.filter((tag) => tag.name === "svg");
		expect(icons).toHaveLength(3);
		for (const svg of icons) expect(classes(svg)).toContain("shrink-0");
		const radios = found.filter((tag) => tag.attributes.role === "radio");
		for (const radio of radios) expect(classes(radio)).toEqual(expect.arrayContaining(["justify-center", "px-0.5"]));
		// Past its 2 px, its padding is a spacer either side, 10 px as before, that gives way before the words do.
		const spacers = found.filter((tag) => classes(tag).includes("shrink-[1000]"));
		expect(spacers).toHaveLength(6);
		for (const spacer of spacers) expect(classes(spacer)).toEqual(expect.arrayContaining(["w-2.5", "min-w-0"]));
		for (const svg of icons) expect(classes(svg)).toContain("mr-[5px]");
	});

	// #562: a longer language's label in a column too narrow for it keeps its icon beside it, and scrolls.
	test("draws each label whole in a window that clips it, its icon beside it, named by its words", async () => {
		const icon = (await import("@lucide/svelte/icons/layout-grid")).default;
		const found = await tags(Segmented, {
			options: options.map((option) => ({ ...option, icon })),
			value: "all",
			label: "Show in the sidebar",
		});
		const radios = found.filter((tag) => tag.attributes.role === "radio");
		for (const radio of radios) {
			expect(radio.attributes["aria-label"]).toBeUndefined();
			expect(classes(radio)).toEqual(expect.arrayContaining(["min-w-0", "group/segment"]));
			const after = found.slice(found.indexOf(radio) + 1);
			const box = after.find((tag) => classes(tag).includes("overflow-hidden"))!;
			// The window shrinks, clips and keeps the descenders; the words in it stay whole, on one line.
			expect(classes(box)).toEqual(expect.arrayContaining(["min-w-0", "overflow-hidden", "leading-normal"]));
			expect(classes(box)).not.toContain("truncate");
			// Taken to fit until measured: neither faded nor scrolling.
			expect(box.attributes.class).not.toContain("mask-image");
			const words = after[after.indexOf(box) + 1]!;
			expect(classes(words)).toContain("inline-block");
			expect(words.attributes.class).not.toContain("animate-marquee");
		}
		// Every option shows its icon: none is ever shown by its icon alone.
		expect(found.filter((tag) => tag.name === "svg")).toHaveLength(3);
		// Its tooltip is its title until its label is clipped.
		expect(radios.map((radio) => radio.attributes.title)).toEqual([undefined, undefined, undefined]);
	});

	// What a clipped label is drawn with is set once it's measured, which a page drawn on the server never is.
	test("scrolls a clipped label only while its option is pointed at or focused, faded at its edges", async () => {
		const source = await Bun.file(new URL("./Segmented.svelte", import.meta.url)).text();
		expect(source).toContain(
			'const SCROLLS = "group-hover/segment:animate-marquee group-focus-visible/segment:animate-marquee";',
		);
		expect(source).toContain(
			"[mask-image:linear-gradient(to_right,transparent,#000_3px,#000_calc(100%-3px),transparent)]",
		);
		expect(source).toContain("{clipped[option.value] ? SCROLLS : ''}");
		expect(source).toContain("{clipped[option.value] ? CLIPPED : ''}");
	});
});

describe("Avatar", () => {
	const dots = (found: Tag[]) => found.filter((tag) => classes(tag).includes("-bottom-px"));

	test("is a circle of its size, with the picture and its alternative text", async () => {
		const [frame, clip, img, ...rest] = await tags(Avatar, { src: "/a.png", name: "Tamsin Hale", size: 40 });
		expect(styles(frame!)).toMatchObject({ width: "40px", height: "40px" });
		expect(classes(clip!)).toEqual(expect.arrayContaining(["rounded-full", "overflow-hidden"]));
		expect(img!.attributes).toMatchObject({ src: "/a.png", alt: "Tamsin Hale" });
		// No presence unless a status is given.
		expect(rest).toEqual([]);
	});

	test("a bot's is a rounded square: circles are for people", async () => {
		const [, clip] = await tags(Avatar, { src: "/bot.png", bot: true });
		expect(classes(clip!)).toContain("rounded-[28%]");
		expect(classes(clip!)).not.toContain("rounded-full");
	});

	test("draws the caller's own picture in place of an image", async () => {
		const found = await tags(Avatar, { src: "/a.png", children: text("face") });
		expect(found.some((tag) => tag.name === "img")).toBe(false);
		expect(found.some((tag) => tag.attributes["data-label"] !== undefined)).toBe(true);
	});

	test("presence is a dot three tenths of the avatar wide, ringed in the color behind it", async () => {
		for (const [size, dot] of [
			[20, 8],
			[32, 10],
			[64, 19],
		] as const) {
			const [presence] = dots(await tags(Avatar, { size, status: "online", ring: "var(--duvet-sb-ring)" }));
			expect(styles(presence!)).toMatchObject({
				width: `${dot}px`,
				height: `${dot}px`,
				"box-shadow": "0 0 0 2px var(--duvet-sb-ring)",
			});
			expect(classes(presence!)).toEqual(expect.arrayContaining(["rounded-full", statusDotClass("online")]));
		}
	});

	test("idle keeps the app's warning color, and do not disturb has its bar, in the ring's color", async () => {
		const [idle] = dots(await tags(Avatar, { status: "idle" }));
		expect(classes(idle!)).toContain(statusDotClass("idle"));
		const found = await tags(Avatar, { status: "dnd" });
		const [dnd] = dots(found);
		expect(classes(dnd!)).toContain(statusDotClass("dnd"));
		const bar = found.at(-1)!;
		expect(classes(bar)).toEqual(expect.arrayContaining(["h-0.5", "inset-x-[24%]"]));
		expect(styles(bar).background).toBe("var(--duvet-bg)");
	});

	test("offline is a hollow ring in the second ink", async () => {
		const [offline] = dots(await tags(Avatar, { status: "offline" }));
		expect(styles(offline!)["box-shadow"]).toBe("0 0 0 2px var(--duvet-bg), inset 0 0 0 2px var(--duvet-ink2)");
		expect(classes(offline!)).not.toContain(statusDotClass("online"));
	});

	// #82: someone connected only from the mobile app shows as a phone, as the app draws it (StatusDot).
	test("someone only on their phone gets the phone, as wide as the dot", async () => {
		const found = await tags(Avatar, { size: 40, status: "online", mobileOnly: true });
		const [holder] = dots(found);
		expect(styles(holder!)).toMatchObject({ width: "12px", color: "var(--duvet-bg)" });
		expect(found.some((tag) => classes(tag).includes("aspect-[2/3]"))).toBe(true);
	});
});

describe("SpaceIcon", () => {
	test("is a rounded square, its corners 27% of its size, never a circle", async () => {
		const [icon] = await tags(SpaceIcon, { name: "Harbour Lights", size: 44 });
		expect(styles(icon!)).toMatchObject({
			width: "44px",
			height: "44px",
			"border-radius": "12px",
			"font-size": "20px",
		});
		expect(classes(icon!)).not.toContain("rounded-full");
		expect(classes(icon!)).toEqual(expect.arrayContaining(["font-serif", "bg-duvet-secondary-fill"]));
	});

	test("shows its picture when it has one, and nothing to read: the name is beside it", async () => {
		const [, img] = await tags(SpaceIcon, { name: "Harbour Lights", src: "/icon.png" });
		expect(img!.attributes).toMatchObject({ src: "/icon.png", alt: "" });
	});
});

describe("what floats", () => {
	test("a tooltip, a menu and a popover hand their opener what makes it one", async () => {
		const [tip] = await tags(Tooltip, { text: "Mute", keys: "⇧⌘M", trigger: opener });
		expect(tip!.attributes["data-opener"]).toBeDefined();
		expect(tip!.attributes["data-tooltip-trigger"]).toBeDefined();

		const [menu] = await tags(Menu, { trigger: opener, children: text("items") });
		expect(menu!.attributes).toMatchObject({ "aria-haspopup": "menu", "aria-expanded": "false" });

		const [popover] = await tags(Popover, { trigger: opener, children: text("panel") });
		expect(popover!.attributes).toMatchObject({ "aria-haspopup": "dialog", "aria-expanded": "false" });

		const [target] = await tags(ContextMenu, { target: opener, children: text("items") });
		expect(target!.attributes["data-context-menu-trigger"]).toBeDefined();
	});

	test("closed, none of them draws its panel", async () => {
		for (const found of [
			await tags(Tooltip, { text: "Mute", trigger: opener }),
			await tags(Menu, { trigger: opener, children: text("items") }),
			await tags(Popover, { trigger: opener, children: text("panel") }),
			await tags(ContextMenu, { target: opener, children: text("items") }),
		]) {
			expect(found.map((tag) => tag.name)).toEqual(["button"]);
		}
		expect(await tags(Sheet, { title: "New room", children: text("fields") })).toEqual([]);
		expect(await tags(Dialog, { title: "Delete this room?", actions: text("buttons") })).toEqual([]);
	});
});

// The recipes each one's source must keep: what a render on the server can't show (a closed panel's classes).
describe("the floating panels' recipes", () => {
	const source = (name: string) => readFileSync(join(import.meta.dir, `${name}.svelte`), "utf8");

	test("the tooltip rests 520 ms, sits 6 px away, above everything, and never takes the pointer", () => {
		const tooltip = source("Tooltip");
		expect(tooltip).toContain("delayDuration={520}");
		expect(tooltip).toContain("sideOffset={6}");
		for (const name of ["bg-duvet-tip-bg", "text-duvet-tip-ink", "z-[3000]", "pointer-events-none", "animate-tip-in"])
			expect(tooltip).toContain(name);
		expect(tooltip).toContain("text-duvet-tip-dim");
	});

	test("menus, submenus and popovers arrive from the side that faces their anchor, 10 px from the window's edges", () => {
		for (const name of ["Menu", "ContextMenu", "MenuSub", "Popover"]) {
			expect(source(name), name).toContain("origin-(--bits-floating-transform-origin)");
			expect(source(name), name).toContain("collisionPadding={10}");
		}
		expect(source("Menu")).toContain("sideOffset={6}");
		expect(source("Popover")).toContain("sideOffset = 8");
		expect(source("Popover")).toContain("animate-float-in");
		// A submenu is a layer above its menu, and in the page's root as the menu is: its panel is in the portal, in the
		// holder that carries the layer it claimed as it opened (lib/overlay-layers.ts).
		expect(source("MenuSub")).toContain("z-[1001]");
		expect(source("MenuSub")).toMatch(
			/<DropdownMenu\.Portal>(?:(?!<\/DropdownMenu\.Portal>)[^])*<DropdownMenu\.SubContent[^]*<\/DropdownMenu\.Portal>/,
		);
		for (const name of ["Menu", "ContextMenu", "MenuSub", "Popover"]) {
			expect(source(name), name).toContain("style={layerStyle(layer)}");
			expect(source(name), name).toMatch(/const layer = \$derived\(open \? claimLayer\(\) : 0\);/);
		}
	});

	test("the sheet and the dialog are strong glass over the scrim, on the sheets' layer, with a Fraunces title", () => {
		for (const name of ["Sheet", "Dialog"]) {
			const panel = source(name);
			for (const expected of [
				"class={SCRIM}",
				"{GLASS_STRONG} animate-sheet-in",
				"rounded-3xl",
				"font-serif-lg",
				"text-[21px]",
			])
				expect(panel, name).toContain(expected);
		}
		expect(source("Sheet")).toContain("w-[min(520px,calc(100%-48px))]");
		expect(source("Sheet")).toContain("max-h-[84%]");
		// A question waits for its answer: the dialog is an alert dialog, which a press outside doesn't close.
		expect(source("Dialog")).toContain("<AlertDialog.Root");
		expect(source("Sheet")).toContain("<Dialog.Root");
	});

	test("every primitive takes its props through runes and has no style block of its own", () => {
		const files = readdirSync(import.meta.dir).filter((file) => file.endsWith(".svelte"));
		expect(files.length).toBeGreaterThanOrEqual(18);
		for (const file of files) {
			const component = readFileSync(join(import.meta.dir, file), "utf8");
			// Props through the rune, when it has any.
			if (/\blet \{/.test(component)) expect(component, file).toContain("$props()");
			expect(component, file).not.toMatch(/<style[\s>]|export let /);
		}
	});
});
