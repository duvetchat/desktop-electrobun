import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../../electrobun.config";
import {
	bundleOf,
	DESKTOP_COMMENT,
	desktopLocaleOf,
	desktopValue,
	localizeBundle,
	localizeDesktopEntry,
	lprojOf,
	stringsFile,
	usageTexts,
	USAGE_MESSAGES,
	withDesktopComments,
	withLocalizations,
} from "../../scripts/localize-bundle";
import { SHIPPED } from "../mainview/src/lib/i18n/locale";
import { tIn } from "./i18n";

// The words the system shows of the app in the app's languages (#464, scripts/localize-bundle.ts): on macOS, the
// permission prompts, each shipped language's InfoPlist.strings and the Info.plist's list of languages, written into
// the bundle between Electrobun writing it and signing it; on Linux, the desktop entry's Comment.

// The Info.plist as Electrobun 1.15.1 writes it (its CLI: InfoPlistContents), with the usage descriptions it makes of
// the entitlements: its own words, for an entitlement that's true (generateUsageDescriptions).
const ELECTROBUN_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIdentifier</key>
    <string>com.duvet.desktop</string>
    <key>CFBundleName</key>
    <string>Duvet-dev</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>This app requires access for audio input</string>
    <key>NSCameraUsageDescription</key>
    <string>This app requires access for camera</string>
