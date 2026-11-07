import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The file Android reads from https://duvet.chat/.well-known/assetlinks.json to open duvet.chat's links in the app
// without asking (https://developer.android.com/training/app-links/verify-android-applinks).
const mainview = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const links = JSON.parse(readFileSync(join(mainview, "static", ".well-known", "assetlinks.json"), "utf8"));

describe("assetlinks.json", () => {
	test("hands duvet.chat's links to the app, by its release key", () => {
		expect(links).toHaveLength(1);
		expect(links[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
		expect(links[0].target.namespace).toBe("android_app");
		expect(links[0].target.package_name).toBe("chat.duvet");
		expect(links[0].target.sha256_cert_fingerprints).toHaveLength(1);
		expect(links[0].target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
	});

	test("is only the web build's: the desktop app doesn't copy it, nor a folder that holds it", () => {
		const built = "src/mainview/build/.well-known/assetlinks.json";
		const config = readFileSync(join(mainview, "..", "..", "electrobun.config.ts"), "utf8");
		const copied = [...config.matchAll(/"(src\/mainview\/[^"]+)":/g)].map((match) => match[1]);
		expect(copied.length).toBeGreaterThan(0);
		for (const from of copied) expect(built === from || built.startsWith(`${from}/`)).toBe(false);
	});
});
