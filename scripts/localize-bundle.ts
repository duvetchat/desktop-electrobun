// postBuild and postWrap hook (electrobun.config.ts → scripts): the words the system shows of the app, outside it, in
// each language a released build offers (#464; SHIPPED, src/mainview/src/lib/i18n/locale.ts), from its os_ messages
// (src/bun/i18n.ts).
//
// macOS: the first time the app uses the microphone or the camera, macOS asks, with the app's
// NSMicrophoneUsageDescription or NSCameraUsageDescription under its question, in the system's language: from the
// bundle's Contents/Resources/<language>.lproj/InfoPlist.strings when it has the language (CFBundleLocalizations lists
// them), else the Info.plist's own, English (electrobun.config.ts: build.mac.entitlements). This writes them.
// Electrobun 1.15.1 (node_modules/electrobun/src/cli/index.ts) writes the app's Info.plist (line 2092), copies the app's
// files in, runs postBuild (2901), then signs the bundle (3164), which seals what it holds. A canary or stable build then
// tars it, makes the self-extracting bundle the app is opened from, with the same Info.plist (3475), runs postWrap (3496)
// and signs that (3502). So each hook comes after its bundle's Info.plist, and before its signature.
//
// Linux: a launcher shows the app's desktop entry's Comment beside its name. Electrobun writes the bundle's
// <name>.desktop with English's (config.app.description, line 1996) before either hook; this adds each other language's
// Comment[<lang>] to it, and nix/package.nix's entry takes them from there.
//
// Electrobun runs this with its own Bun, from the project root, for every target; it does nothing on Windows.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tIn, type BunMessageKey } from "../src/bun/i18n";
import { SHIPPED, type Locale } from "../src/mainview/src/lib/i18n/locale";

/** Each key of the Info.plist's that macOS shows in its permission prompts, and its message. */
export const USAGE_MESSAGES = {
	NSMicrophoneUsageDescription: "os_microphone_usage",
	NSCameraUsageDescription: "os_camera_usage",
} as const satisfies Record<string, BunMessageKey>;

/** A language as macOS names a bundle's languages: its tag, but Chinese by its script, as Xcode names them (zh-CN is
 * zh-Hans), which a system in Chinese of any region comes to. */
export const bundleLanguageOf = (locale: Locale) =>
	locale === "zh-CN" ? "zh-Hans" : locale === "zh-TW" ? "zh-Hant" : locale;

/** A language's folder in Resources (pt-BR.lproj, zh-Hans.lproj). */
export const lprojOf = (locale: Locale) => `${bundleLanguageOf(locale)}.lproj`;

/** Each usage description in a language. */
export function usageTexts(locale: Locale): Record<string, string> {
	return Object.fromEntries(Object.entries(USAGE_MESSAGES).map(([key, message]) => [key, tIn(locale, message)]));
}

/** A .strings file's quoted string: its backslashes, double quotes and line breaks escaped. */
const quoted = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

/** An InfoPlist.strings file, in UTF-8: each key and its text. */
export function stringsFile(texts: Record<string, string>): string {
	return Object.entries(texts)
		.map(([key, text]) => `${quoted(key)} = ${quoted(text)};\n`)
		.join("");
}

/** The Info.plist, with the bundle's languages (CFBundleLocalizations) and English, the language it's written in, as
 * its development region: the one macOS falls back to. Either key already there is replaced. */
export function withLocalizations(plist: string, locales: readonly Locale[]): string {
	const without = plist
		.replace(/\s*<key>CFBundleLocalizations<\/key>\s*<array>[\s\S]*?<\/array>/g, "")
		.replace(/\s*<key>CFBundleDevelopmentRegion<\/key>\s*<string>[^<]*<\/string>/g, "");
	const end = without.lastIndexOf("</dict>");
	if (end === -1) throw new Error("the Info.plist has no dict");
	const keys = [
		"    <key>CFBundleDevelopmentRegion</key>",
		"    <string>en</string>",
		"    <key>CFBundleLocalizations</key>",
		"    <array>",
		...locales.map((locale) => `        <string>${bundleLanguageOf(locale)}</string>`),
		"    </array>",
	];
	return `${without.slice(0, end).trimEnd()}\n${keys.join("\n")}\n${without.slice(end)}`;
}