</dict>
</plist>`;

// The desktop entry as Electrobun 1.15.1 writes it into a Linux bundle (its CLI: buildIcons), with app.description.
const ELECTROBUN_DESKTOP = `[Desktop Entry]
Version=1.0
Type=Application
Name=Duvet
Comment=Duvet desktop client
Exec=launcher
Icon=appIcon.png
Terminal=false
StartupWMClass=Duvet
Categories=Utility;Application;
`;

const onMac = process.platform === "darwin";
/** A property list file as JSON, read by macOS's own plutil: what macOS would make of it. */
function plistJson(path: string): unknown {
	const out = spawnSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" });
	if (out.status !== 0) throw new Error(out.stderr);
	return JSON.parse(out.stdout);
}

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "duvet-localize-"));
}

describe("a language's InfoPlist.strings", () => {
	test("has the microphone's and the camera's texts, in that language", () => {
		expect(usageTexts("en")).toEqual({
			NSMicrophoneUsageDescription: tIn("en", "os_microphone_usage"),
			NSCameraUsageDescription: tIn("en", "os_camera_usage"),
		});
		expect(stringsFile(usageTexts("en"))).toBe(
			`"NSMicrophoneUsageDescription" = "${tIn("en", "os_microphone_usage")}";\n` +
				`"NSCameraUsageDescription" = "${tIn("en", "os_camera_usage")}";\n`,
		);
	});

	test("keeps a translation's quotes, backslashes and line breaks as written", () => {
		const texts = { NSCameraUsageDescription: 'Duvet usa la «cámara»: "vídeo" \\ en\nsalas' };
		const file = stringsFile(texts);
		expect(file).toBe('"NSCameraUsageDescription" = "Duvet usa la «cámara»: \\"vídeo\\" \\\\ en\\nsalas";\n');
		if (!onMac) return;
		const dir = scratch();
		try {
			writeFileSync(join(dir, "InfoPlist.strings"), file);
			expect(plistJson(join(dir, "InfoPlist.strings"))).toEqual(texts);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("is in the language's folder, named as Xcode names it", () => {
		expect(lprojOf("en")).toBe("en.lproj");
		expect(lprojOf("pt-BR")).toBe("pt-BR.lproj");
	});
});

describe("the Info.plist", () => {
	test("lists the bundle's languages, English its development region, and keeps the rest", () => {
		const plist = withLocalizations(ELECTROBUN_PLIST, ["en", "es"]);
		expect(plist).toContain("<key>CFBundleLocalizations</key>\n    <array>\n        <string>en</string>");
		expect(plist).toContain("<key>CFBundleDevelopmentRegion</key>\n    <string>en</string>");
		expect(plist).toContain("<key>CFBundleName</key>\n    <string>Duvet-dev</string>");
		expect(plist.endsWith("</dict>\n</plist>")).toBe(true);
	});

	// What a language without its InfoPlist.strings shows: English's messages, in place of Electrobun's words.
	test("has English's usage texts as its own", () => {
		const plist = withLocalizations(ELECTROBUN_PLIST, ["en", "es"]);
		for (const [key, text] of Object.entries(usageTexts("en"))) {
			expect(plist).toContain(`<key>${key}</key>\n    <string>${text}</string>`);
			expect(plist.match(new RegExp(`<key>${key}</key>`, "g"))).toHaveLength(1);
		}
		expect(plist).not.toContain("This app requires access");
		const escaped = withLocalizations(ELECTROBUN_PLIST, ["en"], { NSCameraUsageDescription: "A & <b>" });
		expect(escaped).toContain("<key>NSCameraUsageDescription</key>\n    <string>A &amp; &lt;b&gt;</string>");
	});

	test("written again, has its languages once, the new ones", () => {
		const twice = withLocalizations(withLocalizations(ELECTROBUN_PLIST, ["en", "es"]), ["en"]);
		expect(twice).toBe(withLocalizations(ELECTROBUN_PLIST, ["en"]));
		expect(twice.match(/CFBundleLocalizations/g)).toHaveLength(1);
	});

	test("without a dict, is refused", () => {
		expect(() => withLocalizations("<plist/>", ["en"])).toThrow("the Info.plist has no dict");
	});
});

describe("a bundle", () => {
	test("gets each language's InfoPlist.strings, and its Info.plist the list", () => {
		const dir = scratch();
		const app = join(dir, "Duvet-dev.app");
		try {
			mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
			writeFileSync(join(app, "Contents", "Info.plist"), ELECTROBUN_PLIST);
			localizeBundle(app, ["en", "fr"]);
			for (const locale of ["en", "fr"] as const) {
				const strings = join(app, "Contents", "Resources", `${locale}.lproj`, "InfoPlist.strings");
				expect(readFileSync(strings, "utf8")).toBe(stringsFile(usageTexts(locale)));
				if (onMac) expect(plistJson(strings)).toEqual(usageTexts(locale));
			}
			if (onMac) {
				expect(plistJson(join(app, "Contents", "Info.plist"))).toMatchObject({
					CFBundleIdentifier: "com.duvet.desktop",
					CFBundleDevelopmentRegion: "en",
					CFBundleLocalizations: ["en", "fr"],
					...usageTexts("en"),
				});
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("the build", () => {
	// Electrobun 1.15.1 runs postBuild once the app's bundle is whole and before it signs it, and postWrap the same for
	// the self-extracting bundle of a release (scripts/localize-bundle.ts says where).
	test("runs the script after each bundle is made, before it's signed", () => {
		expect(config.scripts.postBuild).toBe("scripts/localize-bundle.ts");
		expect(config.scripts.postWrap).toBe("scripts/localize-bundle.ts");
	});

	// A signed build runs under the hardened runtime, which reads a device's entitlement as a Boolean. Electrobun 1.15.1
	// signs an entitlement's value as it's given (its CLI: buildEntitlementsFile), so a usage text there would be the
	// permission's value, and macOS would refuse the microphone and the camera without asking (#619). Electrobun makes
	// a usage description of each true one in its own words, which the hook replaces with English's.
	test("asks for the microphone and the camera with true, as the hardened runtime reads them", () => {
		const entitlements: Record<string, unknown> = config.build.mac.entitlements;
		expect(entitlements["com.apple.security.device.audio-input"]).toBe(true);
		expect(entitlements["com.apple.security.device.camera"]).toBe(true);
		expect(Object.keys(USAGE_MESSAGES).sort()).toEqual(["NSCameraUsageDescription", "NSMicrophoneUsageDescription"]);
	});
});

describe("a Linux desktop entry", () => {
	test("has the comment in each language but English, right after English's", () => {
		const entry = withDesktopComments(ELECTROBUN_DESKTOP, ["en", "fr", "pt-BR"]);
		const lines = entry.split("\n");
		const at = lines.indexOf("Comment=Duvet desktop client");
		expect(lines.slice(at, at + 3)).toEqual([
			"Comment=Duvet desktop client",
			`Comment[fr]=${tIn("fr", DESKTOP_COMMENT)}`,
			`Comment[pt_BR]=${tIn("pt-BR", DESKTOP_COMMENT)}`,
		]);
		expect(entry.match(/^Comment/gm)).toHaveLength(3);
		expect(entry.endsWith("Categories=Utility;Application;\n")).toBe(true);
	});

	test("written again, has each language's once, the new ones", () => {
		const twice = withDesktopComments(withDesktopComments(ELECTROBUN_DESKTOP, ["en", "fr", "de"]), ["en", "es"]);
		expect(twice).toBe(withDesktopComments(ELECTROBUN_DESKTOP, ["en", "es"]));
		expect(withDesktopComments(ELECTROBUN_DESKTOP, ["en"])).toBe(ELECTROBUN_DESKTOP);
	});

	test("keeps a translation's backslashes, line breaks and tabs as the spec reads them", () =>
		expect(desktopValue("a\\b\nc\td\re")).toBe("a\\\\b\\nc\\td\\re"));

	test("names a language as the spec does, and without a Comment of its own, is refused", () => {
		expect(desktopLocaleOf("pt-BR")).toBe("pt_BR");
		expect(desktopLocaleOf("de")).toBe("de");
		expect(() => withDesktopComments("[Desktop Entry]\nName=Duvet\n", ["en"])).toThrow(
			"the desktop entry has no Comment",
		);
	});

	// Its English is Electrobun's Comment, which it writes from the app's description.
	test("in English, is the app's description", () => {
		expect(config.app.description).toBe(tIn("en", DESKTOP_COMMENT));
	});

	test("is the one .desktop in the bundle", () => {
		const dir = scratch();
		try {
			writeFileSync(join(dir, "Duvet.desktop"), ELECTROBUN_DESKTOP);
			expect(localizeDesktopEntry(dir, ["en", "it"])).toBe(join(dir, "Duvet.desktop"));
			expect(readFileSync(join(dir, "Duvet.desktop"), "utf8")).toContain(
				`\nComment[it]=${tIn("it", DESKTOP_COMMENT)}\n`,
			);
			writeFileSync(join(dir, "Other.desktop"), ELECTROBUN_DESKTOP);
			expect(() => localizeDesktopEntry(dir, ["en"])).toThrow("expected one .desktop");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// The hook as Electrobun runs it: its own Bun, from the project root, with the build's environment (its CLI: runHook).
describe("the hook", () => {
	const ROOT = join(import.meta.dir, "..", "..");
	/** Runs the script with only the build's variables of the environment given, as a hook. */
	function hook(env: Record<string, string>) {
		const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("ELECTROBUN_")));
		return spawnSync(process.execPath, ["scripts/localize-bundle.ts"], {
			cwd: ROOT,
			env: { ...clean, ...env },
			encoding: "utf8",
		});
	}
	/** A build folder with an app's bundle in it, as Electrobun leaves it for postBuild. */
	function macBuild(dir: string, name = "Duvet-dev.app", plist = ELECTROBUN_PLIST): string {
		const app = join(dir, name);
		mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
		writeFileSync(join(app, "Contents", "Info.plist"), plist);
		return app;
	}
	const lprojs = (app: string) =>
		readdirSync(join(app, "Contents", "Resources")).filter((name) => name.endsWith(".lproj"));

	test("for Windows, does nothing", () => {
		const dir = scratch();
		try {
			const app = macBuild(dir);
			mkdirSync(join(dir, "Duvet-dev"));
			writeFileSync(join(dir, "Duvet-dev", "Duvet.desktop"), ELECTROBUN_DESKTOP);
			const run = hook({ ELECTROBUN_OS: "win", ELECTROBUN_BUILD_DIR: dir, ELECTROBUN_APP_NAME: "Duvet-dev" });
			expect(run.status).toBe(0);
			expect(lprojs(app)).toEqual([]);
			expect(readFileSync(join(app, "Contents", "Info.plist"), "utf8")).toBe(ELECTROBUN_PLIST);
			expect(readFileSync(join(dir, "Duvet-dev", "Duvet.desktop"), "utf8")).toBe(ELECTROBUN_DESKTOP);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("for macOS, in postBuild, gives the build folder's one .app its languages", () => {
		const dir = scratch();
		try {
			const app = macBuild(dir);
			const run = hook({ ELECTROBUN_OS: "macos", ELECTROBUN_BUILD_DIR: dir });
			expect([run.status, run.stderr]).toEqual([0, ""]);
			expect(lprojs(app).sort()).toEqual(SHIPPED.map(lprojOf).sort());
			expect(readFileSync(join(app, "Contents", "Info.plist"), "utf8")).toBe(
				withLocalizations(ELECTROBUN_PLIST, SHIPPED),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("for macOS, in postWrap, gives the self-extracting bundle its languages, and leaves the app's alone", () => {
		const dir = scratch();
		try {
			const app = macBuild(dir);
			const wrapper = macBuild(join(dir, "wrapper"));
			const run = hook({ ELECTROBUN_OS: "macos", ELECTROBUN_BUILD_DIR: dir, ELECTROBUN_WRAPPER_BUNDLE_PATH: wrapper });
			expect([run.status, run.stderr]).toEqual([0, ""]);
			expect(lprojs(wrapper).sort()).toEqual(SHIPPED.map(lprojOf).sort());
			expect(readFileSync(join(wrapper, "Contents", "Info.plist"), "utf8")).toContain("CFBundleLocalizations");
			expect(lprojs(app)).toEqual([]);
			expect(readFileSync(join(app, "Contents", "Info.plist"), "utf8")).toBe(ELECTROBUN_PLIST);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("for macOS, stops the build when there's no one .app to give them to", () => {
		const dir = scratch();
		try {
			expect(hook({ ELECTROBUN_OS: "macos", ELECTROBUN_BUILD_DIR: dir }).status).not.toBe(0);
			macBuild(dir, "Duvet-dev.app");
			macBuild(dir, "Duvet-canary.app");
			expect(hook({ ELECTROBUN_OS: "macos", ELECTROBUN_BUILD_DIR: dir }).status).not.toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// plutil reads what macOS will: an Info.plist it can't read is an app macOS won't open.
	test.skipIf(!onMac)("for macOS, stops the build when the Info.plist comes out malformed", () => {
		const dir = scratch();
		try {
			const broken = ELECTROBUN_PLIST.replace("<string>launcher</string>", "<strin>launcher</string>");
			const app = macBuild(dir, "Duvet-dev.app", broken);
			const run = hook({ ELECTROBUN_OS: "macos", ELECTROBUN_BUILD_DIR: dir });
			expect(run.status).not.toBe(0);
			// plutil's complaint names the file; the hook never says it's done.
			expect(run.stderr).toContain(`${join(app, "Contents", "Info.plist")}:`);
			expect(run.stdout).not.toContain("[languages]");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("for Linux, gives the app's folder's desktop entry, or the self-extracting one's, its comments", () => {
		const dir = scratch();
		try {
			for (const folder of ["Duvet-canary", "wrapper"]) {
				mkdirSync(join(dir, folder));
				writeFileSync(join(dir, folder, "Duvet.desktop"), ELECTROBUN_DESKTOP);
			}
			const env = { ELECTROBUN_OS: "linux", ELECTROBUN_BUILD_DIR: dir, ELECTROBUN_APP_NAME: "Duvet-canary" };
			expect(bundleOf(env)).toBe(join(dir, "Duvet-canary"));
			expect(hook(env).status).toBe(0);
			const localized = withDesktopComments(ELECTROBUN_DESKTOP, SHIPPED);
			expect(readFileSync(join(dir, "Duvet-canary", "Duvet.desktop"), "utf8")).toBe(localized);
			const wrapper = join(dir, "wrapper");
			expect(bundleOf({ ...env, ELECTROBUN_WRAPPER_BUNDLE_PATH: wrapper })).toBe(wrapper);
			expect(hook({ ...env, ELECTROBUN_WRAPPER_BUNDLE_PATH: wrapper }).status).toBe(0);
			expect(readFileSync(join(wrapper, "Duvet.desktop"), "utf8")).toBe(localized);
			// Without the app's name there's no telling which folder is the app's.
			expect(hook({ ELECTROBUN_OS: "linux", ELECTROBUN_BUILD_DIR: dir }).status).not.toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
