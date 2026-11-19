// @ts-nocheck
import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json";
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

export default {
	app: {
		// The shortcut, the bundle (`Duvet-<channel>`) and the installer are named after it. The install folder, the
		// app's data and the uninstall key go by the identifier, so renaming the app moves none of them.
		name: "Duvet",
		version: pkg.version,
		identifier: "com.duvet.desktop",
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
			entitlements: {
				"com.apple.security.device.audio-input":
					"Duvet uses your microphone for voice rooms, calls and voice messages.",
				"com.apple.security.device.camera": "Duvet uses your camera when you turn on video in a voice room or a call.",
			},
		},
		win: {
			icon: "icon.iconset/icon.ico",
		},
		linux: {
			icon: "icon.iconset/icon_256x256.png",
			bundleCEF: true,
		},
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

			// The Liquid Glass behind the main window on macOS (#374, src/bun/liquid-glass.ts), which loads it from
			// Resources/app/native/. scripts.preBuild compiles it before every build; on Windows and Linux it writes an
			// empty placeholder there, which the app never loads.
			"native/macos/build/libLiquidGlass.dylib": "native/libLiquidGlass.dylib",
		},
		// The glass's library is the preBuild hook's output, not a source to rebuild on.
		watchIgnore: ["dist/**", "native/macos/build/**"],
	},
	scripts: {
		// Builds native/macos/liquid_glass.mm for the build's target (scripts/build-liquid-glass.ts), before the copy step.
		preBuild: "scripts/build-liquid-glass.ts",
	},
	runtime: {
		dragRegions: true,
	},
} satisfies ElectrobunConfig;