/** Gives a bundle its languages: the Info.plist's list, and each language's InfoPlist.strings. */
export function localizeBundle(app: string, locales: readonly Locale[]): void {
	const plist = join(app, "Contents", "Info.plist");
	writeFileSync(plist, withLocalizations(readFileSync(plist, "utf8"), locales));
	for (const locale of locales) {
		const dir = join(app, "Contents", "Resources", lprojOf(locale));
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "InfoPlist.strings"), stringsFile(usageTexts(locale)));
	}
}

/** The desktop entry's comment, which Linux launchers show beside the app's name. */
export const DESKTOP_COMMENT = "os_desktop_comment" satisfies BunMessageKey;

/** A language as a desktop entry's localized keys name it, lang_COUNTRY (pt-BR is pt_BR). */
export const desktopLocaleOf = (locale: Locale) => locale.replace("-", "_");

/** A desktop entry's string value: backslashes, line breaks and tabs escaped, as the Desktop Entry spec reads them. */
export const desktopValue = (text: string) =>
	text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");

/** A desktop entry with the comment in each language but English, whose is its own Comment, right after it. Any
 * Comment[…] already there is replaced. */
export function withDesktopComments(entry: string, locales: readonly Locale[]): string {
	const lines = entry.split("\n").filter((line) => !/^Comment\[[^\]]*\]=/.test(line));
	const at = lines.findIndex((line) => line.startsWith("Comment="));
	if (at === -1) throw new Error("the desktop entry has no Comment");
	const comments = locales
		.filter((locale) => locale !== "en")
		.map((locale) => `Comment[${desktopLocaleOf(locale)}]=${desktopValue(tIn(locale, DESKTOP_COMMENT))}`);
	lines.splice(at + 1, 0, ...comments);
	return lines.join("\n");
}

/** Gives a Linux bundle's desktop entry, the one .desktop in it, its comment in each language. */
export function localizeDesktopEntry(bundle: string, locales: readonly Locale[]): string {
	const entries = readdirSync(bundle).filter((name) => name.endsWith(".desktop"));
	if (entries.length !== 1) throw new Error(`expected one .desktop in ${bundle}, found ${entries.length}`);
	const path = join(bundle, entries[0] ?? "");
	writeFileSync(path, withDesktopComments(readFileSync(path, "utf8"), locales));
	return path;
}

/** The bundle a hook is for: the self-extracting one in postWrap, else the app's in the build folder: on macOS the one
 * .app there, on Linux the folder named after the app (ELECTROBUN_APP_NAME). */
export function bundleOf(env: Record<string, string | undefined>): string {
	if (env.ELECTROBUN_WRAPPER_BUNDLE_PATH) return env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
	const dir = env.ELECTROBUN_BUILD_DIR;
	if (!dir) throw new Error("no ELECTROBUN_BUILD_DIR");
	if (env.ELECTROBUN_OS === "linux") {
		if (!env.ELECTROBUN_APP_NAME) throw new Error("no ELECTROBUN_APP_NAME");
		return join(dir, env.ELECTROBUN_APP_NAME);
	}
	const apps = readdirSync(dir).filter((name) => name.endsWith(".app"));
	if (apps.length !== 1) throw new Error(`expected one .app in ${dir}, found ${apps.length}`);
	return join(dir, apps[0] ?? "");
}

if (import.meta.main) {
	const os = process.env.ELECTROBUN_OS;
	if (os === "macos") {
		const app = bundleOf(process.env);
		localizeBundle(app, SHIPPED);
		// A malformed Info.plist would make an app macOS won't open: the build stops here instead.
		if (process.platform === "darwin") {
			const lint = spawnSync("plutil", ["-lint", join(app, "Contents", "Info.plist")], { stdio: "inherit" });
			if (lint.status !== 0) process.exit(lint.status ?? 1);
		}
		console.log(`[languages] ${app}: ${SHIPPED.join(", ")}`);
	} else if (os === "linux") {
		const entry = localizeDesktopEntry(bundleOf(process.env), SHIPPED);
		console.log(`[languages] ${entry}: ${SHIPPED.join(", ")}`);
	} else {
		console.log(`[languages] ${os ?? "no target"}: nothing to do`);
	}
}
