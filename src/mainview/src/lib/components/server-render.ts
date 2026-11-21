import type { Component } from "svelte";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";

// For tests of what a component draws: Bun loads a .svelte file compiled for the server, so that a test, once this
// module has run, can import a component (await import(), as a static import would load it before) and render it. A
// package's .svelte.js modules, which use runes (bits-ui's), are compiled for the server too.
Bun.plugin({
	name: "svelte components for the server",
	setup(build) {
		build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
			contents: compile(await Bun.file(path).text(), { filename: path, generate: "server" }).js.code,
			loader: "js",
		}));
		build.onLoad({ filter: /\.svelte\.js$/ }, async ({ path }) => ({
			contents: compileModule(await Bun.file(path).text(), { filename: path, generate: "server" }).js.code,
			loader: "js",
		}));
	},
});

export interface Tag {
	name: string;
	attributes: Record<string, string>;
}

/** The height in px a tag's own Tailwind classes draw it at: `h-N` is N × 4 px (Tailwind's 0.25rem step at the 16 px
 *  root), `h-[Npx]` is N px. NaN with no tag, or when none of its classes sets it. */
export function drawnHeight(tag: Tag | undefined): number {
	const height = /(?:^|\s)h-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?)px\])(?=\s|$)/.exec(tag?.attributes.class ?? "");
	if (!height) return NaN;
	return height[1] !== undefined ? Number(height[1]) * 4 : Number(height[2]);
}

// An attribute's value as Svelte escapes it (escape_html), read back.
const ESCAPED: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&lt;": "<" };
const unescaped = (value: string) => value.replace(/&(?:amp|quot|lt);/g, (entity) => ESCAPED[entity] ?? entity);

/** The elements of the HTML component makes with props, in order, each with its attributes. */
export async function tags<Props extends Record<string, unknown>>(
	component: Component<Props>,
	props: Props,
): Promise<Tag[]> {
	const found: Tag[] = [];
	await new HTMLRewriter()
		.on("*", {
			element: (el) => {
				const attributes = [...el.attributes].map(([name, value]) => [name, unescaped(value)]);
				found.push({ name: el.tagName, attributes: Object.fromEntries(attributes) });
			},
		})
		.transform(new Response(render(component, { props }).body))
		.text();
	return found;
}
