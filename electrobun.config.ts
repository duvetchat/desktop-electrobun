// @ts-nocheck
import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json";
import { coreLibraryCopy } from "./src/bun/e2e/library";
import en from "./src/mainview/messages/en.json";
import { secondWindowCopyRules } from "./src/mainview/src/lib/app-windows";

// Electrobun's Bun API (electrobun/bun) imports three.js and Babylon.js onto its default export, which the app never uses:
// bundled, they took about 200 ms of every start before the window opened (#283). The Bun bundle gets empty modules.
const noUnusedEngines = {
	name: "no-unused-engines",
	setup(build) {
		build.onResolve({ filter: /^(three|@babylonjs\/core)$/ }, (args) => ({ path: args.path, namespace: "unused" }));
		build.onLoad({ filter: /.*/, namespace: "unused" }, () => ({ contents: "export {};", loader: "js" }));
	},
};

// A Linux build's tar, the one its installer unpacks, is written by the system's tar: GNU tar, which names a path over
// 100 characters with a long-name entry that Electrobun 1.15.1's self-extractor refuses (TarUnsupportedFileType), so
// the installer installed nothing (#590). The CLI loads this file in its own process and runs tar with its environment,
// and GNU tar takes options from TAR_OPTIONS: PAX names long paths as the extractor reads them, as Windows' tar does.
if (process.platform === "linux") process.env.TAR_OPTIONS = `${process.env.TAR_OPTIONS ?? ""} --format=pax`.trim();

export default {
	app: {
		// The shortcut, the bundle (`Duvet-<channel>`) and the installer are named after it. The install folder, the
		// app's data and the uninstall key go by the identifier, so renaming the app moves none of them.
		name: "Duvet",
		version: pkg.version,
		identifier: "com.duvet.desktop",
		// The Linux desktop entry's Comment, which launchers show beside the app's name: English's os_ message (#464), the
		// words nix/package.nix's entry had (was Electrobun's default, "Duvet application", on the shortcut its Linux
		// installer copies to the Desktop); each other language's is added by scripts.postBuild, and nix/package.nix's
		// entry takes them all from there.
		description: en.os_desktop_comment,
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
			plugins: [noUnusedEngines],
		},
		mac: {
			icon: "icon.iconset",
			// macOS asks before the app uses the microphone or the camera, with these lines: Electrobun writes an
			// entitlement's text into Info.plist as its usage description (audio-input as NSMicrophoneUsageDescription,
			// camera as NSCameraUsageDescription), and an app without them can't open either. Screen sharing needs no
			// entry: macOS asks for Screen Recording itself. With codesign on, Electrobun would also sign these texts as
			// the entitlements' values, where the hardened runtime wants true: check the mic and the camera then.
			// English's os_ messages (#464); each other language's goes in its InfoPlist.strings (scripts.postBuild).
			entitlements: {
				"com.apple.security.device.audio-input": en.os_microphone_usage,
				"com.apple.security.device.camera": en.os_camera_usage,
			},
		},
		win: {
			icon: "icon.iconset/icon.ico",
		},
		linux: {
			icon: "icon.iconset/icon_256x256.png",
			bundleCEF: true,
		},
		// No `locales` (#464): in Electrobun 1.15.1 it trims the ICU data of Bun's own Intl on Windows and Linux
		// (trimICUData in its CLI), not CEF's locale packs (locales/*.pak), which ship whole whatever it says; and Bun
		// formats its words in each of the app's languages (src/bun/i18n.ts).
		copy: {
			"src/mainview/build/_app": "views/mainview/_app",
			"src/mainview/build/sounds": "views/mainview/sounds",
			"src/mainview/build/badges": "views/mainview/badges",
			"src/mainview/build/rnnoise-worklet-processor.js": "views/mainview/rnnoise-worklet-processor.js",

			"src/mainview/build/app.html": "views/mainview/app.html",
			"src/mainview/build/index.html": "views/mainview/index.html",

			"src/mainview/build/sign-in.html": "views/mainview/sign-in.html",
			"src/mainview/build/sign-up.html": "views/mainview/sign-up.html",
			"src/mainview/build/forgot-password.html": "views/mainview/forgot-password.html",
			"src/mainview/build/verify.html": "views/mainview/verify.html",
			"src/mainview/build/reset-password.html": "views/mainview/reset-password.html",
			"src/mainview/build/change-email.html": "views/mainview/change-email.html",
			"src/mainview/build/invite.html": "views/mainview/invite.html",

			// The pages of the app's other windows (the media controls' pop-out, Settings): one rule each, from their one
			// list (src/mainview/src/lib/app-windows.ts). Without its rule a page loads in the dev build and answers 404 in
			// the packaged app (#357, docs/redesign/PLATFORM.md §3); src/bun/pages.test.ts checks every page has one.
			...secondWindowCopyRules(),

			// The app's own macOS libraries, which it loads from Resources/app/native/: the Liquid Glass behind the main
			// window (#374, src/bun/liquid-glass.ts), the traffic lights' place in the title line (#406,
			// src/bun/window-buttons.ts) and the recovery key's Copy (src/bun/secret-clipboard.ts). scripts.preBuild
			// compiles them before every build; on Windows and Linux it writes empty placeholders there, which the app
			// never loads.
			"native/macos/build/libLiquidGlass.dylib": "native/libLiquidGlass.dylib",
			"native/macos/build/libWindowButtons.dylib": "native/libWindowButtons.dylib",
			"native/macos/build/libPasteboard.dylib": "native/libPasteboard.dylib",

			// The end-to-end encryption core, which the app also loads from Resources/app/native/ (src/bun/e2e/library.ts):
			// a Windows x64 build carries its DLL, a Linux x64 one its shared object, and a macOS one none, where the core is
			// unsupported. Electrobun builds for the system it runs on.
			...coreLibraryCopy(),
		},
		// Those libraries are the preBuild hook's output, not sources to rebuild on.
		watchIgnore: ["dist/**", "native/macos/build/**"],
	},
	scripts: {
		// Builds the sources in native/macos for the build's target (scripts/build-native.ts), before the copy step.
		preBuild: "scripts/build-native.ts",
		// macOS's permission prompts in each language the app ships (#464): its InfoPlist.strings and the Info.plist's
		// CFBundleLocalizations, written into the app's bundle, then into the self-extracting one a release is opened
		// from, each after Electrobun writes its Info.plist and before it signs it (scripts/localize-bundle.ts).
		postBuild: "scripts/localize-bundle.ts",
		postWrap: "scripts/localize-bundle.ts",
	},
	runtime: {
		dragRegions: true,
	},
	// Where the app's updates come from (#456, src/bun/updates.ts): the rolling desktop-stable release of the public
	// duvetchat/releases, which the release workflow fills. No patches: the app downloads each version whole, as it
	// verifies only a whole build's tar.
	release: {
		baseUrl: "https://github.com/duvetchat/releases/releases/download/desktop-stable",
		generatePatch: false,
	},
} satisfies ElectrobunConfig;
