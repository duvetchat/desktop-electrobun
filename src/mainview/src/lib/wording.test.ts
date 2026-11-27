import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// #57: the app says Space and room, as the API, the docs and the mobile app do, not server and channel. This reads
// what the user can be shown: the text between a component's tags, its titles, labels, placeholders and alt texts, and
// every string with a space in it in components and lib modules, log lines and comments aside, and words that are
// code (${…}, {…}, a class's group/name) aside.
const src = join(import.meta.dir, "..");
const LEFT_OUT: Record<string, string> = {
	"lib/components/server-render.ts": "test tooling: Svelte's server rendering",
};
// The API itself is still the server.
const ABOUT_THE_API = new Set(["No answer from the server in time", "Server did not return a valid token"]);
const WORD = /\b(servers?|channels?)\b/i;
const shown = (s: string) =>
	s
		.split(/\s+/)
		.filter((token) => !/[{}$[\]/:.]/.test(token))
		.join(" ");

const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sources(join(dir, entry.name))
			: /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
				? [join(dir, entry.name)]
				: [],
	);

test("the UI says Space and room, not server and channel", () => {
	const found: string[] = [];
	for (const file of sources(src)) {
		const name = relative(src, file).split(sep).join("/");
		if (name in LEFT_OUT) continue;
		const text = readFileSync(file, "utf8").replace(/\r/g, "");
		for (const line of text.split("\n")) {
			if (/console\.|^\s*(\/\/|\*|\/\*)/.test(line)) continue;
			for (const m of line.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)) {
				const s = m[1] ?? m[2] ?? m[3];
				if (s!.includes(" ") && !ABOUT_THE_API.has(s!) && WORD.test(shown(s!))) found.push(`${name}: "${s}"`);
			}
			for (const m of line.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g))
				if (WORD.test(shown(m[1]!))) found.push(`${name}: ${m[0]}`);
		}
		if (!file.endsWith(".svelte")) continue;
		const markup = text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
		for (const m of markup.matchAll(/>([^<>{}]+)</g)) if (WORD.test(m[1]!)) found.push(`${name}: ${m[1]!.trim()}`);
	}
	expect(found).toEqual([]);
});

// The permissions' names are the app's words (#464): permissions.ts names them by key, en.json says them.
test("the permissions say rooms", () => {
	const permissions = readFileSync(join(src, "lib", "permissions.ts"), "utf8");
	const en: Record<string, string> = JSON.parse(readFileSync(join(src, "..", "messages", "en.json"), "utf8"));
	expect(permissions).toContain('Permission.ViewChannels, "perm_view_rooms"');
	expect(permissions).toContain('Permission.ManageChannels, "perm_manage_rooms"');
	expect(en.perm_view_rooms).toBe("View Rooms");
	expect(en.perm_manage_rooms).toBe("Manage Rooms");
});
