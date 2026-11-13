import { expect, test } from "bun:test";
import { join } from "node:path";
import config from "../../electrobun.config";

// Electrobun's Bun API (electrobun/bun) imports three.js and Babylon.js onto its default export, which the app never uses:
// bundled with it, they took about 200 ms of every start, before the window opened (#283).
test("the Bun bundle, built as Electrobun builds it, leaves three.js and Babylon.js out", async () => {
	const { entrypoint, ...options } = config.build.bun;
	const result = await Bun.build({
		...options,
		entrypoints: [join(import.meta.dir, "../..", entrypoint)],
		target: "bun",
	});
	expect(result.success).toBe(true);
	// Booleans: a failure printing the bundle would print megabytes.
	const code = await result.outputs[0].text();
	expect({
		babylon: code.includes("node_modules/@babylonjs/core/"),
		three: code.includes("node_modules/three/"),
		underThreeMB: code.length < 3_000_000,
	}).toEqual({ babylon: false, three: false, underThreeMB: true });
}, 60_000);
