import type { Component } from "svelte";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";

// For tests of what a component draws: Bun loads a .svelte file compiled for the server, so that a test, once this
// module has run, can import a component (await import(), as a static import would load it before) and render it.
Bun.plugin({
	name: "svelte components for the server",
	setup(build) {
		build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
			contents: compile(await Bun.file(path).text(), { filename: path, generate: "server" }).js.code,
			loader: "js",
		}));
	},
});

export interface Tag {
	name: string;
	attributes: Record<string, string>;
}

// An attribute's value as Svelte escapes it (escape_html), read back.
const ESCAPED: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&lt;": "<" };
const unescaped = (value: string) => value.replace(/&(?:amp|quot|lt);/g, (entity) => ESCAPED[entity]);

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
